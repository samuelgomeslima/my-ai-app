export {};

declare global {
  type FfmpegProgress = {
    ratio?: number;
    time?: number;
    frame?: number;
    fps?: number;
    bitrate?: number;
  };

  type FfmpegFetchSource = string | URL | ArrayBuffer | Uint8Array | Blob | File;

  type FfmpegFetchFile = (source: FfmpegFetchSource) => Promise<Uint8Array>;

  type FfmpegFsMethod =
    | ['writeFile', string, Uint8Array]
    | ['readFile', string]
    | ['unlink', string];

  type FfmpegInstance = {
    load: () => Promise<void>;
    run: (...args: string[]) => Promise<void>;
    FS: (...args: FfmpegFsMethod) => Uint8Array | void;
    exit: () => Promise<void>;
  };

  type FfmpegCreateOptions = {
    log?: boolean;
    corePath?: string;
    mainName?: string;
    wasmPath?: string;
    progress?: (progress: FfmpegProgress) => void;
  };

  type FfmpegModule = {
    createFFmpeg: (options?: FfmpegCreateOptions) => FfmpegInstance;
    fetchFile: FfmpegFetchFile;
  };

  interface Window {
    FFmpeg?: FfmpegModule;
    createFFmpeg?: FfmpegModule['createFFmpeg'];
    fetchFile?: FfmpegFetchFile;
  }
}
