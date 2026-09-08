import type { LyricLine } from '../types';

export class LyricsView {
  private readonly viewport: HTMLElement;
  private readonly track: HTMLElement;
  private readonly list: HTMLUListElement;
  private items: HTMLLIElement[] = [];

  constructor(viewport: HTMLElement, track: HTMLElement, list: HTMLUListElement) {
    this.viewport = viewport;
    this.track = track;
    this.list = list;
  }

  setLines(lines: LyricLine[]): void {
    this.list.replaceChildren();
    this.track.style.transform = 'translateY(0)';
    this.items = [];

    if (lines.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'lyrics-empty';
      emptyItem.innerHTML = '没有找到有效歌词<br />请检查 LRC 时间格式';
      this.list.append(emptyItem);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const item = document.createElement('li');
      item.textContent = line.text;
      fragment.append(item);
      this.items.push(item);
    }
    this.list.append(fragment);
  }

  setActiveIndex(index: number): void {
    this.items.forEach((item, itemIndex) => {
      const isActive = itemIndex === index;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });

    const activeItem = this.items[index];
    if (!activeItem) {
      this.track.style.transform = 'translateY(0)';
      return;
    }

    requestAnimationFrame(() => {
      const maxOffset = Math.max(0, this.track.scrollHeight - this.viewport.clientHeight);
      const itemCenter = activeItem.offsetTop + activeItem.offsetHeight / 2;
      const paddingTop = Number.parseFloat(getComputedStyle(this.viewport).paddingTop) || 0;
      const targetOffset = Math.max(
        0,
        Math.min(maxOffset, itemCenter + paddingTop - this.viewport.clientHeight / 2),
      );
      this.track.style.transform = `translateY(-${targetOffset}px)`;
    });
  }
}
