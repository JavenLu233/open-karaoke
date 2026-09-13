import type { PlayerController } from '../hooks/use-player-controller';
import { formatTime } from '../lib/time';
import { ArrowLeftIcon, ArrowRightIcon, DotIcon, SettingsIcon } from './icons';
import { LyricsViewport } from './LyricsViewport';

interface PlayerStageProps {
  controller: PlayerController;
}

export function PlayerStage({ controller }: PlayerStageProps) {
  const { refs, actions } = controller;
  const coverReady = controller.coverName !== '选择 JPG / PNG';
  const offsetSeconds = Math.abs(controller.lyricsOffsetMs) / 1000;
  const offsetHint = controller.lyricsOffsetMs === 0
    ? '使用 LRC 原始时间'
    : controller.lyricsOffsetMs > 0 ? `歌词提前 ${offsetSeconds.toFixed(1)} 秒` : `歌词延后 ${offsetSeconds.toFixed(1)} 秒`;

  return (
    <section className="player-card" aria-label="播放器预览">
      <div id="playerStage" ref={refs.stage} className="player-stage canvas-preview">
        <canvas id="recordingCanvas" ref={refs.canvas} width="1920" height="1080" aria-hidden="true" />
        <div className="stage-grid" aria-hidden="true" />
        <div id="stageTopline" ref={refs.stageTopline} className="stage-topline">
          <span id="stageLabel" ref={refs.stageLabel}>NOW PLAYING</span>
          <div className="stage-actions">
            <span id="stageIndex" ref={refs.stageIndex} className="stage-index">A / SIDE 01</span>
            <button
              id="settingsBtn"
              ref={refs.settingsButton}
              className={`settings-button${controller.syncPanelOpen ? ' is-active' : ''}`}
              type="button"
              aria-label={controller.syncPanelOpen ? '关闭歌词对齐设置' : '打开歌词对齐设置'}
              aria-controls="syncPanel"
              aria-expanded={controller.syncPanelOpen}
              title="歌词对齐与导出设置"
              onClick={actions.toggleSyncPanel}
            >
              <SettingsIcon />
            </button>
          </div>
        </div>

        <div className="disc-column">
          <div className="disc-glow" aria-hidden="true" />
          <div id="disc" ref={refs.disc} className={`disc${controller.isPlaying ? ' is-playing' : ''}`} aria-label="黑胶唱片封面">
            <div className="disc-grooves" aria-hidden="true" />
            <div id="coverPlaceholder" className={`cover-placeholder${coverReady ? ' is-hidden' : ''}`}>
              <span>上传<br />封面</span>
            </div>
            <img id="coverImage" ref={refs.coverImage} className={coverReady ? 'is-visible' : undefined} alt="歌曲封面" />
            <div className="disc-center" aria-hidden="true"><span /></div>
          </div>
          <div className="disc-caption">
            <span ref={refs.captionRule} className="caption-rule" />
            <span id="playState" ref={refs.playState}>{controller.isPlaying ? '正在播放' : controller.currentTime > 0 ? '已暂停' : '等待音频'}</span>
          </div>
          <div className="track-info" aria-label="歌曲信息">
            <strong id="trackTitle" ref={refs.trackTitle}>{controller.title}</strong>
            <span id="trackArtist" ref={refs.trackArtist}>{controller.artist || '未识别歌手'}</span>
          </div>
        </div>

        <div className="lyrics-column">
          <div id="lyricsHeading" ref={refs.lyricsHeading} className="lyrics-heading">
            <span id="lyricsLabel" ref={refs.lyricsLabel}>LYRICS</span>
            <span id="lyricsCount" ref={refs.lyricsCount}>{controller.lyrics.length} LINES</span>
          </div>
          <LyricsViewport lyrics={controller.lyrics} activeIndex={controller.activeLyricIndex} refs={refs} />
          <div id="lyricsFooter" ref={refs.lyricsFooter} className="lyrics-footer" aria-hidden="true">
            <span className="footer-pulse"><DotIcon /></span>
            <span id="lyricsFooterText" ref={refs.lyricsFooterText}>SYNCED TO AUDIO</span>
          </div>
        </div>
      </div>

      <div id="syncPanel" className="sync-panel" hidden={!controller.syncPanelOpen}>
        <div className="sync-panel-heading">
          <div><span className="panel-kicker">DEBUG / SYNC</span><h3>歌词时间微调</h3></div>
          <button className="sync-reset" type="button" onClick={actions.resetOffset}>重置</button>
        </div>
        <p className="sync-panel-copy">当音频与 LRC 总时长不一致时，用左右按钮调整歌词相对音频的显示时间。</p>
        <div className="sync-tuning">
          <button className="sync-adjust" type="button" onClick={() => actions.adjustOffset(100)}><ArrowLeftIcon /><span>提前 0.1s</span></button>
          <div className="sync-offset" aria-live="polite"><span className="sync-offset-label">当前偏移</span><strong>{controller.lyricsOffsetMs > 0 ? '+' : ''}{controller.lyricsOffsetMs} ms</strong><small>{offsetHint}</small></div>
          <button className="sync-adjust" type="button" onClick={() => actions.adjustOffset(-100)}><span>延后 0.1s</span><ArrowRightIcon /></button>
        </div>
        <div className="sync-saved-note">调整会自动保存到当前浏览器</div>
        <div className="export-settings">
          <div className="export-settings-heading"><div><span className="panel-kicker">VIDEO OUTPUT</span><h3>导出设置</h3></div><span className="export-settings-note">录制开始后锁定</span></div>
          <div className="export-options">
            <label className="export-field" htmlFor="recordingFps"><span>帧率</span><select id="recordingFps" value={controller.recordingSettings.fps} disabled={controller.recording} onChange={(event) => actions.setRecordingSettings({ fps: Number(event.target.value) })}><option value="24">24 FPS · 流畅</option><option value="30">30 FPS · 标准</option><option value="60">60 FPS · 高帧率</option></select></label>
            <label className="export-field" htmlFor="recordingResolution"><span>分辨率</span><select id="recordingResolution" value={`${controller.recordingSettings.width}x${controller.recordingSettings.height}`} disabled={controller.recording} onChange={(event) => { const [width, height] = event.target.value.split('x').map(Number); actions.setRecordingSettings({ width, height }); }}><option value="1280x720">HD · 1280 × 720</option><option value="1920x1080">Full HD · 1920 × 1080</option><option value="2560x1440">2K · 2560 × 1440</option></select></label>
          </div>
        </div>
      </div>

      <div className="player-controls">
        <audio ref={refs.audio} controls preload="metadata" />
        <div className="control-toolbar">
          <div className="time-readout" aria-label="播放进度"><span>{formatTime(controller.currentTime)}</span><span className="time-divider">/</span><span>{formatTime(controller.duration)}</span></div>
          <div className="record-actions">
            <span className="record-status">{controller.recordStatus}</span>
            <button className={`record-button${controller.recording ? ' is-recording' : ''}`} type="button" disabled={controller.recordBusy || !controller.recorderSupported || controller.audioName === '选择 MP3 / OGG / WAV'} onClick={actions.startOrStopRecording}>
              <svg className="record-icon" viewBox="0 0 10 10" aria-hidden="true"><circle className="record-ready" cx="5" cy="5" r="3.5" /><rect className="record-stop" x="2" y="2" width="6" height="6" rx="1" /></svg>
              <span>{controller.recording ? '停止录制' : '开始录制'}</span>
            </button>
            {controller.download.mp4 && <a className="download-link" href={controller.download.mp4} download={controller.downloadNames.mp4}>下载 MP4</a>}
            {controller.download.webm && <a className="download-link" href={controller.download.webm} download={controller.downloadNames.webm}>下载 WebM</a>}
          </div>
        </div>
      </div>
    </section>
  );
}
