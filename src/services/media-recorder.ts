type CapturableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
};

export interface RecorderCapabilities {
  canvasCapture: boolean;
  audioCapture: boolean;
  mediaRecorder: boolean;
}

export type RecordingFormat = 'mp4' | 'webm';

export const RECORDING_FPS = 24;

export interface RecordingResult {
  blob: Blob;
  format: RecordingFormat;
  mimeType: string;
}

export function getRecorderCapabilities(): RecorderCapabilities {
  return {
    canvasCapture: 'captureStream' in HTMLCanvasElement.prototype,
    audioCapture: 'captureStream' in HTMLMediaElement.prototype,
    mediaRecorder: typeof MediaRecorder !== 'undefined',
  };
}

function getSupportedMimeType(): { mimeType: string; format: RecordingFormat } | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;

  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', format: 'mp4' as const },
    { mimeType: 'video/mp4', format: 'mp4' as const },
    { mimeType: 'video/webm;codecs=vp9,opus', format: 'webm' as const },
    { mimeType: 'video/webm;codecs=vp8,opus', format: 'webm' as const },
    { mimeType: 'video/webm', format: 'webm' as const },
  ];

  return candidates.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType));
}

export class MediaRecorderService {
  private recorder: MediaRecorder | null = null;
  private tracks: MediaStreamTrack[] = [];
  private chunks: Blob[] = [];
  private outputFormat: RecordingFormat = 'webm';

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(audioElement: HTMLAudioElement, canvas: HTMLCanvasElement): void {
    if (this.isRecording) throw new Error('录制已经在进行中。');

    const canvasCapture = canvas.captureStream?.(RECORDING_FPS);
    const audioCapture = (audioElement as CapturableAudio).captureStream?.();
    if (!canvasCapture || !audioCapture) {
      throw new Error('当前浏览器不支持媒体流捕获，请使用最新版 Chrome 或 Edge。');
    }

    const combinedStream = new MediaStream([
      ...canvasCapture.getVideoTracks(),
      ...audioCapture.getAudioTracks(),
    ]);
    const supportedType = getSupportedMimeType();
    const recorderOptions = supportedType
      ? { mimeType: supportedType.mimeType, videoBitsPerSecond: 6_000_000 }
      : { videoBitsPerSecond: 6_000_000 };

    try {
      this.recorder = new MediaRecorder(combinedStream, recorderOptions);
      this.outputFormat = supportedType?.format ?? 'webm';
    } catch {
      this.recorder = new MediaRecorder(combinedStream);
      this.outputFormat = 'webm';
    }

    this.tracks = combinedStream.getTracks();
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(250);
  }

  stop(): Promise<RecordingResult> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('当前没有正在进行的录制。'));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.tracks.forEach((track) => track.stop());
        this.tracks = [];
        this.recorder = null;
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || (this.outputFormat === 'mp4' ? 'video/mp4' : 'video/webm');
        const blob = new Blob(this.chunks, { type: mimeType });
        cleanup();
        resolve({ blob, format: this.outputFormat, mimeType });
      };
      recorder.onerror = () => {
        cleanup();
        reject(new Error('录制过程中发生错误，请重试。'));
      };

      if (recorder.state === 'inactive') {
        recorder.onstop?.(new Event('stop'));
      } else {
        recorder.stop();
      }
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.tracks.forEach((track) => track.stop());
    this.tracks = [];
    this.recorder = null;
    this.chunks = [];
    this.outputFormat = 'webm';
  }
}
