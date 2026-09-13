import type { ChangeEvent, ReactNode } from 'react';
import type { PlayerController } from '../hooks/use-player-controller';
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CloseIcon, DocumentIcon, DotIcon, HelpIcon, ImageIcon, MusicIcon } from './icons';

interface AssetPanelProps {
  controller: PlayerController;
}

export function AssetPanel({ controller }: AssetPanelProps) {
  const { actions } = controller;
  const onFile = (kind: 'audio' | 'cover' | 'lyrics') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (kind === 'audio') actions.loadAudio(file);
    else if (kind === 'cover') actions.loadCover(file);
    else void actions.loadLyrics(file);
    event.target.value = '';
  };

  return (
    <aside className="asset-panel" aria-labelledby="assetTitle">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">01 / INPUTS</p>
          <div className="panel-title-row">
            <h2 id="assetTitle">准备素材</h2>
            <span className="asset-help">
              <button className="asset-help-button" type="button" aria-label="查看素材网站推荐" title="素材网站推荐"><HelpIcon /></button>
              <span className="asset-help-tooltip" role="tooltip">
                <strong>需要伴奏或歌词？</strong>
                <span>可以到这些网站搜索素材：</span>
                <a href="https://5sing.kugou.com/index.html" target="_blank" rel="noreferrer">5sing 音乐<ArrowUpRightIcon /></a>
                <a href="https://ufanv.cn/lyric" target="_blank" rel="noreferrer">歌词网<ArrowUpRightIcon /></a>
              </span>
            </span>
          </div>
        </div>
        <span className="panel-badge">LOCAL</span>
      </div>

      <div className="upload-list">
        <UploadRow number="01" label="音乐文件" name={controller.audioName} icon={<MusicIcon />} id="audioFile" accept="audio/mpeg,audio/ogg,audio/wav,audio/*" onChange={onFile('audio')} />
        <UploadRow number="02" label="封面图片" name={controller.coverName} icon={<ImageIcon />} id="coverFile" accept="image/jpeg,image/png,image/webp,image/*" onChange={onFile('cover')} />
        <UploadRow number="03" label="歌词文件" name={controller.lyricsName} icon={<DocumentIcon />} id="lyricsFile" accept=".lrc,text/plain" onChange={onFile('lyrics')} />
      </div>

      <div className="track-meta" aria-labelledby="trackMetaTitle">
        <div className="track-meta-heading"><div><p className="panel-kicker">TRACK INFO</p><h3 id="trackMetaTitle">歌曲信息</h3></div><span className="panel-badge">EDITABLE</span></div>
        <label className="track-field" htmlFor="songTitleInput"><span>歌名</span><input id="songTitleInput" type="text" maxLength={80} placeholder="输入歌名" value={controller.title} onChange={(event) => actions.setTitle(event.target.value)} /></label>
        <label className="track-field" htmlFor="artistNameInput"><span>歌手</span><input id="artistNameInput" type="text" maxLength={80} placeholder="输入歌手名" value={controller.artist} onChange={(event) => actions.setArtist(event.target.value)} /></label>
        <p className="track-meta-hint">默认按“歌手 - 歌名”识别文件名；也会优先读取 LRC 的 ti / ar 信息。</p>
      </div>

      <HistorySection controller={controller} />

      <div className="notice" data-tone={controller.notice.tone} role="status" aria-live="polite"><span className="notice-dot"><DotIcon /></span><span>{controller.notice.message}</span></div>

      <div className="workflow-guide">
        <p className="panel-kicker">QUICK GUIDE</p>
        <ol>
          <li><span>1</span>载入三份素材</li>
          <li><span>2</span>点击播放，检查歌词同步</li>
          <li><span>3</span>歌词有偏移？点击右上角齿轮，在下方自行调节时间轴</li>
          <li><span>4</span>点击录制并下载视频</li>
        </ol>
      </div>
    </aside>
  );
}

interface UploadRowProps {
  number: string;
  label: string;
  name: string;
  id: string;
  accept: string;
  icon: ReactNode;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function UploadRow({ number, label, name, id, accept, icon, onChange }: UploadRowProps) {
  return (
    <label className="upload-row" htmlFor={id}>
      <span className="upload-number">{number}</span>
      <span className="upload-icon">{icon}</span>
      <span className="upload-copy"><strong>{label}</strong><small>{name}</small></span>
      <span className="upload-arrow"><ArrowUpRightIcon /></span>
      <input id={id} type="file" accept={accept} onChange={onChange} />
    </label>
  );
}

function HistorySection({ controller }: AssetPanelProps) {
  const { actions } = controller;
  const showPagination = controller.historyEntries.length > 5;
  return (
    <div className="asset-history" aria-labelledby="assetHistoryTitle">
      <div className="asset-history-heading"><div><p className="panel-kicker">HISTORY</p><h3 id="assetHistoryTitle">素材记录</h3></div><span className="panel-badge">LOCAL</span></div>
      <div className="asset-history-actions"><button className="history-button history-button-primary" type="button" disabled={!controller.supportsHistory} onClick={() => void actions.rememberAssets()}>选择并记忆素材</button><button className="history-button" type="button" disabled={!controller.canSaveHistory} onClick={() => void actions.saveHistory()}>保存当前素材组</button></div>
      <p className="asset-history-hint">{controller.supportsHistory ? '列表保存在当前浏览器；记忆导入保存文件句柄，普通导入保存本地副本。' : '当前浏览器不支持记忆文件句柄，请使用最新版 Chrome / Edge。'}</p>
      <div className="asset-history-list" aria-live="polite">
        {controller.historyEntries.length === 0 ? <p className="asset-history-empty">还没有保存的素材组。</p> : controller.visibleHistoryEntries.map((entry) => <HistoryItem key={entry.id} entry={entry} onRestore={() => void actions.restoreHistory(entry.id)} onDelete={() => void actions.deleteHistory(entry.id)} />)}
      </div>
      {showPagination && <div className="asset-history-controls">
        <label className="history-page-size" htmlFor="historyPageSize"><span>每页</span><select id="historyPageSize" value={controller.historyPageSize} onChange={(event) => actions.setHistoryPageSize(Number(event.target.value))}><option value="5">5 条</option><option value="10">10 条</option><option value="20">20 条</option></select></label>
        <div className="history-pagination" aria-label="素材历史记录分页"><button type="button" aria-label="上一页" disabled={controller.historyPage <= 1} onClick={() => actions.setHistoryPage(controller.historyPage - 1)}><ArrowLeftIcon /></button><span>{controller.historyPage} / {controller.historyPageCount}</span><button type="button" aria-label="下一页" disabled={controller.historyPage >= controller.historyPageCount} onClick={() => actions.setHistoryPage(controller.historyPage + 1)}><ArrowRightIcon /></button></div>
      </div>}
    </div>
  );
}

function HistoryItem({ entry, onRestore, onDelete }: { entry: PlayerController['historyEntries'][number]; onRestore: () => void; onDelete: () => void }) {
  const offset = typeof entry.lyricsOffsetMs === 'number' && Number.isFinite(entry.lyricsOffsetMs) ? `${entry.lyricsOffsetMs > 0 ? '+' : ''}${entry.lyricsOffsetMs} ms` : '0 ms';
  return <article className="asset-history-item"><span className="asset-history-copy"><button className="asset-history-restore" type="button" onClick={onRestore}>{entry.label}</button><span className="asset-history-state">{entry.artistName || '未识别歌手'} · 歌词偏移 {offset}</span><span className="asset-history-files">{entry.audioName} · {entry.coverName} · {entry.lyricsName}</span></span><button className="asset-history-delete" type="button" aria-label={`删除历史素材组 ${entry.label}`} onClick={onDelete}><CloseIcon /></button></article>;
}
