export interface LyricLine {
  time: number;
  text: string;
}

export interface ParsedLrc {
  lines: LyricLine[];
  metadata: Record<string, string>;
}

export type NoticeTone = 'neutral' | 'success' | 'error';
