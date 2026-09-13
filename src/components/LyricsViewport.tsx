import { useLayoutEffect, useRef } from 'react';
import type { LyricLine } from '../types';
import type { PlayerRefs } from '../hooks/use-player-controller';

interface LyricsViewportProps {
  lyrics: LyricLine[];
  activeIndex: number;
  refs: PlayerRefs;
}

export function LyricsViewport({ lyrics, activeIndex, refs }: LyricsViewportProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const viewport = refs.lyricsViewport.current;
    const track = trackRef.current;
    const list = refs.lyricsList.current;
    if (!viewport || !track || !list) return;
    const activeItem = list.children[activeIndex] as HTMLElement | undefined;
    if (!activeItem) {
      track.style.transform = 'translateY(0)';
      return;
    }
    const frame = requestAnimationFrame(() => {
      const maxOffset = Math.max(0, track.scrollHeight - viewport.clientHeight);
      const itemCenter = activeItem.offsetTop + activeItem.offsetHeight / 2;
      const paddingTop = Number.parseFloat(getComputedStyle(viewport).paddingTop) || 0;
      const targetOffset = Math.max(0, Math.min(maxOffset, itemCenter + paddingTop - viewport.clientHeight / 2));
      track.style.transform = `translateY(-${targetOffset}px)`;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, lyrics.length, refs.lyricsList, refs.lyricsViewport]);

  return (
    <div id="lyricsViewport" ref={refs.lyricsViewport} className="lyrics-viewport">
      <div ref={trackRef} className="lyrics-track">
        <ul id="lyricsList" ref={refs.lyricsList} className="lyrics-list" aria-live="polite">
          {lyrics.length === 0 ? (
            <li className="lyrics-empty">载入 LRC 歌词后<br />歌词会在这里同步出现</li>
          ) : lyrics.map((line, index) => (
            <li key={`${line.time}-${index}`} className={index === activeIndex ? 'active' : undefined} aria-current={index === activeIndex ? 'true' : undefined}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
