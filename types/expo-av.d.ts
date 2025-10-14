declare module 'expo-av' {
  export type AudioMode = Record<string, unknown>;

  export type RecordingStatus = {
    canRecord?: boolean;
    isRecording?: boolean;
    durationMillis?: number;
    [key: string]: unknown;
  };

  export type RecordingOptions = Record<string, unknown>;

  export namespace Audio {
    const RecordingOptionsPresets: {
      HIGH_QUALITY: RecordingOptions;
    };

    function requestPermissionsAsync(): Promise<{ granted: boolean }>;
    function setAudioModeAsync(mode: AudioMode): Promise<void>;

    class Recording {
      constructor();
      prepareToRecordAsync(options: RecordingOptions): Promise<void>;
      startAsync(): Promise<void>;
      stopAndUnloadAsync(): Promise<void>;
      getStatusAsync(): Promise<RecordingStatus>;
      getURI(): string | null;
    }
  }
}
