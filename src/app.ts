import { findActiveLyricIndex, parseLrc } from './lib/lrc';
import { formatTime } from './lib/time';
import {
  DEFAULT_RECORDING_SETTINGS,
  MediaRecorderService,
  RECORDING_FPS_OPTIONS,
  RECORDING_RESOLUTION_OPTIONS,
  getRecorderCapabilities,
  type RecordingSettings,
} from './services/media-recorder';
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

function createSvgIcon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
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
  private readonly recordingFpsSelect = getElement<HTMLSelectElement>('recordingFps');
  private readonly recordingResolutionSelect = getElement<HTMLSelectElement>('recordingResolution');
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
  private readonly assetHistoryControls = getElement<HTMLElement>('assetHistoryControls');
  private readonly historyPageSizeSelect = getElement<HTMLSelectElement>('historyPageSize');
  private readonly historyPrevBtn = getElement<HTMLButtonElement>('historyPrevBtn');
  private readonly historyNextBtn = getElement<HTMLButtonElement>('historyNextBtn');
  private readonly historyPageStatus = getElement<HTMLElement>('historyPageStatus');
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
  private canvasOffsetX = 0;
  private canvasOffsetY = 0;
  private lyricsOffsetMs = this.restoreLyricsOffset();
  private recordingSettings = this.restoreRecordingSettings();
  private historyPage = 1;
  private historyPageSize = 5;

  private static readonly lyricsOffsetStorageKey = 'vinyl-lyrics-video:lyrics-offset-ms';
  private static readonly lyricsOffsetStepMs = 100;
  private static readonly lyricsOffsetLimitMs = 5000;
  private static readonly recordingSettingsStorageKey = 'open-karaoke:recording-settings';

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
    this.syncRecordingSettingsUi();
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
    this.recordingFpsSelect.addEventListener('change', () => {
      this.updateRecordingSettings({ fps: Number.parseInt(this.recordingFpsSelect.value, 10) });
    });
    this.recordingResolutionSelect.addEventListener('change', () => {
      const resolution = RECORDING_RESOLUTION_OPTIONS.find(
        (option) => option.value === this.recordingResolutionSelect.value,
      );
      if (resolution) this.updateRecordingSettings(resolution);
    });
    this.historyPageSizeSelect.addEventListener('change', () => {
      const pageSize = Number.parseInt(this.historyPageSizeSelect.value, 10);
      if (![5, 10, 20].includes(pageSize)) return;
      this.historyPageSize = pageSize;
      this.historyPage = 1;
      this.renderAssetHistory();
    });
    this.historyPrevBtn.addEventListener('click', () => this.changeHistoryPage(-1));
    this.historyNextBtn.addEventListener('click', () => this.changeHistoryPage(1));
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
      this.historyPage = 1;
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
    const allEntries = this.assetHistory.list();
    const pageCount = Math.max(1, Math.ceil(allEntries.length / this.historyPageSize));
    this.historyPage = Math.max(1, Math.min(pageCount, this.historyPage));
    const start = (this.historyPage - 1) * this.historyPageSize;
    const entries = allEntries.slice(start, start + this.historyPageSize);

    this.assetHistoryControls.hidden = allEntries.length <= 5;
    this.historyPageSizeSelect.value = String(this.historyPageSize);
    this.historyPageStatus.textContent = `${this.historyPage} / ${pageCount}`;
    this.historyPrevBtn.disabled = this.historyPage <= 1;
    this.historyNextBtn.disabled = this.historyPage >= pageCount;
    this.assetHistoryList.replaceChildren();

    if (allEntries.length === 0) {
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
      remove.append(createSvgIcon('M6 18 18 6M6 6l12 12'));

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

  private restoreRecordingSettings(): RecordingSettings {
    try {
      const storedValue = localStorage.getItem(PlayerApp.recordingSettingsStorageKey);
      if (storedValue) {
        const parsed = JSON.parse(storedValue) as Partial<RecordingSettings>;
        const fps = RECORDING_FPS_OPTIONS.find((option) => option === parsed.fps);
        const resolution = RECORDING_RESOLUTION_OPTIONS.find(
          (option) => option.width === parsed.width && option.height === parsed.height,
        );
        if (fps && resolution) return { fps, width: resolution.width, height: resolution.height };
      }
    } catch {
      // localStorage may be unavailable in a restricted browser context.
    }
    return { ...DEFAULT_RECORDING_SETTINGS };
  }

  private syncRecordingSettingsUi(): void {
    this.recordingFpsSelect.value = String(this.recordingSettings.fps);
    this.recordingResolutionSelect.value = `${this.recordingSettings.width}x${this.recordingSettings.height}`;
  }

  private updateRecordingSettings(changes: Partial<RecordingSettings>): void {
    if (this.recording) {
      this.syncRecordingSettingsUi();
      return;
    }

    const fps = RECORDING_FPS_OPTIONS.find((option) => option === changes.fps) ?? this.recordingSettings.fps;
    const resolution = RECORDING_RESOLUTION_OPTIONS.find(
      (option) => option.width === changes.width && option.height === changes.height,
    ) ?? RECORDING_RESOLUTION_OPTIONS.find(
      (option) => option.width === this.recordingSettings.width && option.height === this.recordingSettings.height,
    ) ?? RECORDING_RESOLUTION_OPTIONS[1];
    this.recordingSettings = { fps, width: resolution.width, height: resolution.height };
    this.syncRecordingSettingsUi();
    try {
      localStorage.setItem(PlayerApp.recordingSettingsStorageKey, JSON.stringify(this.recordingSettings));
    } catch {
      // Keep the preference active for the current session when persistence is unavailable.
    }
    this.setNotice(`导出设置已更新：${fps} FPS · ${resolution.width} × ${resolution.height}`, 'neutral');
  }

  private changeHistoryPage(delta: number): void {
    const pageCount = Math.max(1, Math.ceil(this.assetHistory.list().length / this.historyPageSize));
    this.historyPage = Math.max(1, Math.min(pageCount, this.historyPage + delta));
    this.renderAssetHistory();
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
    }, 1000 / this.recordingSettings.fps);
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
    this.setRecordingSettingsDisabled(true);
    this.recording = true;
    try {
      if (Number.isFinite(this.audio.duration) && this.audio.currentTime >= this.audio.duration) {
        this.audio.currentTime = 0;
      }
      this.clearDownload();
      this.syncRecordingCanvasSize(this.playerStage.getBoundingClientRect());
      this.drawCanvasFrame();
      await this.audio.play();
      this.recorder.start(this.audio, this.canvas, this.recordingSettings);
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
      this.restorePreviewCanvasSize();
      this.recordBtn.classList.remove('is-recording');
      this.recordBtnLabel.textContent = '开始录制';
      this.recordBtn.disabled = !this.recorderSupported || !this.audio.src;
      this.setRecordingSettingsDisabled(false);
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
      this.restorePreviewCanvasSize();
      this.recordBtn.disabled = !this.recorderSupported || !this.audio.src;
      this.setRecordingSettingsDisabled(false);
      this.updateVisualLoop();
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
    this.canvasOffsetX = 0;
    this.canvasOffsetY = 0;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private syncRecordingCanvasSize(stageRect: DOMRect): void {
    const { width, height } = this.recordingSettings;
    const scale = Math.min(width / stageRect.width, height / stageRect.height);
    this.canvasScale = scale;
    this.canvasOffsetX = (width - stageRect.width * scale) / 2;
    this.canvasOffsetY = (height - stageRect.height * scale) / 2;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private restorePreviewCanvasSize(): void {
    const stageRect = this.playerStage.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0) return;
    this.syncCanvasSize(stageRect);
    this.drawCanvasFrame();
  }

  private setRecordingSettingsDisabled(disabled: boolean): void {
    this.recordingFpsSelect.disabled = disabled;
    this.recordingResolutionSelect.disabled = disabled;
  }

  private canvasX(clientX: number, stageRect: DOMRect): number {
    return (clientX - stageRect.left) * this.canvasScale + this.canvasOffsetX;
  }

  private canvasY(clientY: number, stageRect: DOMRect): number {
    return (clientY - stageRect.top) * this.canvasScale + this.canvasOffsetY;
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
    const x = this.canvasX(rect.left, stageRect);
    const centerY = this.canvasY(rect.top + rect.height / 2, stageRect);
    ctx.save();
    ctx.fillStyle = styles.color;
    ctx.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const text = element.textContent?.trim() ?? '';
    const metrics = ctx.measureText(text);
    const glyphCenterOffset = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    ctx.fillText(text, x, centerY + glyphCenterOffset);
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
    ctx.moveTo(this.canvasX(rect.left, stageRect), this.canvasY(rect.bottom, stageRect));
    ctx.lineTo(this.canvasX(rect.right, stageRect), this.canvasY(rect.bottom, stageRect));
    ctx.stroke();
    ctx.restore();
  }

  private drawCanvasRule(ctx: CanvasRenderingContext2D, element: HTMLElement, stageRect: DOMRect): void {
    const rect = element.getBoundingClientRect();
    ctx.save();
    ctx.fillStyle = getComputedStyle(element).backgroundColor;
    ctx.fillRect(
      this.canvasX(rect.left, stageRect),
      this.canvasY(rect.top, stageRect),
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
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = titleStyles.color;
    ctx.font = `${titleStyles.fontWeight} ${Number.parseFloat(titleStyles.fontSize) * this.canvasScale}px ${titleStyles.fontFamily}`;
    const titleMetrics = ctx.measureText(this.songTitle);
    ctx.fillText(
      this.songTitle,
      this.canvasX(titleRect.left + titleRect.width / 2, stageRect),
      this.canvasY(titleRect.top + titleRect.height / 2, stageRect)
        + (titleMetrics.actualBoundingBoxAscent - titleMetrics.actualBoundingBoxDescent) / 2,
    );

    ctx.fillStyle = artistStyles.color;
    ctx.font = `${artistStyles.fontWeight} ${Number.parseFloat(artistStyles.fontSize) * this.canvasScale}px ${artistStyles.fontFamily}`;
    const artistText = this.artistName || '未识别歌手';
    const artistMetrics = ctx.measureText(artistText);
    ctx.fillText(
      artistText,
      this.canvasX(artistRect.left + artistRect.width / 2, stageRect),
      this.canvasY(artistRect.top + artistRect.height / 2, stageRect)
        + (artistMetrics.actualBoundingBoxAscent - artistMetrics.actualBoundingBoxDescent) / 2,
    );
    ctx.restore();
  }

  private drawCanvasSettingsIcon(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    const rect = this.settingsBtn.getBoundingClientRect();
    const centerX = this.canvasX(rect.left + rect.width / 2, stageRect);
    const centerY = this.canvasY(rect.top + rect.height / 2, stageRect);
    const radius = (rect.width / 2) * this.canvasScale;
    const active = this.settingsBtn.classList.contains('is-active');
    const iconPath = new Path2D('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z');
    const innerPath = new Path2D('M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z');
    ctx.save();
    ctx.strokeStyle = active ? 'rgba(199, 120, 96, 0.72)' : 'rgba(202, 161, 109, 0.36)';
    ctx.lineWidth = Math.max(1, this.canvasScale);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    const iconSize = 14 * this.canvasScale;
    const iconScale = iconSize / 24;
    ctx.translate(centerX - iconSize / 2, centerY - iconSize / 2);
    ctx.scale(iconScale, iconScale);
    ctx.strokeStyle = active ? 'rgba(199, 120, 96, 0.92)' : 'rgba(202, 161, 109, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(iconPath);
    ctx.stroke(innerPath);
    ctx.restore();
  }

  private drawCanvasDisc(ctx: CanvasRenderingContext2D, stageRect: DOMRect): void {
    const rect = this.disc.getBoundingClientRect();
    // getBoundingClientRect() contains the rotated square's outer bounds, which
    // grows and shrinks as the angle changes. Use the untransformed layout size
    // so the recorded disc rotates at a constant diameter like the page preview.
    const layoutSize = Math.min(this.disc.offsetWidth, this.disc.offsetHeight);
    const size = layoutSize * this.canvasScale;
    const centerX = this.canvasX(rect.left + rect.width / 2, stageRect);
    const centerY = this.canvasY(rect.top + rect.height / 2, stageRect);
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
    const viewportX = this.canvasX(viewportRect.left, stageRect);
    const viewportY = this.canvasY(viewportRect.top, stageRect);
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
      const x = this.canvasX(rect.left, stageRect) + paddingLeft;
      const lineCenterY = this.canvasY(rect.top + rect.height / 2, stageRect);

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
        ctx.fillRect(this.canvasX(rect.left, stageRect), barTop, barWidth, barHeight);
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
      const centerX = this.canvasX(pulseRect.left + pulseRect.width / 2, stageRect);
      const centerY = this.canvasY(pulseRect.top + pulseRect.height / 2, stageRect);
      ctx.fillStyle = getComputedStyle(pulse).color;
      ctx.beginPath();
      ctx.arc(centerX, centerY, (pulseRect.width / 2) * this.canvasScale, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawCanvasElementText(ctx, this.lyricsFooterText, stageRect);
  }
}
