import { usePlayerController } from '../hooks/use-player-controller';
import { AssetPanel } from './AssetPanel';
import { DotIcon, MicIcon } from './icons';
import { PlayerStage } from './PlayerStage';

export function App() {
  const controller = usePlayerController();

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Open Karaoke 首页">
          <span className="brand-mark"><MicIcon /></span>
          <span>OPEN<span className="brand-muted">/</span>KARAOKE</span>
        </a>
        <div className="topbar-meta"><span className="live-dot"><DotIcon /></span><span>LOCAL STUDIO</span></div>
      </header>

      <main className="workspace">
        <section className="intro-section" aria-labelledby="pageTitle">
          <div><p className="eyebrow">MUSIC VIDEO MAKER <span>·</span> 01</p><h1 id="pageTitle">歌词，随<em>旋律</em>流动。</h1><p className="intro-copy">载入你的音乐、封面和 LRC 歌词，在浏览器里实时预览并录制一支黑胶歌词视频。</p></div>
          <div className="intro-note"><span className="note-line" /><span>建议使用 Chrome / Edge<br />录制需要 localhost 或 HTTPS</span></div>
        </section>
        <section className="studio-grid" aria-label="歌词视频工作台">
          <PlayerStage controller={controller} />
          <AssetPanel controller={controller} />
        </section>
      </main>

      <footer className="app-footer"><span>OPEN / KARAOKE</span><span>CLIENT-SIDE ONLY · YOUR FILES STAY IN THIS BROWSER</span></footer>
    </div>
  );
}
