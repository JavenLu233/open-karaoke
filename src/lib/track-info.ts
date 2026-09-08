export interface TrackInfo {
  title: string;
  artist: string;
}

const AUDIO_EXTENSION_PATTERN = /\.[^/.]+$/;
const SEPARATOR_PATTERN = /\s*(?:[-–—_|｜／/])\s*/;
const NOISE_PATTERN = /^(?:伴奏|伴奏版|纯音乐|纯伴奏|instrumental|karaoke|off\s*vocal|伴唱|demo|试听版)$/i;

function cleanPart(value: string): string {
  return value
    .replace(/[【】[\]()（）]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.·•]+|[\s.·•]+$/g, '')
    .trim();
}

function isNoisePart(value: string): boolean {
  return NOISE_PATTERN.test(cleanPart(value));
}

export function inferTrackInfo(fileName: string): TrackInfo {
  const baseName = fileName.replace(AUDIO_EXTENSION_PATTERN, '').replace(/\s+/g, ' ').trim();
  if (!baseName) return { title: '未命名作品', artist: '' };

  const bracketMatch = baseName.match(/^(.*?)\s*(?:\(|（|\[|【)(.*?)(?:\)|）|\]|】)\s*$/);
  if (bracketMatch && !isNoisePart(bracketMatch[2])) {
    const title = cleanPart(bracketMatch[1]);
    const artist = cleanPart(bracketMatch[2]);
    if (title && artist) return { title, artist };
  }

  let parts = baseName.split(SEPARATOR_PATTERN).map(cleanPart).filter(Boolean);
  while (parts.length > 1 && isNoisePart(parts.at(-1) ?? '')) parts.pop();

  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(' - '),
    };
  }

  return { title: parts[0] || baseName, artist: '' };
}

export function mergeTrackInfoFromLrc(trackInfo: TrackInfo, metadata: Record<string, string>): TrackInfo {
  return {
    title: cleanPart(metadata.ti || '') || trackInfo.title,
    artist: cleanPart(metadata.ar || '') || trackInfo.artist,
  };
}
