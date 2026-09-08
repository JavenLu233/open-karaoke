import { findActiveLyricIndex, parseLrc } from './lib/lrc';
import { formatTime } from './lib/time';
import { MediaRecorderService, RECORDING_FPS, getRecorderCapabilities } from './services/media-recorder';
import { Mp4Converter } from './services/mp4-converter';
import {
  AssetHistoryStore,
  type AssetHandleSet,
  type AssetFileSet,
  type AssetHistoryEntry,
  pickRememberedAssetHandles,
  readRememberedAsset,
  supportsRememberedAssets,
} from './services/asset-history';
import { inferTrackInfo, mergeTrackInfoFromLrc } from './lib/track-info';
import type { LyricLine, NoticeTone } from './types';
import { LyricsView } from './ui/lyrics-view';

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`找不到页面元素 #${id}`);
  return element as T;
}

type AssetKind = 'audio' | 'cover' | 'lyrics';

function classifyAsset(file: File): AssetKind | undefined {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|flac)$/.test(lowerName)) return 'audio';
  if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/.test(lowerName)) return 'cover';
  if (lowerName.endsWith('.lrc')) return 'lyrics';
  return undefined;
}

function createHistoryId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class PlayerApp {
  private readonly audio: HTMLAudioElement = getElement<HTMLAudioElement>('audioPlayer');
  private readonly canvas: HTMLCanvasElement = getElement<HTMLCanvasElement>('recordingCanvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly playerStage = getElement<HTMLElement>('playerStage');
  private readonly stageTopline = getElement<HTMLElement>('stageTopline');
  private readonly stageLabel = getElement<HTMLElement>('stageLabel');
  private readonly stageIndex = getElement<HTMLElement>('stageIndex');
  private readonly disc = getElement<HTMLElement>('disc');
  private readonly coverImage = getElement<HTMLImageElement>('coverImage');
  private readonly coverPlaceholder = getElement<HTMLElement>('coverPlaceholder');
  private readonly captionRule = getElement<HTMLElement>('captionRule');
  private readonly playState = getElement<HTMLElement>('playState');
  private readonly trackTitle = getElement<HTMLElement>('trackTitle');
  private readonly trackArtist = getElement<HTMLElement>('trackArtist');
  private readonly currentTime = getElement<HTMLElement>('currentTime');
  private readonly duration = getElement<HTMLElement>('duration');
  private readonly recordBtn = getElement<HTMLButtonElement>('recordBtn');
  private readonly recordBtnLabel = getElement<HTMLElement>('recordBtnLabel');
  private readonly recordStatus = getElement<HTMLElement>('recordStatus');
  private readonly downloadLink = getElement<HTMLAnchorElement>('downloadLink');
  private readonly webmDownloadLink = getElement<HTMLAnchorElement>('webmDownloadLink');
  private readonly settingsBtn = getElement<HTMLButtonElement>('settingsBtn');
  private readonly syncPanel = getElement<HTMLElement>('syncPanel');
  private readonly offsetAdvanceBtn = getElement<HTMLButtonElement>('offsetAdvanceBtn');
  private readonly offsetDelayBtn = getElement<HTMLButtonElement>('offsetDelayBtn');
  private readonly resetOffsetBtn = getElement<HTMLButtonElement>('resetOffsetBtn');
  private readonly lyricsOffsetValue = getElement<HTMLElement>('lyricsOffsetValue');
  private readonly lyricsOffsetHint = getElement<HTMLElement>('lyricsOffsetHint');
  private readonly notice = getElement<HTMLElement>('notice');
  private readonly noticeText = getElement<HTMLElement>('noticeText');
  private readonly lyricsCount = getElement<HTMLElement>('lyricsCount');
  private readonly lyricsLabel = getElement<HTMLElement>('lyricsLabel');
  private readonly lyricsHeading = getElement<HTMLElement>('lyricsHeading');
  private readonly lyricsViewport = getElement<HTMLElement>('lyricsViewport');
  private readonly lyricsList = getElement<HTMLUListElement>('lyricsList');
  private readonly lyricsFooter = getElement<HTMLElement>('lyricsFooter');
  private readonly lyricsFooterText = getElement<HTMLElement>('lyricsFooterText');
  private readonly lyricsView: LyricsView;
  private readonly recorder = new MediaRecorderService();
  private readonly mp4Converter = new Mp4Converter();
  private readonly objectUrls = new Set<string>();
  private readonly audioFileName = getElement<HTMLElement>('audioFileName');
  private readonly coverFileName = getElement<HTMLElement>('coverFileName');
  private readonly lyricsFileName = getElement<HTMLElement>('lyricsFileName');
  private readonly audioFile = getElement<HTMLInputElement>('audioFile');
  private readonly coverFile = getElement<HTMLInputElement>('coverFile');
  private readonly lyricsFile = getElement<HTMLInputElement>('lyricsFile');
  private readonly rememberAssetsBtn = getElement<HTMLButtonElement>('rememberAssetsBtn');
  private readonly saveHistoryBtn = getElement<HTMLButtonElement>('saveHistoryBtn');
  private readonly assetHistoryList = getElement<HTMLElement>('assetHistoryList');
  private readonly assetHistoryHint = getElement<HTMLElement>('assetHistoryHint');
  private readonly songTitleInput = getElement<HTMLInputElement>('songTitleInput');
  private readonly artistNameInput = getElement<HTMLInputElement>('artistNameInput');

  private lyrics: LyricLine[] = [];
  private activeLyricIndex = -1;
  private animationFrameId: number | null = null;
  private recordingIntervalId: number | null = null;
  private recording = false;
  private recorderSupported = false;
  private readonly downloadUrls = new Set<string>();
  private readonly assetHistory = new AssetHistoryStore();
  private songTitle = '未命名作品';
  private artistName = '';
  private songTitleManuallyEdited = false;
  private artistNameManuallyEdited = false;
  private currentAssetHandles: AssetHandleSet | null = null;
  private currentAssetFiles: Partial<AssetFileSet> = {};
  private canvasScale = 1;
  private lyricsOffsetMs = this.restoreLyricsOffset();

  private static readonly lyricsOffsetStorageKey = 'vinyl-lyrics-video:lyrics-offset-ms';
  private static readonly lyricsOffsetStepMs = 100;
  private static readonly lyricsOffsetLimitMs = 5000;

  constructor() {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('无法初始化录制画布。');
    this.context = context;
    this.lyricsView = new LyricsView(
      getElement('lyricsViewport'),
      getElement('lyricsTrack'),
      getElement<HTMLUListElement>('lyricsList'),
    );

    this.bindEvents();
    window.addEventListener('resize', () => this.drawCanvasFrame());
    this.updateLyricsOffsetUi();
    this.updateRecorderAvailability();
    this.updateAssetHistoryUi();
    this.renderAssetHistory();
    this.syncPlaybackUi();
    this.drawCanvasFrame();
    void this.loadDemoAssets();
  }

  private bindEvents(): void {
    this.audio.addEventListener('play', () => {
      this.disc.classList.add('is-playing');
      this.playState.textContent = '正在播放';
      this.recordStatus.textContent = this.recording ? '正在录制中' : '播放中';
      this.startVisualLoop();
    });
    this.audio.addEventListener('pause', () => {
      this.disc.classList.remove('is-playing');
      if (!this.recording) this.playState.textContent = '已暂停';
      this.recordStatus.textContent = this.recording ? '录制中 · 已暂停' : '已暂停';
      this.updateVisualLoop();
    });
    this.audio.addEventListener('ended', () => {
      this.disc.classList.remove('is-playing');
      this.playState.textContent = '播放结束';
      if (this.recording) void this.stopRecording();
    });
    this.audio.addEventListener('loadedmetadata', () => this.syncPlaybackUi());
    this.audio.addEventListener('timeupdate', () => {
      this.syncPlaybackUi();
      this.syncLyrics();
      this.drawCanvasFrame();
    });
    this.audio.addEventListener('seeking', () => this.syncLyrics());
    this.audio.addEventListener('seeked', () => {
      this.syncPlaybackUi();
      this.syncLyrics();
      this.drawCanvasFrame();
    });
    this.audio.addEventListener('error', () => {
      this.setNotice('音频加载失败，请选择有效的 MP3 或 WAV 文件。', 'error');
      this.recordBtn.disabled = true;
    });

    this.audioFile.addEventListener('change', () => {
      const file = this.audioFile.files?.[0];
      if (file) this.loadAudio(file);
    });
    this.coverFile.addEventListener('change', () => {
      const file = this.coverFile.files?.[0];
      if (file) this.loadCover(file);
    });
    this.lyricsFile.addEventListener('change', () => {
      const file = this.lyricsFile.files?.[0];
      if (file) void this.loadLyrics(file);
    });
    this.songTitleInput.addEventListener('input', () => {
      this.songTitle = this.songTitleInput.value.trim() || '未命名作品';
      this.songTitleManuallyEdited = true;
      this.syncTrackInfoUi();
      this.drawCanvasFrame();
    });
    this.artistNameInput.addEventListener('input', () => {
      this.artistName = this.artistNameInput.value.trim();
      this.artistNameManuallyEdited = true;
      this.syncTrackInfoUi();
      this.drawCanvasFrame();
    });
    this.rememberAssetsBtn.addEventListener('click', () => void this.importRememberedAssets());
    this.saveHistoryBtn.addEventListener('click', () => void this.saveCurrentAssetHistory());
    this.assetHistoryList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const item = target.closest<HTMLElement>('[data-history-id]');
      const historyId = item?.dataset.historyId;
      if (!historyId) return;
      if (target.closest('[data-history-action="delete"]')) {
        void this.deleteAssetHistory(historyId);
      } else if (target.closest('[data-history-action="restore"]')) {
        void this.restoreAssetHistory(historyId);
      }
    });
    this.recordBtn.addEventListener('click', () => {
      if (this.recording) void this.stopRecording();
      else void this.startRecording();
    });
    this.settingsBtn.addEventListener('click', () => {
      const shouldOpen = this.syncPanel.hidden;
      this.syncPanel.hidden = !shouldOpen;
      this.settingsBtn.classList.toggle('is-active', shouldOpen);
      this.settingsBtn.setAttribute('aria-expanded', String(shouldOpen));
      this.settingsBtn.setAttribute('aria-label', shouldOpen ? '关闭歌词对齐设置' : '打开歌词对齐设置');
    });
    this.offsetAdvanceBtn.addEventListener('click', () => {
      this.adjustLyricsOffset(PlayerApp.lyricsOffsetStepMs);
    });
    this.offsetDelayBtn.addEventListener('click', () => {
      this.adjustLyricsOffset(-PlayerApp.lyricsOffsetStepMs);
    });
    this.resetOffsetBtn.addEventListener('click', () => {
      this.setLyricsOffset(0);
    });
    window.addEventListener('beforeunload', () => this.releaseObjectUrls());
  }

  private updateRecorderAvailability(): void {
    const capabilities = getRecorderCapabilities();
    this.recorderSupported = capabilities.canvasCapture && capabilities.audioCapture && capabilities.mediaRecorder;
    this.recordBtn.disabled = !this.recorderSupported || !this.audio.src;

    if (!this.recorderSupported) {
      this.recordStatus.textContent = '浏览器不支持录制';
      this.setNotice('录制需要最新版 Chrome / Edge，并且页面必须运行在 localhost 或 HTTPS。', 'error');
    }
  }

  private loadAudio(file: File): void {
    this.currentAssetHandles = null;
    this.currentAssetFiles = { ...this.currentAssetFiles, audio: file };
    this.updateAssetHistoryUi();
    this.revokePreviousUrl('audio');
    const url = URL.createObjectURL(file);
    this.objectUrls.add(url);
    this.audio.src = url;
    this.audio.load();
    const inferredTrackInfo = inferTrackInfo(file.name);
    this.songTitle = inferredTrackInfo.title;
    this.artistName = inferredTrackInfo.artist;
    this.songTitleManuallyEdited = false;
    this.artistNameManuallyEdited = false;
    this.syncTrackInfoUi();
    this.audioFileName.textContent = file.name;
    this.recordStatus.textContent = '音频已就绪';
    this.recordBtn.disabled = !this.recorderSupported;
    this.setNotice(`已载入《${this.songTitle}》，点击播放开始预览。`, 'success');
    this.syncPlaybackUi();
    this.drawCanvasFrame();
  }

  private loadCover(file: File): void {
    this.currentAssetHandles = null;
    this.currentAssetFiles = { ...this.currentAssetFiles, cover: file };
    this.updateAssetHistoryUi();
    this.revokePreviousUrl('cover');
    const url = URL.createObjectURL(file);
    this.objectUrls.add(url);
    this.coverImage.src = url;
    this.coverImage.onload = () => {
      this.coverImage.classList.add('is-visible');
      this.coverPlaceholder.classList.add('is-hidden');
      this.drawCanvasFrame();
    };
    this.coverFileName.textContent = file.name;
    this.setNotice(`已载入封面：${file.name}`, 'success');
  }

  private async loadLyrics(file: File): Promise<void> {
    this.currentAssetHandles = null;
    this.currentAssetFiles = { ...this.currentAssetFiles, lyrics: file };
    this.updateAssetHistoryUi();
    try {
      const parsed = parseLrc(await file.text());
      this.lyrics = parsed.lines;
      this.lyricsView.setLines(this.lyrics);
      this.lyricsView.setActiveIndex(-1);
      this.activeLyricIndex = -1;
      this.lyricsFileName.textContent = file.name;
      this.lyricsCount.textContent = `${this.lyrics.length} LINES`;
      const mergedTrackInfo = mergeTrackInfoFromLrc(
        { title: this.songTitle, artist: this.artistName },
        parsed.metadata,
      );
      if (!this.songTitleManuallyEdited) this.songTitle = mergedTrackInfo.title;
      if (!this.artistNameManuallyEdited) this.artistName = mergedTrackInfo.artist;
      this.syncTrackInfoUi();
      this.setNotice(
        this.lyrics.length > 0 ? `已载入 ${this.lyrics.length} 行歌词。` : '歌词文件中没有有效的时间标签。',
        this.lyrics.length > 0 ? 'success' : 'error',
      );
      this.drawCanvasFrame();
    } catch {
      this.setNotice('歌词读取失败，请确认文件是 UTF-8 编码的 LRC。', 'error');
    }
  }

  private async loadDemoAssets(): Promise<void> {
    try {
      this.currentAssetFiles = {};
      this.currentAssetHandles = null;
      const [audioResponse, lyricsResponse, coverResponse] = await Promise.all([
        fetch(this.getPublicAssetUrl('auld-lang-syne.ogg')),
        fetch(this.getPublicAssetUrl('auld-lang-syne.lrc')),
        fetch(this.getPublicAssetUrl('auld-lang-syne-cover.png')),
      ]);
      if (!audioResponse.ok || !lyricsResponse.ok || !coverResponse.ok) {
        throw new Error('演示素材不存在');
      }

      const [audioBlob, lyricsText, coverBlob] = await Promise.all([
        audioResponse.blob(),
        lyricsResponse.text(),
        coverResponse.blob(),
      ]);
      this.loadAudio(new File([audioBlob], 'Auld Lang Syne.ogg', { type: 'audio/ogg' }));
      this.loadCover(new File([coverBlob], 'Auld Lang Syne-cover.png', { type: 'image/png' }));
      await this.loadLyrics(new File([lyricsText], 'Auld Lang Syne.lrc', { type: 'text/plain' }));
      this.setNotice('已自动载入公版演示素材，点击播放查看同步效果。', 'success');
    } catch {
      this.setNotice('演示素材载入失败，你仍可以通过右侧选择自己的文件。', 'neutral');
    }
  }

  private async importRememberedAssets(): Promise<void> {
    try {
      const handles = await pickRememberedAssetHandles();
      const files = await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })));
      const selected = new Map<AssetKind, { handle: (typeof handles)[number]; file: File }>();

      for (const item of files) {
        const kind = classifyAsset(item.file);
        if (kind && !selected.has(kind)) selected.set(kind, item);
      }

      const audio = selected.get('audio');
      const cover = selected.get('cover');
      const lyrics = selected.get('lyrics');
      if (!audio || !cover || !lyrics) {
        throw new Error('请在同一次选择中包含一个音频、一个封面图片和一个 LRC 文件。');
      }

      this.currentAssetFiles = {};
      this.loadAudio(audio.file);
      this.loadCover(cover.file);
      await this.loadLyrics(lyrics.file);
      this.currentAssetHandles = {
        audio: audio.handle,
        cover: cover.handle,
        lyrics: lyrics.handle,
      };
      this.updateAssetHistoryUi();
      this.setNotice('三份素材已载入，可点击“保存当前素材组”记住它们。', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.setNotice(error instanceof Error ? error.message : '素材导入失败，请重试。', 'error');
    }
  }

  private async saveCurrentAssetHistory(): Promise<void> {
    const files = this.getCompleteAssetFiles();
    if (!this.currentAssetHandles && !files) {
      this.setNotice('请先载入完整的音频、封面和 LRC 文件。', 'neutral');
      return;
    }

    const source = this.currentAssetHandles ? { handles: this.currentAssetHandles } : { files };
    const sourceNames = this.currentAssetHandles ?? files;
    if (!sourceNames) return;

    const entry: AssetHistoryEntry = {
      id: createHistoryId(),
      label: this.songTitle || '未命名素材组',
      createdAt: Date.now(),
      audioName: sourceNames.audio.name,
      coverName: sourceNames.cover.name,
      lyricsName: sourceNames.lyrics.name,
      songTitle: this.songTitle,
      artistName: this.artistName,
      lyricsOffsetMs: this.lyricsOffsetMs,
    };

    try {
      await this.assetHistory.save(entry, source);
      this.renderAssetHistory();
      this.setNotice(`已保存素材组“${entry.label}”，下次可以从历史记录恢复。`, 'success');
    } catch (error) {
      this.setNotice(error instanceof Error ? error.message : '素材组保存失败，请重试。', 'error');
    }
  }

  private async restoreAssetHistory(id: string): Promise<void> {
    try {
      const snapshot = await this.assetHistory.getSnapshot(id);
      if (!snapshot) throw new Error('找不到这条历史素材记录。');
      const { entry, source } = snapshot;

      const files = source.handles
        ? await Promise.all([
            readRememberedAsset(source.handles.audio),
            readRememberedAsset(source.handles.cover),
            readRememberedAsset(source.handles.lyrics),
          ])
        : source.files
          ? [source.files.audio, source.files.cover, source.files.lyrics]
          : undefined;
      if (!files) throw new Error('这条历史记录没有可恢复的文件。');

      this.currentAssetFiles = {};
      this.loadAudio(files[0]);
      this.loadCover(files[1]);
      await this.loadLyrics(files[2]);
      this.currentAssetHandles = source.handles ?? null;
      if (entry.songTitle) {
        this.songTitle = entry.songTitle;
        this.songTitleManuallyEdited = true;
      }
      if (entry.artistName !== undefined) {
        this.artistName = entry.artistName;
        this.artistNameManuallyEdited = true;
      }
      this.syncTrackInfoUi();
      if (typeof entry.lyricsOffsetMs === 'number' && Number.isFinite(entry.lyricsOffsetMs)) {
        this.setLyricsOffset(entry.lyricsOffsetMs);
      }
      this.updateAssetHistoryUi();
      this.setNotice('已从历史记录恢复三份素材。', 'success');
    } catch (error) {
      this.setNotice(error instanceof Error ? error.message : '历史素材恢复失败，请重新选择文件。', 'error');
    }
  }

  private async deleteAssetHistory(id: string): Promise<void> {
    try {
      await this.assetHistory.remove(id);
      this.renderAssetHistory();
      this.setNotice('历史素材组已删除。', 'neutral');
    } catch (error) {
      this.setNotice(error instanceof Error ? error.message : '历史记录删除失败，请重试。', 'error');
    }
  }

  private updateAssetHistoryUi(): void {
    const supported = supportsRememberedAssets();
    this.rememberAssetsBtn.disabled = !supported;
    this.saveHistoryBtn.disabled = !supported || (!this.currentAssetHandles && !this.getCompleteAssetFiles());
    this.assetHistoryHint.textContent = supported
      ? '列表保存在当前浏览器；记忆导入保存文件句柄，普通导入保存本地副本。'
      : '当前浏览器不支持记忆文件句柄，请使用最新版 Chrome / Edge。';
  }

  private getCompleteAssetFiles(): AssetFileSet | undefined {
    const { audio, cover, lyrics } = this.currentAssetFiles;
    if (!audio || !cover || !lyrics) return undefined;
    return { audio, cover, lyrics };
  }

  private renderAssetHistory(): void {
    const entries = this.assetHistory.list();
    this.assetHistoryList.replaceChildren();

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'asset-history-empty';
      empty.textContent = '还没有保存的素材组。';
      this.assetHistoryList.append(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement('article');
      item.className = 'asset-history-item';
      item.dataset.historyId = entry.id;

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'asset-history-restore';
      restore.dataset.historyAction = 'restore';
      restore.textContent = entry.label;

      const state = document.createElement('span');
      state.className = 'asset-history-state';
      const offset = typeof entry.lyricsOffsetMs === 'number' && Number.isFinite(entry.lyricsOffsetMs)
        ? `${entry.lyricsOffsetMs > 0 ? '+' : ''}${entry.lyricsOffsetMs} ms`
        : '0 ms';
      state.textContent = `${entry.artistName || '未识别歌手'} · 歌词偏移 ${offset}`;

      const files = document.createElement('span');
      files.className = 'asset-history-files';
      files.textContent = `${entry.audioName} · ${entry.coverName} · ${entry.lyricsName}`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'asset-history-delete';
      remove.dataset.historyAction = 'delete';
      remove.setAttribute('aria-label', `删除历史素材组 ${entry.label}`);
      remove.textContent = '×';

      const copy = document.createElement('span');
      copy.className = 'asset-history-copy';
      copy.append(restore, state, files);
      item.append(copy, remove);
      this.assetHistoryList.append(item);
    }
  }

  private syncPlaybackUi(): void {
    this.currentTime.textContent = formatTime(this.audio.currentTime);
    this.duration.textContent = formatTime(this.audio.duration);
  }

  private syncTrackInfoUi(): void {
    this.songTitleInput.value = this.songTitle;
    this.artistNameInput.value = this.artistName;
    this.trackTitle.textContent = this.songTitle;
    this.trackArtist.textContent = this.artistName || '未识别歌手';
  }

  private getPublicAssetUrl(fileName: string): string {
    return `${import.meta.env.BASE_URL}demo/${fileName}`;
  }

  private syncLyrics(): void {
    const adjustedTime = this.audio.currentTime + this.lyricsOffsetMs / 1000;
    const nextIndex = findActiveLyricIndex(this.lyrics, adjustedTime);
    if (nextIndex === this.activeLyricIndex) return;
    this.activeLyricIndex = nextIndex;
    this.lyricsView.setActiveIndex(nextIndex);
    this.drawCanvasFrame();
  }

  private restoreLyricsOffset(): number {
    try {
      const storedValue = Number.parseInt(localStorage.getItem(PlayerApp.lyricsOffsetStorageKey) ?? '', 10);
      if (Number.isFinite(storedValue)) {
        return Math.max(-PlayerApp.lyricsOffsetLimitMs, Math.min(PlayerApp.lyricsOffsetLimitMs, storedValue));
      }
    } catch {
      // localStorage may be unavailable in a restricted browser context.
    }
    return 0;
  }

  private adjustLyricsOffset(deltaMs: number): void {
    this.setLyricsOffset(this.lyricsOffsetMs + deltaMs);
  }

  private setLyricsOffset(offsetMs: number): void {
    this.lyricsOffsetMs = Math.max(-PlayerApp.lyricsOffsetLimitMs, Math.min(PlayerApp.lyricsOffsetLimitMs, offsetMs));
    try {
      localStorage.setItem(PlayerApp.lyricsOffsetStorageKey, String(this.lyricsOffsetMs));
    } catch {
      // Keep the adjustment active for the current session when persistence is unavailable.
    }
    this.updateLyricsOffsetUi();
    this.syncLyrics();
    this.drawCanvasFrame();
  }

  private updateLyricsOffsetUi(): void {
    const seconds = Math.abs(this.lyricsOffsetMs) / 1000;
    const formattedValue = `${this.lyricsOffsetMs > 0 ? '+' : ''}${this.lyricsOffsetMs} ms`;
    const hint = this.lyricsOffsetMs === 0
      ? '使用 LRC 原始时间'
      : this.lyricsOffsetMs > 0
        ? `歌词提前 ${seconds.toFixed(1)} 秒`
        : `歌词延后 ${seconds.toFixed(1)} 秒`;
    this.lyricsOffsetValue.textContent = formattedValue;
    this.lyricsOffsetHint.textContent = hint;
  }

  private startVisualLoop(): void {
    if (this.recording) {
      this.startRecordingVisualLoop();
      return;
    }
    if (this.animationFrameId !== null) return;
    this.animationFrameId = requestAnimationFrame(() => this.visualFrame());
  }

  private updateVisualLoop(): void {
    if (this.recording) this.startRecordingVisualLoop();
    else if (!this.audio.paused) this.startVisualLoop();
    else if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      this.updateDiscTransform();
      this.drawCanvasFrame();
    }
  }

  private visualFrame(): void {
    this.animationFrameId = null;
    this.updateDiscTransform();
    this.drawCanvasFrame();
    if (!this.recording && !this.audio.paused) this.startVisualLoop();
  }

  private startRecordingVisualLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.recordingIntervalId !== null) return;

    this.updateDiscTransform();
    this.drawCanvasFrame();
    this.recordingIntervalId = window.setInterval(() => {
      this.updateDiscTransform();
      this.drawCanvasFrame();
    }, 1000 / RECORDING_FPS);
  }

  private stopRecordingVisualLoop(): void {
    if (this.recordingIntervalId !== null) {
      window.clearInterval(this.recordingIntervalId);
      this.recordingIntervalId = null;
    }
  }

  private updateDiscTransform(): void {
    const angle = this.audio.currentTime * 0.72;
    this.disc.style.setProperty('--rotation-angle', `${angle}rad`);
  }

  private async startRecording(): Promise<void> {
    if (!this.audio.src) {
      this.setNotice('请先选择一个音频文件。', 'error');
      return;
    }

    this.recordBtn.disabled = true;
    try {
      if (Number.isFinite(this.audio.duration) && this.audio.currentTime >= this.audio.duration) {
        this.audio.currentTime = 0;
      }
      this.clearDownload();
      this.drawCanvasFrame();
      await this.audio.play();
      this.recorder.start(this.audio, this.canvas);
      this.recording = true;
      this.recordBtn.classList.add('is-recording');
      this.recordBtnLabel.textContent = '停止录制';
      this.recordBtn.disabled = false;
      this.recordStatus.textContent = '正在录制中';
      this.setNotice('录制进行中，播放结束或点击按钮即可停止。', 'success');
      this.updateVisualLoop();
    } catch (error) {
      this.recording = false;
      this.stopRecordingVisualLoop();
      this.recorder.cancel();
      this.recordBtn.classList.remove('is-recording');
      this.recordBtnLabel.textContent = '开始录制';
      this.recordBtn.disabled = !this.recorderSupported || !this.audio.src;
      const message = error instanceof Error ? error.message : '无法开始录制，请重试。';
      this.setNotice(message, 'error');
    }
  }

  private async stopRecording(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    this.stopRecordingVisualLoop();
    this.recordBtn.disabled = true;
    this.recordBtn.classList.remove('is-recording');
    this.recordBtnLabel.textContent = '开始录制';
    this.recordStatus.textContent = '正在生成视频…';
    this.updateVisualLoop();

    try {
      const result = await this.recorder.stop();
      const baseName = this.songTitle || 'music-video';

      if (result.format === 'mp4') {
        this.setDownloadLink(this.downloadLink, result.blob, `${baseName}.mp4`);
        this.recordStatus.textContent = 'MP4 视频已生成';
        this.setNotice('录制完成，点击右侧下载链接保存 MP4 视频。', 'success');
      } else {
        this.setDownloadLink(this.webmDownloadLink, result.blob, `${baseName}.webm`);
        this.recordStatus.textContent = '正在转换 MP4…';
        this.setNotice('WebM 已生成，正在转换为 MP4，请稍候。', 'neutral');

        try {
          const mp4Blob = await this.mp4Converter.convert(result.blob, (progress) => {
            this.recordStatus.textContent = `正在转换 MP4… ${Math.round(progress * 100)}%`;
          });
          this.setDownloadLink(this.downloadLink, mp4Blob, `${baseName}.mp4`);
          this.recordStatus.textContent = 'MP4 视频已生成';
          this.setNotice('MP4 转换完成，可下载 MP4；WebM 原文件也已保留。', 'success');
        } catch (error) {
          this.recordStatus.textContent = 'WebM 视频已生成';
          this.setNotice(error instanceof Error ? `MP4 转换失败，仍可下载 WebM：${error.message}` : 'MP4 转换失败，仍可下载 WebM。', 'error');
        }
      }
    } catch (error) {
      this.recordStatus.textContent = '录制失败';
      this.setNotice(error instanceof Error ? error.message : '视频生成失败，请重试。', 'error');
    } finally {
      this.recordBtn.disabled = !this.recorderSupported || !this.audio.src;
    }
  }

  private setNotice(message: string, tone: NoticeTone): void {
    this.notice.dataset.tone = tone;
    this.noticeText.textContent = message;
  }

  private clearDownload(): void {
    this.downloadLink.hidden = true;
    this.downloadLink.removeAttribute('href');
    this.webmDownloadLink.hidden = true;
    this.webmDownloadLink.removeAttribute('href');
    this.downloadUrls.forEach((url) => URL.revokeObjectURL(url));
    this.downloadUrls.clear();
  }

  private setDownloadLink(link: HTMLAnchorElement, blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    this.downloadUrls.add(url);
    link.href = url;
    link.download = filename;
    link.hidden = false;
  }

  private revokePreviousUrl(kind: 'audio' | 'cover'): void {
    const prefix = kind === 'audio' ? this.audio.src : this.coverImage.src;
    if (prefix && this.objectUrls.has(prefix)) {
      URL.revokeObjectURL(prefix);
      this.objectUrls.delete(prefix);
    }
  }

  private releaseObjectUrls(): void {
    this.clearDownload();
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
  }

  private drawCanvasFrame(): void {
    const ctx = this.context;
    const stageRect = this.playerStage.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0) return;

    this.syncCanvasSize(stageRect);
    const { width, height } = this.canvas;
    this.drawCanvasBackground(ctx, width, height);
    this.drawCanvasBorder(ctx, this.stageTopline, stageRect);
    this.drawCanvasElementText(ctx, this.stageLabel, stageRect);
    this.drawCanvasElementText(ctx, this.stageIndex, stageRect);
    this.drawCanvasSettingsIcon(ctx, stageRect);
    this.drawCanvasDisc(ctx, stageRect);
    this.drawCanvasElementText(ctx, this.playState, stageRect);
    this.drawCanvasRule(ctx, this.captionRule, stageRect);
    this.drawCanvasTrackInfo(ctx, stageRect);
    this.drawCanvasLyrics(ctx, stageRect);
  }

  private syncCanvasSize(stageRect: DOMRect): void {
    if (this.recording) return;

    const scale = Math.min(2, 1920 / stageRect.width, 1080 / stageRect.height);
    const width = Math.max(1, Math.round(stageRect.width * scale));
    const height = Math.max(1, Math.round(stageRect.height * scale));
    this.canvasScale = scale;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private drawCanvasBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#19151b');
    gradient.addColorStop(0.68, '#111014');
    gradient.addColorStop(1, '#1c1518');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.25, height * 0.54, 0, width * 0.25, height * 0.54, width * 0.44);
    glow.addColorStop(0, 'rgba(199, 120, 96, 0.17)');
    glow.addColorStop(1, 'rgba(199, 120, 96, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = Math.max(1, this.canvasScale);
    const gridSize = 42 * this.canvasScale;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCanvasElementText(ctx: CanvasRenderingContext2D, element: HTMLElement, stageRect: DOMRect): void {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const fontSize = Number.parseFloat(styles.fontSize) * this.canvasScale;
    const x = (rect.left - stageRect.left) * this.canvasScale;
    const y = (rect.top - stageRect.top) * this.canvasScale;
    ctx.save();
    ctx.fillStyle = styles.color;
    ctx.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(element.textContent?.trim() ?? '', x, y);
    ctx.restore();
  }

  private drawCanvasBorder(ctx: CanvasRenderingContext2D, element: HTMLElement, stageRect: DOMRect): void {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const borderWidth = Number.parseFloat(styles.borderBottomWidth) * this.canvasScale;
    if (borderWidth <= 0) return;
    ctx.save();
    ctx.strokeStyle = styles.borderBottomColor;
    ctx.lineWidth = borderWidth;
    ctx.beginPath();
    ctx.moveTo((rect.left - stageRect.left) * this.canvasScale, (rect.bottom - stageRect.top) * this.canvasScale);
    ctx.lineTo((rect.right - stageRect.left) * this.canvasScale, (rect.bottom - stageRect.top) * this.canvasScale);
    ctx.stroke();
    ctx.restore();
  }

  private drawCanvasRule(ctx: CanvasRenderingContext2D, element: HTMLElement, stageRect: DOMRect): void {
    const rect = element.getBoundingClientRect();
    ctx.save();
    ctx.fillStyle = getComputedStyle(element).backgroundColor;
    ctx.fillRect(
      (rect.left - stageRect.left) * this.canvasScale,
      (rect.top - stageRect.top) * this.canvasScale,
      rect.width * this.canvasScale,
      Math.max(1, rect.height * this.canvasScale),
    );
    ctx.restore();
  }

  private drawCanvasTrackInfo(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    const titleRect = this.trackTitle.getBoundingClientRect();
    const artistRect = this.trackArtist.getBoundingClientRect();
    const titleStyles = getComputedStyle(this.trackTitle);
    const artistStyles = getComputedStyle(this.trackArtist);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.fillStyle = titleStyles.color;
    ctx.font = `${titleStyles.fontWeight} ${Number.parseFloat(titleStyles.fontSize) * this.canvasScale}px ${titleStyles.fontFamily}`;
    ctx.fillText(
      this.songTitle,
      (titleRect.left - stageRect.left + titleRect.width / 2) * this.canvasScale,
      (titleRect.top - stageRect.top) * this.canvasScale,
    );

    ctx.fillStyle = artistStyles.color;
    ctx.font = `${artistStyles.fontWeight} ${Number.parseFloat(artistStyles.fontSize) * this.canvasScale}px ${artistStyles.fontFamily}`;
    ctx.fillText(
      this.artistName || '未识别歌手',
      (artistRect.left - stageRect.left + artistRect.width / 2) * this.canvasScale,
      (artistRect.top - stageRect.top) * this.canvasScale,
    );
    ctx.restore();
  }

  private drawCanvasSettingsIcon(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    const rect = this.settingsBtn.getBoundingClientRect();
    const centerX = (rect.left - stageRect.left + rect.width / 2) * this.canvasScale;
    const centerY = (rect.top - stageRect.top + rect.height / 2) * this.canvasScale;
    const radius = (rect.width / 2) * this.canvasScale;
    ctx.save();
    ctx.strokeStyle = 'rgba(202, 161, 109, 0.36)';
    ctx.lineWidth = Math.max(1, this.canvasScale);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(202, 161, 109, 0.7)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCanvasDisc(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    const rect = this.disc.getBoundingClientRect();
    // getBoundingClientRect() contains the rotated square's outer bounds, which
    // grows and shrinks as the angle changes. Use the untransformed layout size
    // so the recorded disc rotates at a constant diameter like the page preview.
    const layoutSize = Math.min(this.disc.offsetWidth, this.disc.offsetHeight);
    const size = layoutSize * this.canvasScale;
    const centerX = (rect.left - stageRect.left + rect.width / 2) * this.canvasScale;
    const centerY = (rect.top - stageRect.top + rect.height / 2) * this.canvasScale;
    const radius = size / 2;
    const angle = this.audio.currentTime * 0.72;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 42;
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(176, 166, 173, 0.17)';
    ctx.lineWidth = 2;
    for (let ring = 22; ring < radius - 5; ring += 15) {
      ctx.beginPath();
      ctx.arc(0, 0, ring, 0, Math.PI * 2);
      ctx.stroke();
    }

    const labelRadius = radius * 0.58;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
    ctx.clip();
    if (this.coverImage.complete && this.coverImage.naturalWidth > 0) {
      ctx.drawImage(this.coverImage, -labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
    } else {
      const coverGradient = ctx.createLinearGradient(-labelRadius, -labelRadius, labelRadius, labelRadius);
      coverGradient.addColorStop(0, '#b96f4c');
      coverGradient.addColorStop(0.5, '#4a293d');
      coverGradient.addColorStop(1, '#d7af78');
      ctx.fillStyle = coverGradient;
      ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
      ctx.fillStyle = 'rgba(14, 12, 15, 0.62)';
      ctx.font = '600 22px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('YOUR COVER', 0, 8);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    ctx.fillStyle = '#d9c7a8';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b161b';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCanvasLyrics(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    this.drawCanvasBorder(ctx, this.lyricsHeading, stageRect);
    this.drawCanvasElementText(ctx, this.lyricsLabel, stageRect);
    this.drawCanvasElementText(ctx, this.lyricsCount, stageRect);

    const viewportRect = this.lyricsViewport.getBoundingClientRect();
    const viewportX = (viewportRect.left - stageRect.left) * this.canvasScale;
    const viewportY = (viewportRect.top - stageRect.top) * this.canvasScale;
    const viewportWidth = viewportRect.width * this.canvasScale;
    const viewportHeight = viewportRect.height * this.canvasScale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(viewportX, viewportY, viewportWidth, viewportHeight);
    ctx.clip();

    const items = Array.from(this.lyricsList.children).filter((item): item is HTMLLIElement => item instanceof HTMLLIElement);
    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom) return;

      const styles = getComputedStyle(item);
      const fontSize = Number.parseFloat(styles.fontSize) * this.canvasScale;
      const paddingLeft = Number.parseFloat(styles.paddingLeft) * this.canvasScale;
      const x = (rect.left - stageRect.left) * this.canvasScale + paddingLeft;
      const lineCenterY = (rect.top - stageRect.top + rect.height / 2) * this.canvasScale;

      ctx.fillStyle = styles.color;
      ctx.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(item.textContent ?? '');
      const glyphCenterOffset = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      ctx.fillText(item.textContent ?? '', x, lineCenterY + glyphCenterOffset);

      if (item.classList.contains('active')) {
        const pseudo = getComputedStyle(item, '::before');
        const barWidth = (Number.parseFloat(pseudo.width) || 3) * this.canvasScale;
        const barHeight = (Number.parseFloat(pseudo.height) || Number.parseFloat(styles.fontSize) * 1.4) * this.canvasScale;
        const barTop = lineCenterY - barHeight / 2;
        ctx.fillStyle = pseudo.backgroundColor || '#c77860';
        ctx.fillRect((rect.left - stageRect.left) * this.canvasScale, barTop, barWidth, barHeight);
      }
    });
    ctx.restore();

    this.drawLyricsFade(ctx, viewportX, viewportY, viewportWidth, viewportHeight);
    this.drawCanvasFooter(ctx, stageRect);
  }

  private drawLyricsFade(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    const fade = ctx.createLinearGradient(0, y, 0, y + height);
    fade.addColorStop(0, 'rgba(17, 16, 20, 0.94)');
    fade.addColorStop(0.12, 'rgba(17, 16, 20, 0)');
    fade.addColorStop(0.88, 'rgba(17, 16, 20, 0)');
    fade.addColorStop(1, 'rgba(17, 16, 20, 0.94)');
    ctx.fillStyle = fade;
    ctx.fillRect(x, y, width, height);
  }

  private drawCanvasFooter(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    const pulse = this.lyricsFooter.querySelector<HTMLElement>('.footer-pulse');
    if (pulse) {
      const pulseRect = pulse.getBoundingClientRect();
      const centerX = (pulseRect.left - stageRect.left + pulseRect.width / 2) * this.canvasScale;
      const centerY = (pulseRect.top - stageRect.top + pulseRect.height / 2) * this.canvasScale;
      ctx.fillStyle = getComputedStyle(pulse).backgroundColor;
      ctx.beginPath();
      ctx.arc(centerX, centerY, (pulseRect.width / 2) * this.canvasScale, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawCanvasElementText(ctx, this.lyricsFooterText, stageRect);
  }
}
