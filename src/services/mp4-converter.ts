import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

export type ConversionProgress = (progress: number) => void;

export class Mp4Converter {
  private readonly ffmpeg = new FFmpeg();
  private loadPromise: Promise<void> | null = null;

  async convert(input: Blob, onProgress?: ConversionProgress): Promise<Blob> {
    await this.load();
    const progressHandler = ({ progress }: { progress: number }): void => {
      onProgress?.(Math.max(0, Math.min(1, progress)));
    };
    this.ffmpeg.on('progress', progressHandler);

    try {
      await this.ffmpeg.writeFile('input.webm', await fetchFile(input));
      await this.ffmpeg.exec([
        '-i', 'input.webm',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        'output.mp4',
      ]);
      const data = await this.ffmpeg.readFile('output.mp4');
      if (typeof data === 'string') throw new Error('MP4 转码输出无效。');
      const output = new Uint8Array(data.byteLength);
      output.set(data);
      return new Blob([output.buffer], { type: 'video/mp4' });
    } finally {
      this.ffmpeg.off('progress', progressHandler);
      await this.deleteFileIfPresent('input.webm');
      await this.deleteFileIfPresent('output.mp4');
    }
  }

  private async load(): Promise<void> {
    if (this.ffmpeg.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = Promise.all([
        toBlobURL(coreURL, 'text/javascript'),
        toBlobURL(wasmURL, 'application/wasm'),
      ]).then(async ([coreBlobURL, wasmBlobURL]) => {
        await this.ffmpeg.load({ coreURL: coreBlobURL, wasmURL: wasmBlobURL });
      }).catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    await this.loadPromise;
  }

  private async deleteFileIfPresent(path: string): Promise<void> {
    try {
      await this.ffmpeg.deleteFile(path);
    } catch {
      // The file may not exist when FFmpeg exits early.
    }
  }
}
