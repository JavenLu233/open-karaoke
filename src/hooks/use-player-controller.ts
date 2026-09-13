import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { findActiveLyricIndex, parseLrc } from '../lib/lrc';
import { inferTrackInfo, mergeTrackInfoFromLrc } from '../lib/track-info';
import {
  AssetHistoryStore,
  pickRememberedAssetHandles,
  readRememberedAsset,
  supportsRememberedAssets,
  type AssetFileSet,
  type AssetHandleSet,
  type AssetHistoryEntry,
} from '../services/asset-history';
import {
  DEFAULT_RECORDING_SETTINGS,
  getRecorderCapabilities,
  MediaRecorderService,
  RECORDING_FPS_OPTIONS,
  RECORDING_RESOLUTION_OPTIONS,
  type RecordingSettings,
} from '../services/media-recorder';
import { Mp4Converter } from '../services/mp4-converter';
import type { LyricLine, NoticeTone } from '../types';
import { drawCanvasFrame, type CanvasElements } from '../canvas/canvas-renderer';

const LYRICS_OFFSET_KEY = 'vinyl-lyrics-video:lyrics-offset-ms';
// v2 intentionally resets the old 24 FPS preference so the new default takes effect.
const RECORDING_SETTINGS_KEY = 'open-karaoke:recording-settings:v2';
const LYRICS_OFFSET_STEP = 100;
const LYRICS_OFFSET_LIMIT = 5000;

type AssetKind = 'audio' | 'cover' | 'lyrics';

function createHistoryId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function classifyAsset(file: File): AssetKind | undefined {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|flac)$/.test(lowerName)) return 'audio';
  if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/.test(lowerName)) return 'cover';
  if (lowerName.endsWith('.lrc')) return 'lyrics';
  return undefined;
}

function readStoredOffset(): number {
  try {
    const value = Number.parseInt(localStorage.getItem(LYRICS_OFFSET_KEY) ?? '', 10);
    if (Number.isFinite(value)) return Math.max(-LYRICS_OFFSET_LIMIT, Math.min(LYRICS_OFFSET_LIMIT, value));
  } catch {
    // The preference remains session-only when localStorage is unavailable.
  }
  return 0;
}

function readStoredRecordingSettings(): RecordingSettings {
  try {
    const value = localStorage.getItem(RECORDING_SETTINGS_KEY);
    if (value) {
      const parsed = JSON.parse(value) as Partial<RecordingSettings>;
      const fps = RECORDING_FPS_OPTIONS.find((option) => option === parsed.fps);
      const resolution = RECORDING_RESOLUTION_OPTIONS.find((option) => option.width === parsed.width && option.height === parsed.height);
      if (fps && resolution) return { fps, width: resolution.width, height: resolution.height };
    }
  } catch {
    // Use defaults when the browser blocks localStorage.
  }
  return { ...DEFAULT_RECORDING_SETTINGS };
}

function saveLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local preferences are best-effort.
  }
}

function completeFiles(files: Partial<AssetFileSet>): AssetFileSet | undefined {
  if (!files.audio || !files.cover || !files.lyrics) return undefined;
  return { audio: files.audio, cover: files.cover, lyrics: files.lyrics };
}

export interface PlayerRefs {
  audio: RefObject<HTMLAudioElement | null>;
  stage: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  stageTopline: RefObject<HTMLDivElement | null>;
  stageLabel: RefObject<HTMLSpanElement | null>;
  stageIndex: RefObject<HTMLSpanElement | null>;
  settingsButton: RefObject<HTMLButtonElement | null>;
  disc: RefObject<HTMLDivElement | null>;
  coverImage: RefObject<HTMLImageElement | null>;
  captionRule: RefObject<HTMLSpanElement | null>;
  playState: RefObject<HTMLSpanElement | null>;
  trackTitle: RefObject<HTMLElement | null>;
  trackArtist: RefObject<HTMLSpanElement | null>;
  lyricsHeading: RefObject<HTMLDivElement | null>;
  lyricsLabel: RefObject<HTMLSpanElement | null>;
  lyricsCount: RefObject<HTMLSpanElement | null>;
  lyricsViewport: RefObject<HTMLDivElement | null>;
  lyricsList: RefObject<HTMLUListElement | null>;
  lyricsFooter: RefObject<HTMLDivElement | null>;
  lyricsFooterText: RefObject<HTMLSpanElement | null>;
}

export interface PlayerController {
  refs: PlayerRefs;
  lyrics: LyricLine[];
  activeLyricIndex: number;
  title: string;
  artist: string;
  audioName: string;
  coverName: string;
  lyricsName: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  recording: boolean;
  recordBusy: boolean;
  recorderSupported: boolean;
  recordStatus: string;
  notice: { message: string; tone: NoticeTone };
  download: { mp4?: string; webm?: string };
  downloadNames: { mp4?: string; webm?: string };
  syncPanelOpen: boolean;
  lyricsOffsetMs: number;
  recordingSettings: RecordingSettings;
  supportsHistory: boolean;
  canSaveHistory: boolean;
  historyEntries: AssetHistoryEntry[];
  historyPage: number;
  historyPageSize: number;
  historyPageCount: number;
  visibleHistoryEntries: AssetHistoryEntry[];
  actions: {
    loadAudio: (file: File) => void;
    loadCover: (file: File) => void;
    loadLyrics: (file: File) => Promise<void>;
    setTitle: (value: string) => void;
    setArtist: (value: string) => void;
    toggleSyncPanel: () => void;
    adjustOffset: (deltaMs: number) => void;
    resetOffset: () => void;
    setRecordingSettings: (changes: Partial<RecordingSettings>) => void;
    startOrStopRecording: () => void;
    rememberAssets: () => Promise<void>;
    saveHistory: () => Promise<void>;
    restoreHistory: (id: string) => Promise<void>;
    deleteHistory: (id: string) => Promise<void>;
    setHistoryPage: (page: number) => void;
    setHistoryPageSize: (pageSize: number) => void;
  };
}

export function usePlayerController(): PlayerController {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageToplineRef = useRef<HTMLDivElement | null>(null);
  const stageLabelRef = useRef<HTMLSpanElement | null>(null);
  const stageIndexRef = useRef<HTMLSpanElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const discRef = useRef<HTMLDivElement | null>(null);
  const coverImageRef = useRef<HTMLImageElement | null>(null);
  const captionRuleRef = useRef<HTMLSpanElement | null>(null);
  const playStateRef = useRef<HTMLSpanElement | null>(null);
  const trackTitleRef = useRef<HTMLElement | null>(null);
  const trackArtistRef = useRef<HTMLSpanElement | null>(null);
  const lyricsHeadingRef = useRef<HTMLDivElement | null>(null);
  const lyricsLabelRef = useRef<HTMLSpanElement | null>(null);
  const lyricsCountRef = useRef<HTMLSpanElement | null>(null);
  const lyricsViewportRef = useRef<HTMLDivElement | null>(null);
  const lyricsListRef = useRef<HTMLUListElement | null>(null);
  const lyricsFooterRef = useRef<HTMLDivElement | null>(null);
  const lyricsFooterTextRef = useRef<HTMLSpanElement | null>(null);
  const refs: PlayerRefs = useMemo(() => ({
    audio: audioRef,
    stage: stageRef,
    canvas: canvasRef,
    stageTopline: stageToplineRef,
    stageLabel: stageLabelRef,
    stageIndex: stageIndexRef,
    settingsButton: settingsButtonRef,
    disc: discRef,
    coverImage: coverImageRef,
    captionRule: captionRuleRef,
    playState: playStateRef,
    trackTitle: trackTitleRef,
    trackArtist: trackArtistRef,
    lyricsHeading: lyricsHeadingRef,
    lyricsLabel: lyricsLabelRef,
    lyricsCount: lyricsCountRef,
    lyricsViewport: lyricsViewportRef,
    lyricsList: lyricsListRef,
    lyricsFooter: lyricsFooterRef,
    lyricsFooterText: lyricsFooterTextRef,
  }), []);
  const filesRef = useRef<Partial<AssetFileSet>>({});
  const handlesRef = useRef<AssetHandleSet | null>(null);
  const titleRef = useRef('未命名作品');
  const artistRef = useRef('');
  const titleManualRef = useRef(false);
  const artistManualRef = useRef(false);
  const objectUrlsRef = useRef<{ audio?: string; cover?: string }>({});
  const downloadUrlsRef = useRef<{ mp4?: string; webm?: string }>({});
  const recorderRef = useRef(new MediaRecorderService());
  const converterRef = useRef(new Mp4Converter());
  const historyStoreRef = useRef(new AssetHistoryStore());
  const recordingRef = useRef(false);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [title, setTitleState] = useState(titleRef.current);
  const [artist, setArtistState] = useState(artistRef.current);
  const [audioName, setAudioName] = useState('选择 MP3 / OGG / WAV');
  const [coverName, setCoverName] = useState('选择 JPG / PNG');
  const [lyricsName, setLyricsName] = useState('选择 UTF-8 LRC');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recorderSupported, setRecorderSupported] = useState(false);
  const [recordStatus, setRecordStatus] = useState('未载入音频');
  const [notice, setNoticeState] = useState<{ message: string; tone: NoticeTone }>({ message: '演示素材载入中…', tone: 'neutral' });
  const [download, setDownload] = useState<{ mp4?: string; webm?: string }>({});
  const [downloadNames, setDownloadNames] = useState<{ mp4?: string; webm?: string }>({});
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(readStoredOffset);
  const [recordingSettings, setRecordingSettingsState] = useState(readStoredRecordingSettings);
  const [assetRevision, setAssetRevision] = useState(0);
  const [historyEntries, setHistoryEntries] = useState<AssetHistoryEntry[]>(() => historyStoreRef.current.list());
  const [historyPage, setHistoryPageState] = useState(1);
  const [historyPageSize, setHistoryPageSizeState] = useState(5);
  const supportsHistory = useMemo(() => supportsRememberedAssets(), []);

  const setNotice = useCallback((message: string, tone: NoticeTone): void => {
    setNoticeState({ message, tone });
  }, []);

  const replaceObjectUrl = useCallback((kind: 'audio' | 'cover', file: File): string => {
    const previous = objectUrlsRef.current[kind];
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    objectUrlsRef.current[kind] = url;
    return url;
  }, []);

  const clearDownloads = useCallback((): void => {
    Object.values(downloadUrlsRef.current).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    downloadUrlsRef.current = {};
    setDownload({});
    setDownloadNames({});
  }, []);

  const makeDownload = useCallback((kind: 'mp4' | 'webm', blob: Blob, filename: string): void => {
    const previous = downloadUrlsRef.current[kind];
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    downloadUrlsRef.current[kind] = url;
    setDownload((value) => ({ ...value, [kind]: url }));
    setDownloadNames((value) => ({ ...value, [kind]: filename }));
  }, []);

  const loadAudio = useCallback((file: File): void => {
    filesRef.current = { ...filesRef.current, audio: file };
    handlesRef.current = null;
    setAssetRevision((value) => value + 1);
    const audio = refs.audio.current;
    if (audio) {
      audio.src = replaceObjectUrl('audio', file);
      audio.load();
      setCurrentTime(0);
    }
    const inferred = inferTrackInfo(file.name);
    titleRef.current = inferred.title;
    artistRef.current = inferred.artist;
    titleManualRef.current = false;
    artistManualRef.current = false;
    setTitleState(inferred.title);
    setArtistState(inferred.artist);
    setAudioName(file.name);
    setRecordStatus('音频已就绪');
    setNotice(`已载入《${inferred.title}》，点击播放开始预览。`, 'success');
  }, [refs.audio, replaceObjectUrl, setNotice]);

  const loadCover = useCallback((file: File): void => {
    filesRef.current = { ...filesRef.current, cover: file };
    handlesRef.current = null;
    setAssetRevision((value) => value + 1);
    const image = refs.coverImage.current;
    if (image) image.src = replaceObjectUrl('cover', file);
    setCoverName(file.name);
    setNotice(`已载入封面：${file.name}`, 'success');
  }, [refs.coverImage, replaceObjectUrl, setNotice]);

  const loadLyrics = useCallback(async (file: File): Promise<void> => {
    filesRef.current = { ...filesRef.current, lyrics: file };
    handlesRef.current = null;
    setAssetRevision((value) => value + 1);
    try {
      const parsed = parseLrc(await file.text());
      setLyrics(parsed.lines);
      setActiveLyricIndex(-1);
      setLyricsName(file.name);
      const merged = mergeTrackInfoFromLrc({ title: titleRef.current, artist: artistRef.current }, parsed.metadata);
      if (!titleManualRef.current) {
        titleRef.current = merged.title;
        setTitleState(merged.title);
      }
      if (!artistManualRef.current) {
        artistRef.current = merged.artist;
        setArtistState(merged.artist);
      }
      setNotice(parsed.lines.length > 0 ? `已载入 ${parsed.lines.length} 行歌词。` : '歌词文件中没有有效的时间标签。', parsed.lines.length > 0 ? 'success' : 'error');
    } catch {
      setNotice('歌词读取失败，请确认文件是 UTF-8 编码的 LRC。', 'error');
    }
  }, [setNotice]);

  const loadDemoAssets = useCallback(async (): Promise<void> => {
    try {
      const publicUrl = (name: string) => `${import.meta.env.BASE_URL}demo/${name}`;
      const [audioResponse, lyricsResponse, coverResponse] = await Promise.all([
        fetch(publicUrl('auld-lang-syne.ogg')),
        fetch(publicUrl('auld-lang-syne.lrc')),
        fetch(publicUrl('auld-lang-syne-cover.png')),
      ]);
      if (!audioResponse.ok || !lyricsResponse.ok || !coverResponse.ok) throw new Error('演示素材不存在');
      const [audioBlob, lyricsText, coverBlob] = await Promise.all([audioResponse.blob(), lyricsResponse.text(), coverResponse.blob()]);
      loadAudio(new File([audioBlob], 'Auld Lang Syne.ogg', { type: 'audio/ogg' }));
      loadCover(new File([coverBlob], 'Auld Lang Syne-cover.png', { type: 'image/png' }));
      await loadLyrics(new File([lyricsText], 'Auld Lang Syne.lrc', { type: 'text/plain' }));
      setNotice('已自动载入公版演示素材，点击播放查看同步效果。', 'success');
    } catch {
      setNotice('演示素材载入失败，你仍可以通过右侧选择自己的文件。', 'neutral');
    }
  }, [loadAudio, loadCover, loadLyrics, setNotice]);

  const refreshHistory = useCallback(() => {
    setHistoryEntries(historyStoreRef.current.list());
  }, []);

  const rememberAssets = useCallback(async (): Promise<void> => {
    try {
      const handles = await pickRememberedAssetHandles();
      const selected = new Map<AssetKind, { handle: AssetHandleSet[keyof AssetHandleSet]; file: File }>();
      for (const handle of handles) {
        const file = await readRememberedAsset(handle);
        const kind = classifyAsset(file);
        if (kind && !selected.has(kind)) selected.set(kind, { handle, file });
      }
      const audio = selected.get('audio');
      const cover = selected.get('cover');
      const lyric = selected.get('lyrics');
      if (!audio || !cover || !lyric) throw new Error('请在同一次选择中包含一个音频、一个封面图片和一个 LRC 文件。');
      filesRef.current = {};
      loadAudio(audio.file);
      loadCover(cover.file);
      await loadLyrics(lyric.file);
      handlesRef.current = { audio: audio.handle, cover: cover.handle, lyrics: lyric.handle };
      setAssetRevision((value) => value + 1);
      setNotice('三份素材已载入，可点击“保存当前素材组”记住它们。', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setNotice(error instanceof Error ? error.message : '素材导入失败，请重试。', 'error');
    }
  }, [loadAudio, loadCover, loadLyrics, setNotice]);

  const saveHistory = useCallback(async (): Promise<void> => {
    const files = completeFiles(filesRef.current);
    const source = handlesRef.current ? { handles: handlesRef.current } : files ? { files } : undefined;
    const sourceNames = handlesRef.current ?? files;
    if (!source || !sourceNames) {
      setNotice('请先载入完整的音频、封面和 LRC 文件。', 'neutral');
      return;
    }
    const entry: AssetHistoryEntry = {
      id: createHistoryId(),
      label: titleRef.current || '未命名素材组',
      createdAt: Date.now(),
      audioName: sourceNames.audio.name,
      coverName: sourceNames.cover.name,
      lyricsName: sourceNames.lyrics.name,
      songTitle: titleRef.current,
      artistName: artistRef.current,
      lyricsOffsetMs,
    };
    try {
      await historyStoreRef.current.save(entry, source);
      refreshHistory();
      setHistoryPageState(1);
      setNotice(`已保存素材组“${entry.label}”，下次可以从历史记录恢复。`, 'success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '素材组保存失败，请重试。', 'error');
    }
  }, [lyricsOffsetMs, refreshHistory, setNotice]);

  const restoreHistory = useCallback(async (id: string): Promise<void> => {
    try {
      const snapshot = await historyStoreRef.current.getSnapshot(id);
      if (!snapshot) throw new Error('找不到这条历史素材记录。');
      const { entry, source } = snapshot;
      const files = source.handles
        ? await Promise.all([readRememberedAsset(source.handles.audio), readRememberedAsset(source.handles.cover), readRememberedAsset(source.handles.lyrics)])
        : source.files ? [source.files.audio, source.files.cover, source.files.lyrics] : undefined;
      if (!files) throw new Error('这条历史记录没有可恢复的文件。');
      filesRef.current = {};
      loadAudio(files[0]);
      loadCover(files[1]);
      await loadLyrics(files[2]);
      handlesRef.current = source.handles ?? null;
      titleRef.current = entry.songTitle || titleRef.current;
      artistRef.current = entry.artistName ?? artistRef.current;
      titleManualRef.current = Boolean(entry.songTitle);
      artistManualRef.current = entry.artistName !== undefined;
      setTitleState(titleRef.current);
      setArtistState(artistRef.current);
      if (typeof entry.lyricsOffsetMs === 'number' && Number.isFinite(entry.lyricsOffsetMs)) {
        const offset = Math.max(-LYRICS_OFFSET_LIMIT, Math.min(LYRICS_OFFSET_LIMIT, entry.lyricsOffsetMs));
        setLyricsOffsetMs(offset);
        saveLocal(LYRICS_OFFSET_KEY, String(offset));
      }
      setAssetRevision((value) => value + 1);
      setNotice('已从历史记录恢复三份素材。', 'success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '历史素材恢复失败，请重新选择文件。', 'error');
    }
  }, [loadAudio, loadCover, loadLyrics, setNotice]);

  const deleteHistory = useCallback(async (id: string): Promise<void> => {
    try {
      await historyStoreRef.current.remove(id);
      refreshHistory();
      setNotice('历史素材组已删除。', 'neutral');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '历史记录删除失败，请重试。', 'error');
    }
  }, [refreshHistory, setNotice]);

  const setTitle = useCallback((value: string): void => {
    titleManualRef.current = true;
    titleRef.current = value.trim() || '未命名作品';
    setTitleState(titleRef.current);
  }, []);

  const setArtist = useCallback((value: string): void => {
    artistManualRef.current = true;
    artistRef.current = value.trim();
    setArtistState(artistRef.current);
  }, []);

  const adjustOffset = useCallback((deltaMs: number): void => {
    setLyricsOffsetMs((value) => {
      const next = Math.max(-LYRICS_OFFSET_LIMIT, Math.min(LYRICS_OFFSET_LIMIT, value + deltaMs));
      saveLocal(LYRICS_OFFSET_KEY, String(next));
      return next;
    });
  }, []);

  const resetOffset = useCallback((): void => {
    setLyricsOffsetMs(0);
    saveLocal(LYRICS_OFFSET_KEY, '0');
  }, []);

  const setRecordingSettings = useCallback((changes: Partial<RecordingSettings>): void => {
    if (recordingRef.current) return;
    setRecordingSettingsState((current) => {
      const fps = RECORDING_FPS_OPTIONS.find((option) => option === changes.fps) ?? current.fps;
      const resolution = RECORDING_RESOLUTION_OPTIONS.find((option) => option.width === changes.width && option.height === changes.height)
        ?? RECORDING_RESOLUTION_OPTIONS.find((option) => option.width === current.width && option.height === current.height)
        ?? RECORDING_RESOLUTION_OPTIONS[1];
      const next = { fps, width: resolution.width, height: resolution.height };
      saveLocal(RECORDING_SETTINGS_KEY, JSON.stringify(next));
      setNotice(`导出设置已更新：${fps} FPS · ${resolution.width} × ${resolution.height}`, 'neutral');
      return next;
    });
  }, [setNotice]);

  const draw = useCallback((forceRecording = recordingRef.current): void => {
    const elements = Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, ref.current])) as CanvasElements;
    if (Object.values(elements).some((element) => !element)) return;
    drawCanvasFrame(elements, {
      lyrics,
      currentTime: refs.audio.current?.currentTime ?? 0,
      title,
      artist,
      recording: forceRecording,
      settingsOpen: syncPanelOpen,
      recordingSettings,
    });
  }, [artist, lyrics, recordingSettings, refs, syncPanelOpen, title]);

  const stopRecording = useCallback(async (): Promise<void> => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setRecordBusy(true);
    setRecordStatus('正在生成视频…');
    try {
      const result = await recorderRef.current.stop();
      const baseName = titleRef.current || 'music-video';
      if (result.format === 'mp4') {
        makeDownload('mp4', result.blob, `${baseName}.mp4`);
        setRecordStatus('MP4 视频已生成');
        setNotice('录制完成，点击右侧下载链接保存 MP4 视频。', 'success');
      } else {
        makeDownload('webm', result.blob, `${baseName}.webm`);
        setRecordStatus('正在转换 MP4…');
        setNotice('WebM 已生成，正在转换为 MP4，请稍候。', 'neutral');
        try {
          const mp4Blob = await converterRef.current.convert(result.blob, (progress) => setRecordStatus(`正在转换 MP4… ${Math.round(progress * 100)}%`));
          makeDownload('mp4', mp4Blob, `${baseName}.mp4`);
          setRecordStatus('MP4 视频已生成');
          setNotice('MP4 转换完成，可下载 MP4；WebM 原文件也已保留。', 'success');
        } catch (error) {
          setRecordStatus('WebM 视频已生成');
          setNotice(error instanceof Error ? `MP4 转换失败，仍可下载 WebM：${error.message}` : 'MP4 转换失败，仍可下载 WebM。', 'error');
        }
      }
    } catch (error) {
      setRecordStatus('录制失败');
      setNotice(error instanceof Error ? error.message : '视频生成失败，请重试。', 'error');
    } finally {
      setRecordBusy(false);
      requestAnimationFrame(() => draw(false));
    }
  }, [draw, makeDownload, setNotice]);

  const startRecording = useCallback(async (): Promise<void> => {
    const audio = refs.audio.current;
    const canvas = refs.canvas.current;
    const stage = refs.stage.current;
    if (!audio || !canvas || !stage || !audio.src) {
      setNotice('请先选择一个音频文件。', 'error');
      return;
    }
    clearDownloads();
    recordingRef.current = true;
    setRecording(true);
    setRecordBusy(true);
    try {
      if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration) audio.currentTime = 0;
      drawCanvasFrame(
        Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, ref.current])) as CanvasElements,
        { lyrics, currentTime: audio.currentTime, title, artist, recording: true, settingsOpen: syncPanelOpen, recordingSettings },
      );
      await audio.play();
      recorderRef.current.start(audio, canvas, recordingSettings);
      setRecordBusy(false);
      setRecordStatus('正在录制中');
      setNotice('录制进行中，播放结束或点击按钮即可停止。', 'success');
    } catch (error) {
      recordingRef.current = false;
      setRecording(false);
      setRecordBusy(false);
      recorderRef.current.cancel();
      requestAnimationFrame(() => draw(false));
      setNotice(error instanceof Error ? error.message : '无法开始录制，请重试。', 'error');
    }
  }, [artist, clearDownloads, draw, lyrics, recordingSettings, refs, setNotice, syncPanelOpen, title]);

  const startOrStopRecording = useCallback((): void => {
    if (recordingRef.current) void stopRecording();
    else void startRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const audio = refs.audio.current;
    if (!audio) return undefined;
    const onPlay = () => { setIsPlaying(true); setRecordStatus(recordingRef.current ? '正在录制中' : '播放中'); };
    const onPause = () => { setIsPlaying(false); setRecordStatus(recordingRef.current ? '录制中 · 已暂停' : '已暂停'); };
    const onEnded = () => { setIsPlaying(false); if (recordingRef.current) void stopRecording(); };
    const onTime = () => { setCurrentTime(audio.currentTime); setDuration(audio.duration); };
    const onError = () => { setNotice('音频加载失败，请选择有效的 MP3 或 WAV 文件。', 'error'); };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onTime);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('seeking', onTime);
    audio.addEventListener('seeked', onTime);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onTime);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('seeking', onTime);
      audio.removeEventListener('seeked', onTime);
      audio.removeEventListener('error', onError);
    };
  }, [refs.audio, setNotice, stopRecording]);

  useEffect(() => {
    setRecorderSupported(() => {
      try {
        const capabilities = getRecorderCapabilities();
        return capabilities.canvasCapture && capabilities.audioCapture && capabilities.mediaRecorder;
      } catch {
        return false;
      }
    });
  }, []);

  useEffect(() => {
    if (!recorderSupported) setNotice('录制需要最新版 Chrome / Edge，并且页面必须运行在 localhost 或 HTTPS。', 'error');
  }, [recorderSupported, setNotice]);

  useEffect(() => {
    if (!isPlaying && !recording) return undefined;
    const audio = refs.audio.current;
    if (!audio) return undefined;
    // Canvas reads the media clock directly while recording. React only needs
    // a low-frequency update for the time readout and lyric index; rendering
    // every 60th of a second would cause unnecessary layout churn.
    const interval = window.setInterval(() => setCurrentTime(audio.currentTime), 100);
    return () => window.clearInterval(interval);
  }, [isPlaying, recording, recordingSettings.fps, refs.audio]);

  useEffect(() => {
    const adjustedTime = currentTime + lyricsOffsetMs / 1000;
    const nextIndex = findActiveLyricIndex(lyrics, adjustedTime);
    setActiveLyricIndex((value) => value === nextIndex ? value : nextIndex);
  }, [currentTime, lyrics, lyricsOffsetMs]);

  useEffect(() => {
    if (refs.disc.current) refs.disc.current.style.setProperty('--rotation-angle', `${currentTime * 0.72}rad`);
  }, [currentTime, refs.disc]);

  useEffect(() => {
    // Never switch a recording canvas back to preview dimensions while the
    // recorder is active. That resize invalidates the capture stream and is
    // perceived as a shake when the active lyric changes.
    const frame = requestAnimationFrame(() => draw(recordingRef.current));
    return () => cancelAnimationFrame(frame);
  }, [draw, assetRevision, activeLyricIndex, isPlaying, currentTime, recording]);

  useEffect(() => {
    if (!recording) return undefined;
    const interval = window.setInterval(() => draw(true), 1000 / recordingSettings.fps);
    return () => window.clearInterval(interval);
  }, [draw, recording, recordingSettings.fps]);

  useEffect(() => {
    const onResize = () => draw(recordingRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => { if (!cancelled) void loadDemoAssets(); }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadDemoAssets]);

  useEffect(() => () => {
    Object.values(objectUrlsRef.current).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    Object.values(downloadUrlsRef.current).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    recorderRef.current.cancel();
  }, []);

  const pageCount = Math.max(1, Math.ceil(historyEntries.length / historyPageSize));
  const safeHistoryPage = Math.max(1, Math.min(pageCount, historyPage));
  const visibleHistoryEntries = historyEntries.slice((safeHistoryPage - 1) * historyPageSize, safeHistoryPage * historyPageSize);
  const canSaveHistory = Boolean(supportsHistory && (handlesRef.current || completeFiles(filesRef.current)));

  const controller: PlayerController = {
    refs,
    lyrics,
    activeLyricIndex,
    title,
    artist,
    audioName,
    coverName,
    lyricsName,
    currentTime,
    duration,
    isPlaying,
    recording,
    recordBusy,
    recorderSupported,
    recordStatus,
    notice,
    download,
    downloadNames,
    syncPanelOpen,
    lyricsOffsetMs,
    recordingSettings,
    supportsHistory,
    canSaveHistory,
    historyEntries,
    historyPage: safeHistoryPage,
    historyPageSize,
    historyPageCount: pageCount,
    visibleHistoryEntries,
    actions: {
      loadAudio,
      loadCover,
      loadLyrics,
      setTitle,
      setArtist,
      toggleSyncPanel: () => setSyncPanelOpen((value) => !value),
      adjustOffset,
      resetOffset,
      setRecordingSettings,
      startOrStopRecording,
      rememberAssets,
      saveHistory,
      restoreHistory,
      deleteHistory,
      setHistoryPage: (page) => setHistoryPageState(Math.max(1, Math.min(pageCount, page))),
      setHistoryPageSize: (size) => {
        if ([5, 10, 20].includes(size)) {
          setHistoryPageSizeState(size);
          setHistoryPageState(1);
        }
      },
    },
  };
  return controller;
}
