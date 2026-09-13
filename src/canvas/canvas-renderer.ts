import type { LyricLine } from '../types';
import type { RecordingSettings } from '../services/media-recorder';

export interface CanvasElements {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  stageTopline: HTMLElement;
  stageLabel: HTMLElement;
  stageIndex: HTMLElement;
  settingsButton: HTMLElement;
  disc: HTMLElement;
  coverImage: HTMLImageElement;
  captionRule: HTMLElement;
  playState: HTMLElement;
  trackTitle: HTMLElement;
  trackArtist: HTMLElement;
  lyricsHeading: HTMLElement;
  lyricsLabel: HTMLElement;
  lyricsCount: HTMLElement;
  lyricsViewport: HTMLElement;
  lyricsList: HTMLUListElement;
  lyricsFooter: HTMLElement;
  lyricsFooterText: HTMLElement;
}

export interface CanvasState {
  lyrics: LyricLine[];
  currentTime: number;
  title: string;
  artist: string;
  recording: boolean;
  settingsOpen: boolean;
  recordingSettings: RecordingSettings;
}

interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function finiteStyleValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  element: HTMLElement,
  stageRect: DOMRect,
  transform: CanvasTransform,
  text = element.textContent?.trim() ?? '',
): void {
  if (!text) return;
  const rect = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  const fontSize = finiteStyleValue(styles.fontSize, 12) * transform.scale;
  const x = (rect.left - stageRect.left) * transform.scale + transform.offsetX;
  const centerY = (rect.top + rect.height / 2 - stageRect.top) * transform.scale + transform.offsetY;

  ctx.save();
  ctx.fillStyle = styles.color;
  ctx.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
  ctx.textAlign = styles.textAlign === 'center' ? 'center' : 'left';
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(text);
  const glyphOffset = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  const drawX = ctx.textAlign === 'center' ? x + (rect.width * transform.scale) / 2 : x;
  ctx.fillText(text, drawX, centerY + glyphOffset);
  ctx.restore();
}

function drawBorder(ctx: CanvasRenderingContext2D, element: HTMLElement, stageRect: DOMRect, transform: CanvasTransform): void {
  const rect = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  const width = finiteStyleValue(styles.borderBottomWidth, 0) * transform.scale;
  if (width <= 0) return;
  ctx.save();
  ctx.strokeStyle = styles.borderBottomColor;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo((rect.left - stageRect.left) * transform.scale + transform.offsetX, (rect.bottom - stageRect.top) * transform.scale + transform.offsetY);
  ctx.lineTo((rect.right - stageRect.left) * transform.scale + transform.offsetX, (rect.bottom - stageRect.top) * transform.scale + transform.offsetY);
  ctx.stroke();
  ctx.restore();
}

function drawRule(ctx: CanvasRenderingContext2D, element: HTMLElement, stageRect: DOMRect, transform: CanvasTransform): void {
  const rect = element.getBoundingClientRect();
  ctx.save();
  ctx.fillStyle = getComputedStyle(element).backgroundColor;
  ctx.fillRect(
    (rect.left - stageRect.left) * transform.scale + transform.offsetX,
    (rect.top - stageRect.top) * transform.scale + transform.offsetY,
    rect.width * transform.scale,
    Math.max(1, rect.height * transform.scale),
  );
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
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
  ctx.lineWidth = 1;
  const gridSize = Math.max(24, width / 46);
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

function canvasX(clientX: number, stageRect: DOMRect, transform: CanvasTransform): number {
  return (clientX - stageRect.left) * transform.scale + transform.offsetX;
}

function canvasY(clientY: number, stageRect: DOMRect, transform: CanvasTransform): number {
  return (clientY - stageRect.top) * transform.scale + transform.offsetY;
}

function drawDisc(ctx: CanvasRenderingContext2D, elements: CanvasElements, stageRect: DOMRect, transform: CanvasTransform, currentTime: number): void {
  const rect = elements.disc.getBoundingClientRect();
  const layoutSize = Math.min(elements.disc.offsetWidth, elements.disc.offsetHeight);
  const radius = (layoutSize * transform.scale) / 2;
  const centerX = canvasX(rect.left + rect.width / 2, stageRect, transform);
  const centerY = canvasY(rect.top + rect.height / 2, stageRect, transform);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(currentTime * 0.72);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 42 * transform.scale;
  ctx.fillStyle = '#050505';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(176, 166, 173, 0.17)';
  ctx.lineWidth = Math.max(1, 2 * transform.scale);
  for (let ring = 22 * transform.scale; ring < radius - 5 * transform.scale; ring += 15 * transform.scale) {
    ctx.beginPath();
    ctx.arc(0, 0, ring, 0, Math.PI * 2);
    ctx.stroke();
  }

  const labelRadius = radius * 0.58;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
  ctx.clip();
  if (elements.coverImage.complete && elements.coverImage.naturalWidth > 0) {
    ctx.drawImage(elements.coverImage, -labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
  } else {
    const coverGradient = ctx.createLinearGradient(-labelRadius, -labelRadius, labelRadius, labelRadius);
    coverGradient.addColorStop(0, '#b96f4c');
    coverGradient.addColorStop(0.5, '#4a293d');
    coverGradient.addColorStop(1, '#d7af78');
    ctx.fillStyle = coverGradient;
    ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
  }
  ctx.restore();

  ctx.fillStyle = '#d9c7a8';
  ctx.beginPath();
  ctx.arc(0, 0, 12 * transform.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b161b';
  ctx.beginPath();
  ctx.arc(0, 0, 4 * transform.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTrackInfo(ctx: CanvasRenderingContext2D, elements: CanvasElements, state: CanvasState, stageRect: DOMRect, transform: CanvasTransform): void {
  const titleRect = elements.trackTitle.getBoundingClientRect();
  const artistRect = elements.trackArtist.getBoundingClientRect();
  const titleStyles = getComputedStyle(elements.trackTitle);
  const artistStyles = getComputedStyle(elements.trackArtist);
  const centerX = (rect: DOMRect) => canvasX(rect.left + rect.width / 2, stageRect, transform);
  const centerY = (rect: DOMRect) => canvasY(rect.top + rect.height / 2, stageRect, transform);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = titleStyles.color;
  ctx.font = `${titleStyles.fontWeight} ${finiteStyleValue(titleStyles.fontSize, 18) * transform.scale}px ${titleStyles.fontFamily}`;
  const titleMetrics = ctx.measureText(state.title);
  ctx.fillText(state.title, centerX(titleRect), centerY(titleRect) + (titleMetrics.actualBoundingBoxAscent - titleMetrics.actualBoundingBoxDescent) / 2);
  ctx.fillStyle = artistStyles.color;
  ctx.font = `${artistStyles.fontWeight} ${finiteStyleValue(artistStyles.fontSize, 10) * transform.scale}px ${artistStyles.fontFamily}`;
  const artistText = state.artist || '未识别歌手';
  const artistMetrics = ctx.measureText(artistText);
  ctx.fillText(artistText, centerX(artistRect), centerY(artistRect) + (artistMetrics.actualBoundingBoxAscent - artistMetrics.actualBoundingBoxDescent) / 2);
  ctx.restore();
}

function drawSettingsIcon(ctx: CanvasRenderingContext2D, elements: CanvasElements, stageRect: DOMRect, transform: CanvasTransform, active: boolean): void {
  const rect = elements.settingsButton.getBoundingClientRect();
  const centerX = canvasX(rect.left + rect.width / 2, stageRect, transform);
  const centerY = canvasY(rect.top + rect.height / 2, stageRect, transform);
  const radius = (rect.width / 2) * transform.scale;
  ctx.save();
  ctx.strokeStyle = active ? 'rgba(199, 120, 96, 0.72)' : 'rgba(202, 161, 109, 0.36)';
  ctx.lineWidth = Math.max(1, transform.scale);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = active ? 'rgba(199, 120, 96, 0.92)' : 'rgba(202, 161, 109, 0.72)';
  ctx.lineWidth = Math.max(1, transform.scale * 1.6);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const gearPath = new Path2D('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z');
  const centerPath = new Path2D('M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z');
  const iconSize = 14 * transform.scale;
  ctx.save();
  ctx.translate(centerX - iconSize / 2, centerY - iconSize / 2);
  ctx.scale(iconSize / 24, iconSize / 24);
  ctx.stroke(gearPath);
  ctx.stroke(centerPath);
  ctx.restore();
  ctx.restore();
}

function drawLyrics(ctx: CanvasRenderingContext2D, elements: CanvasElements, stageRect: DOMRect, transform: CanvasTransform): void {
  drawBorder(ctx, elements.lyricsHeading, stageRect, transform);
  drawText(ctx, elements.lyricsLabel, stageRect, transform);
  drawText(ctx, elements.lyricsCount, stageRect, transform);

  const viewportRect = elements.lyricsViewport.getBoundingClientRect();
  const viewportX = canvasX(viewportRect.left, stageRect, transform);
  const viewportY = canvasY(viewportRect.top, stageRect, transform);
  const viewportWidth = viewportRect.width * transform.scale;
  const viewportHeight = viewportRect.height * transform.scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(viewportX, viewportY, viewportWidth, viewportHeight);
  ctx.clip();
  Array.from(elements.lyricsList.children).forEach((item) => {
    if (!(item instanceof HTMLLIElement)) return;
    const rect = item.getBoundingClientRect();
    if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom) return;
    const styles = getComputedStyle(item);
    const fontSize = finiteStyleValue(styles.fontSize, 18) * transform.scale;
    const paddingLeft = finiteStyleValue(styles.paddingLeft, 0) * transform.scale;
    const x = canvasX(rect.left, stageRect, transform) + paddingLeft;
    const centerY = canvasY(rect.top + rect.height / 2, stageRect, transform);
    const text = item.textContent ?? '';
    ctx.fillStyle = styles.color;
    ctx.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(text);
    ctx.fillText(text, x, centerY + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    if (item.classList.contains('active')) {
      const pseudo = getComputedStyle(item, '::before');
      const barWidth = (finiteStyleValue(pseudo.width, 3)) * transform.scale;
      const barHeight = (finiteStyleValue(pseudo.height, finiteStyleValue(styles.fontSize, 20) * 1.4)) * transform.scale;
      ctx.fillStyle = pseudo.backgroundColor || '#c77860';
      ctx.fillRect(canvasX(rect.left, stageRect, transform), centerY - barHeight / 2, barWidth, barHeight);
    }
  });
  ctx.restore();

  const fade = ctx.createLinearGradient(0, viewportY, 0, viewportY + viewportHeight);
  fade.addColorStop(0, 'rgba(17, 16, 20, 0.38)');
  fade.addColorStop(0.2, 'rgba(17, 16, 20, 0)');
  fade.addColorStop(0.8, 'rgba(17, 16, 20, 0)');
  fade.addColorStop(1, 'rgba(17, 16, 20, 0.38)');
  ctx.fillStyle = fade;
  ctx.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);

  const pulse = elements.lyricsFooter.querySelector<HTMLElement>('.footer-pulse');
  if (pulse) {
    const pulseRect = pulse.getBoundingClientRect();
    ctx.fillStyle = getComputedStyle(pulse).color;
    ctx.beginPath();
    ctx.arc(canvasX(pulseRect.left + pulseRect.width / 2, stageRect, transform), canvasY(pulseRect.top + pulseRect.height / 2, stageRect, transform), (pulseRect.width / 2) * transform.scale, 0, Math.PI * 2);
    ctx.fill();
  }
  drawText(ctx, elements.lyricsFooterText, stageRect, transform);
}

export function drawCanvasFrame(elements: CanvasElements, state: CanvasState): void {
  const stageRect = elements.stage.getBoundingClientRect();
  if (stageRect.width <= 0 || stageRect.height <= 0) return;

  const transform: CanvasTransform = state.recording
    ? {
        scale: Math.min(state.recordingSettings.width / stageRect.width, state.recordingSettings.height / stageRect.height),
        offsetX: (state.recordingSettings.width - stageRect.width * Math.min(state.recordingSettings.width / stageRect.width, state.recordingSettings.height / stageRect.height)) / 2,
        offsetY: (state.recordingSettings.height - stageRect.height * Math.min(state.recordingSettings.width / stageRect.width, state.recordingSettings.height / stageRect.height)) / 2,
      }
    : { scale: Math.min(2, 1920 / stageRect.width, 1080 / stageRect.height), offsetX: 0, offsetY: 0 };
  const width = state.recording ? state.recordingSettings.width : Math.max(1, Math.round(stageRect.width * transform.scale));
  const height = state.recording ? state.recordingSettings.height : Math.max(1, Math.round(stageRect.height * transform.scale));
  if (elements.canvas.width !== width) elements.canvas.width = width;
  if (elements.canvas.height !== height) elements.canvas.height = height;

  const ctx = elements.canvas.getContext('2d');
  if (!ctx) return;
  drawBackground(ctx, width, height);
  drawBorder(ctx, elements.stageTopline, stageRect, transform);
  drawText(ctx, elements.stageLabel, stageRect, transform);
  drawText(ctx, elements.stageIndex, stageRect, transform);
  drawSettingsIcon(ctx, elements, stageRect, transform, state.settingsOpen);
  drawDisc(ctx, elements, stageRect, transform, state.currentTime);
  drawRule(ctx, elements.captionRule, stageRect, transform);
  drawText(ctx, elements.playState, stageRect, transform);
  drawTrackInfo(ctx, elements, state, stageRect, transform);
  drawLyrics(ctx, elements, stageRect, transform);
}
