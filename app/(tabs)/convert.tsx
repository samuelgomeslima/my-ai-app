import type { ChangeEvent } from 'react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const isWeb = Platform.OS === 'web';

const FFMPEG_SCRIPT_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js';
const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js';

const audioElementStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 8,
};

const downloadLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 8,
  color: '#0a7ea4',
  fontWeight: 600,
};

const buildDownloadName = (inputName: string | null) => {
  if (!inputName) {
    return 'whatsapp-audio.mp3';
  }

  const nameWithoutExtension = inputName.replace(/\.[^/.]+$/u, '');
  const sanitised = nameWithoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

  return `${sanitised.length > 0 ? sanitised : 'whatsapp-audio'}.mp3`;
};

const describeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred during conversion.';
};

type EnsureFfmpegResult = {
  ffmpeg: FfmpegInstance;
  fetchFile: FfmpegFetchFile;
};

const ensureWindow = () => {
  if (typeof window === 'undefined') {
    throw new Error('The FFmpeg loader is only available in the browser.');
  }

  return window;
};

const useFfmpeg = () => {
  const ffmpegRef = useRef<FfmpegInstance | null>(null);
  const fetchFileRef = useRef<FfmpegFetchFile | null>(null);
  const scriptPromiseRef = useRef<Promise<void> | null>(null);

  const loadScript = useCallback(async () => {
    if (!isWeb) {
      throw new Error('FFmpeg is only supported in the web build.');
    }

    const targetWindow = ensureWindow();

    const hasGlobalModule =
      typeof targetWindow.FFmpeg === 'object' &&
      !!targetWindow.FFmpeg &&
      typeof targetWindow.FFmpeg.createFFmpeg === 'function' &&
      typeof targetWindow.FFmpeg.fetchFile === 'function';

    if (hasGlobalModule) {
      return;
    }

    if (!scriptPromiseRef.current) {
      scriptPromiseRef.current = new Promise((resolve, reject) => {
        const existing = targetWindow.document.querySelector<HTMLScriptElement>(
          'script[data-ffmpeg-loader="true"]',
        );

        if (existing && existing.dataset.loaded === 'true') {
          resolve();
          return;
        }

        const script = existing ?? targetWindow.document.createElement('script');

        if (!existing) {
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.dataset.ffmpegLoader = 'true';
          script.src = FFMPEG_SCRIPT_URL;
          targetWindow.document.body.appendChild(script);
        }

        script.addEventListener('load', () => {
          script.dataset.loaded = 'true';
          resolve();
        });

        script.addEventListener('error', () => {
          scriptPromiseRef.current = null;
          reject(new Error('Failed to download the FFmpeg library. Check your internet connection.'));
        });
      });
    }

    return scriptPromiseRef.current;
  }, []);

  const ensureFfmpeg = useCallback(async (): Promise<EnsureFfmpegResult> => {
    if (ffmpegRef.current && fetchFileRef.current) {
      return { ffmpeg: ffmpegRef.current, fetchFile: fetchFileRef.current };
    }

    await loadScript();

    const targetWindow = ensureWindow();
    const globalModule = targetWindow.FFmpeg ?? targetWindow;
    const createFFmpeg =
      (globalModule && typeof globalModule.createFFmpeg === 'function'
        ? globalModule.createFFmpeg
        : undefined) ?? targetWindow.createFFmpeg;
    const fetchFile =
      (globalModule && typeof globalModule.fetchFile === 'function'
        ? globalModule.fetchFile
        : undefined) ?? targetWindow.fetchFile;

    if (typeof createFFmpeg !== 'function' || typeof fetchFile !== 'function') {
      throw new Error('FFmpeg helpers were not initialised.');
    }

    const instance = createFFmpeg({
      log: false,
      corePath: FFMPEG_CORE_URL,
      mainName: 'ffmpeg-core.js',
    });

    await instance.load();

    ffmpegRef.current = instance;
    fetchFileRef.current = fetchFile;

    return { ffmpeg: instance, fetchFile };
  }, [loadScript]);

  useEffect(() => {
    return () => {
      const instance = ffmpegRef.current;
      if (instance) {
        void instance.exit().catch(() => {
          // Ignore exit errors on unmount.
        });
        ffmpegRef.current = null;
      }
    };
  }, []);

  return ensureFfmpeg;
};

const useObjectUrl = () => {
  const [url, setUrl] = useState<string | null>(null);
  const previousUrl = useRef<string | null>(null);

  useEffect(() => {
    if (previousUrl.current && previousUrl.current !== url) {
      URL.revokeObjectURL(previousUrl.current);
    }

    previousUrl.current = url;
  }, [url]);

  useEffect(() => {
    return () => {
      if (previousUrl.current) {
        URL.revokeObjectURL(previousUrl.current);
      }
    };
  }, []);

  return [url, setUrl] as const;
};

export default function ConvertScreen() {
  const ensureFfmpeg = useFfmpeg();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [outputUrl, setOutputUrl] = useObjectUrl();
  const [outputFileName, setOutputFileName] = useState<string>('whatsapp-audio.mp3');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const styles = useMemo(() => createStyles(), []);

  const resetInput = useCallback(() => {
    const input = fileInputRef.current;
    if (input) {
      input.value = '';
    }
  }, []);

  const handleSelectPress = useCallback(() => {
    if (!isWeb) {
      return;
    }

    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      setErrorMessage(null);
      setStatusMessage('Preparing converter...');
      setIsConverting(true);
      setSelectedFileName(file.name);
      setOutputUrl(null);

      try {
        const { ffmpeg, fetchFile } = await ensureFfmpeg();
        setStatusMessage('Reading WhatsApp audio...');

        const inputData = await fetchFile(file);
        const inputName = `input-${Date.now()}.opus`;
        ffmpeg.FS('writeFile', inputName, inputData);

        setStatusMessage('Converting to MP3...');

        const rawOutputName = `output-${Date.now()}.mp3`;
        await ffmpeg.run('-i', inputName, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', rawOutputName);

        setStatusMessage('Preparing download link...');
        const outputData = ffmpeg.FS('readFile', rawOutputName);
        const blob = new Blob([outputData.slice()], { type: 'audio/mpeg' });
        const objectUrl = URL.createObjectURL(blob);

        setOutputFileName(buildDownloadName(file.name));
        setOutputUrl(objectUrl);
        setStatusMessage('Conversion complete.');

        try {
          ffmpeg.FS('unlink', inputName);
        } catch {
          // Ignore clean-up errors.
        }

        try {
          ffmpeg.FS('unlink', rawOutputName);
        } catch {
          // Ignore clean-up errors.
        }
      } catch (error) {
        setErrorMessage(describeError(error));
        setStatusMessage('');
      } finally {
        setIsConverting(false);
        resetInput();
      }
    },
    [ensureFfmpeg, resetInput, setOutputUrl],
  );

  const handleClear = useCallback(() => {
    setOutputUrl(null);
    setErrorMessage(null);
    setStatusMessage('');
    setSelectedFileName(null);
    resetInput();
  }, [resetInput, setOutputUrl]);

  if (!isWeb) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.section}>
          <ThemedText type="title">Convert WhatsApp voice notes</ThemedText>
          <ThemedText>
            Audio conversion runs entirely in your browser. Open this project in a web browser to convert `.opus` files
            exported from WhatsApp into MP3 downloads.
          </ThemedText>
        </View>
        <View style={styles.notice}>
          <ThemedText type="defaultSemiBold">Web only</ThemedText>
          <ThemedText>
            Run `npx expo start --web` and open the converter tab in your browser to unlock offline `.opus` to MP3 conversion.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.section}>
        <ThemedText type="title">Convert WhatsApp voice notes</ThemedText>
        <ThemedText>
          Select a `.opus` file exported from WhatsApp and the converter will generate a downloadable MP3 directly in your
          browser—no uploads required.
        </ThemedText>
      </View>

      <View style={styles.section}>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={handleSelectPress}
            style={({ pressed }) => [
              styles.button,
              (pressed || isConverting) && styles.buttonPressed,
              isConverting && styles.buttonDisabled,
            ]}
            disabled={isConverting}
          >
            <ThemedText style={styles.buttonText}>{isConverting ? 'Working…' : 'Choose .opus file'}</ThemedText>
          </Pressable>

          {outputUrl && (
            <Pressable accessibilityRole="button" onPress={handleClear} style={styles.secondaryButton}>
              <ThemedText style={styles.buttonText}>Reset</ThemedText>
            </Pressable>
          )}
        </View>

        {selectedFileName && (
          <ThemedText style={styles.metaText}>Selected file: {selectedFileName}</ThemedText>
        )}

        {(isConverting || statusMessage) && (
          <View style={styles.statusRow}>
            {isConverting && <ActivityIndicator size="small" color="#0a7ea4" />}
            <ThemedText style={styles.metaText}>{statusMessage || 'Converting…'}</ThemedText>
          </View>
        )}

        {errorMessage && (
          <View style={styles.errorBox}>
            <ThemedText type="defaultSemiBold" style={styles.errorTitle}>
              Conversion failed
            </ThemedText>
            <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
          </View>
        )}
      </View>

      {outputUrl && (
        <View style={styles.outputCard}>
          <ThemedText type="subtitle">Your MP3 file is ready</ThemedText>
          <ThemedText style={styles.metaText}>
            The conversion happens locally—click play to preview or download the MP3 file.
          </ThemedText>
          {React.createElement('audio', { controls: true, src: outputUrl, style: audioElementStyle })}
          {React.createElement(
            'a',
            {
              href: outputUrl,
              download: outputFileName,
              style: downloadLinkStyle,
            },
            'Download MP3',
          )}
        </View>
      )}

      {React.createElement('input', {
        ref: fileInputRef,
        type: 'file',
        accept: '.opus,audio/ogg,audio/opus',
        onChange: handleFileChange,
        style: { display: 'none' },
      })}
    </ThemedView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 20,
      paddingVertical: 24,
      gap: 24,
    },
    section: {
      gap: 12,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    button: {
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: '#0a7ea4',
      alignItems: 'center',
    },
    secondaryButton: {
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: '#334155',
      alignItems: 'center',
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: '#ffffff',
      fontWeight: '600',
    },
    metaText: {
      opacity: 0.85,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    errorBox: {
      marginTop: 8,
      borderRadius: 12,
      padding: 16,
      backgroundColor: '#fee2e2',
      borderWidth: 1,
      borderColor: '#fecaca',
      gap: 6,
    },
    errorTitle: {
      color: '#991b1b',
    },
    errorText: {
      color: '#7f1d1d',
    },
    outputCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(15, 23, 42, 0.12)',
      padding: 20,
      gap: 12,
      backgroundColor: '#ffffff',
    },
    notice: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: '#f8fafc',
      gap: 8,
    },
  });
