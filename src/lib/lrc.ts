import type { LyricLine, ParsedLrc } from '../types';

const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_PATTERN = /^\[([a-z]+):([^\]]*)\]$/i;

function fractionToSeconds(fraction: string | undefined): number {
  if (!fraction) return 0;
  const normalized = fraction.length === 1 ? `${fraction}0` : fraction.slice(0, 3);
  return Number(normalized) / (normalized.length === 3 ? 1000 : 100);
}

function timestampToSeconds(match: RegExpMatchArray): number | null {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  return minutes * 60 + seconds + fractionToSeconds(match[3]);
}

export function parseLrc(content: string): ParsedLrc {
  const lines: LyricLine[] = [];
  const metadata: Record<string, string> = {};

  for (const rawLine of content.replace(/\uFEFF/g, '').split(/\r?\n/)) {
    const timestampMatches = [...rawLine.matchAll(TIMESTAMP_PATTERN)];
    if (timestampMatches.length > 0) {
      const text = rawLine.replace(TIMESTAMP_PATTERN, '').trim();
      if (text) {
        for (const match of timestampMatches) {
          const time = timestampToSeconds(match);
          if (time !== null) lines.push({ time, text });
        }
      }
      continue;
    }

    const metadataMatch = rawLine.trim().match(METADATA_PATTERN);
    if (metadataMatch) {
      const [, key, value] = metadataMatch;
      metadata[key.toLowerCase()] = value.trim();
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return { lines, metadata };
}

export function findActiveLyricIndex(lines: LyricLine[], currentTime: number): number {
  if (lines.length === 0 || !Number.isFinite(currentTime) || currentTime < lines[0].time) {
    return -1;
  }

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= currentTime) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return activeIndex;
}
