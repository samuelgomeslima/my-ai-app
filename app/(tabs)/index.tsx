import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useColorScheme,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

type ParsedResponse = {
  json: Record<string, unknown> | null;
  rawText: string;
};

const readResponseContent = async (response: Response): Promise<ParsedResponse> => {
  const rawText = await response.text();

  if (!rawText) {
    return { json: null, rawText: '' };
  }

  try {
    return { json: JSON.parse(rawText) as Record<string, unknown>, rawText };
  } catch {
    return { json: null, rawText };
  }
};

const extractErrorMessage = (
  data: Record<string, unknown> | null,
  rawText: string,
  status: number,
  statusText: string,
) => {
  if (data && typeof data === 'object') {
    const candidateKeys = ['error', 'message', 'detail'] as const;

    for (const key of candidateKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  const fallbackText = rawText.trim();

  if (fallbackText.length > 0) {
    return fallbackText;
  }

  const statusLabel = statusText && statusText.length > 0 ? `${status} ${statusText}` : `${status}`;
  return `Request failed with status ${statusLabel}`;
};

const normaliseErrorMessage = (value: string) => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return 'An unknown error occurred.';
  }

  return trimmed.replace(/^(?:[A-Za-z]*Error):\s*/u, '').trim() || trimmed;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
  status?: 'pending' | 'error';
};

const isRecordingSupported = Platform.OS === 'web' && typeof window !== 'undefined' && 'MediaRecorder' in window;

const getTranscribeUrl = () => {
  if (API_BASE_URL.length === 0) {
    return '/api/transcribe';
  }

  return `${API_BASE_URL}/api/transcribe`;
};

const getStatusUrl = () => {
  if (API_BASE_URL.length === 0) {
    return '/api/status';
  }

  return `${API_BASE_URL}/api/status`;
};

type ServerStatusState =
  | { state: 'checking' }
  | { state: 'ok'; openaiConfigured: boolean; message: string }
  | { state: 'error'; message: string };

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDarkMode), [isDarkMode]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createId(),
      role: 'assistant',
      text: "Hi! Upload an audio clip or record something new and I'll transcribe it for you.",
    },
  ]);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatusState>({ state: 'checking' });
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkServerStatus = async () => {
      try {
        const response = await fetch(getStatusUrl());
        const { json, rawText } = await readResponseContent(response);

        if (!response.ok) {
          const message = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
          throw new Error(message);
        }

        if (!json || typeof json !== 'object') {
          throw new Error('The status endpoint returned an empty response.');
        }

        const data = json as Record<string, unknown>;
        const openaiConfigured =
          'openaiConfigured' in data && typeof data.openaiConfigured === 'boolean' ? data.openaiConfigured : false;

        const message =
          'message' in data && typeof data.message === 'string'
            ? data.message
            : openaiConfigured
              ? 'OpenAI API key is configured on the server.'
              : 'OpenAI API key is missing or empty on the server.';

        if (!cancelled) {
          setServerStatus({ state: 'ok', openaiConfigured, message });
        }
      } catch (error) {
        const message = normaliseErrorMessage(
          error instanceof Error ? error.message : 'Unable to contact the status endpoint.',
        );

        if (!cancelled) {
          setServerStatus({ state: 'error', message });
        }
      }
    };

    checkServerStatus();

    return () => {
      cancelled = true;

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const busy = isUploading || isRecording;

  const formatDuration = (value: number | null | undefined) => {
    if (!value || Number.isNaN(value)) {
      return null;
    }

    if (value < 60) {
      return `${value.toFixed(1)}s`;
    }

    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  };

  const appendMessage = (message: Message) => {
    setMessages((current) => [...current, message]);
  };

  const updateMessage = (messageId: string, updater: (current: Message) => Message) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        return updater(message);
      }),
    );
  };

  const sendBlobForTranscription = async (blob: Blob, fileName: string) => {
    setErrorMessage(null);
    setIsUploading(true);
    setUploadingFileName(fileName);

    const userMessage: Message = {
      id: createId(),
      role: 'user',
      text: `Uploaded ${fileName}`,
    };
    const pendingMessageId = createId();
    const pendingMessage: Message = {
      id: pendingMessageId,
      role: 'assistant',
      text: 'Transcribing audio…',
      status: 'pending',
    };

    appendMessage(userMessage);
    appendMessage(pendingMessage);

    try {
      const formData = new FormData();
      const file = blob instanceof File ? blob : new File([blob], fileName, { type: blob.type || 'audio/webm' });
      formData.append('file', file);

      const response = await fetch(getTranscribeUrl(), {
        method: 'POST',
        body: formData,
      });

      const { json, rawText } = await readResponseContent(response);

      if (!response.ok) {
        const message = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
        throw new Error(message);
      }

      if (!json || typeof json !== 'object') {
        throw new Error('The server response did not include any data.');
      }

      const result = json as Record<string, unknown>;
      const details: string[] = [];
      const language =
        result && typeof result === 'object' && 'language' in result && typeof result.language === 'string'
          ? result.language.toUpperCase()
          : null;
      const duration = formatDuration(
        result && typeof result === 'object' && 'duration' in result && typeof result.duration === 'number'
          ? result.duration
          : null,
      );

      if (!('text' in result) || typeof result.text !== 'string') {
        throw new Error('The server response did not include a transcription result.');
      }

      if (language) {
        details.push(`Language: ${language}`);
      }

      if (duration) {
        details.push(`Duration: ${duration}`);
      }

      updateMessage(pendingMessageId, (message) => ({
        ...message,
        text: result.text.trim() ? result.text.trim() : 'No speech was detected in the clip.',
        status: undefined,
        meta: details.length > 0 ? details.join(' • ') : undefined,
      }));
    } catch (error) {
      const fallbackMessage = normaliseErrorMessage(
        error instanceof Error ? error.message : 'An unexpected error occurred while contacting the server.',
      );

      updateMessage(pendingMessageId, (message) => ({
        ...message,
        status: 'error',
        text: 'I could not transcribe that audio clip.',
        meta: fallbackMessage,
      }));

      setErrorMessage(fallbackMessage);
    } finally {
      setIsUploading(false);
      setUploadingFileName(null);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }

    const file = event.target.files[0];
    await sendBlobForTranscription(file, file.name);
    event.target.value = '';
  };

  const startRecording = async () => {
    if (!isRecordingSupported) {
      setErrorMessage('Recording is only available in supported web browsers.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendBlobForTranscription(blob, `recording-${new Date().toISOString()}.webm`);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      setIsRecording(true);
      setErrorMessage(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes('denied')
          ? 'Microphone permissions were denied. Please allow access to record audio.'
          : 'We could not access the microphone on this device.';
      setErrorMessage(message);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) {
      return;
    }

    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsRecording(false);
  };

  const recordButtonLabel = !isRecordingSupported
    ? 'Recording not supported'
    : isRecording
      ? 'Stop recording'
      : 'Record with microphone';

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">Audio Assistant</ThemedText>
          <ThemedText style={styles.subtitle}>
            Transcribe voice notes and conversations with a single click.
          </ThemedText>
        </View>

        <View style={styles.statusPanel}>
          {serverStatus.state === 'checking' && (
            <View style={[styles.statusSummary, styles.statusSummaryNeutral]}>
              <ActivityIndicator size="small" />
              <ThemedText style={styles.statusSummaryText}>Checking server configuration…</ThemedText>
            </View>
          )}

          {serverStatus.state === 'ok' && (
            <View
              style={[
                styles.statusSummary,
                serverStatus.openaiConfigured ? styles.statusSummaryOk : styles.statusSummaryWarning,
              ]}>
              <ThemedText style={styles.statusSummaryText}>{serverStatus.message}</ThemedText>
            </View>
          )}

          {serverStatus.state === 'error' && (
            <View style={[styles.statusSummary, styles.statusSummaryWarning]}>
              <ThemedText style={styles.statusSummaryText}>
                {`Server status check failed: ${serverStatus.message}`}
              </ThemedText>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => fileInputRef.current?.click()}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
            disabled={busy}>
            <ThemedText style={styles.buttonText} type="defaultSemiBold">
              Choose audio file
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={isRecording ? stopRecording : startRecording}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              (!isRecordingSupported || isUploading) && styles.buttonDisabled,
              isRecording && styles.recordingButton,
            ]}
            disabled={!isRecordingSupported || isUploading}>
            <ThemedText style={styles.buttonText} type="defaultSemiBold">
              {recordButtonLabel}
            </ThemedText>
          </Pressable>
        </View>

        {Platform.OS === 'web' && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".opus,.ogg,.waptt,audio/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        )}

        {(isUploading || isRecording) && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <ThemedText style={styles.statusText}>
              {isRecording
                ? 'Recording in progress…'
                : uploadingFileName
                  ? `Uploading ${uploadingFileName}…`
                  : 'Uploading audio…'}
            </ThemedText>
          </View>
        )}

        {errorMessage && (
          <View style={styles.errorBox}>
            <ThemedText style={styles.errorTitle} type="defaultSemiBold">
              Something went wrong
            </ThemedText>
            <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
          </View>
        )}

        <View style={styles.messagePanel}>
          <ScrollView style={styles.messages} contentContainerStyle={styles.messageContent}>
            {messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.message,
                  message.role === 'user' ? styles.userMessage : styles.assistantMessage,
                ]}>
                <ThemedText type="defaultSemiBold" style={[styles.messageAuthor, message.role === 'user' && styles.userAuthor]}>
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </ThemedText>
                <ThemedText style={styles.messageText}>{message.text}</ThemedText>
                {message.meta && <ThemedText style={styles.messageMeta}>{message.meta}</ThemedText>}
                {message.status === 'pending' && (
                  <View style={styles.inlineStatus}>
                    <ActivityIndicator size="small" />
                    <ThemedText style={styles.pendingText}>Working on it…</ThemedText>
                  </View>
                )}
                {message.status === 'error' && (
                  <ThemedText style={[styles.messageMeta, styles.errorMeta]}>Try another file.</ThemedText>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </ThemedView>
  );
}

const createStyles = (isDarkMode: boolean) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      paddingHorizontal: 20,
      paddingVertical: 24,
    },
    container: {
      flex: 1,
      width: '100%',
      maxWidth: 960,
      alignSelf: 'center',
      gap: 24,
    },
    header: {
      gap: 8,
    },
    subtitle: {
      opacity: 0.8,
      maxWidth: 720,
    },
    statusPanel: {
      gap: 12,
    },
    statusSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
    },
    statusSummaryOk: {
      backgroundColor: isDarkMode ? 'rgba(76, 175, 80, 0.12)' : 'rgba(76, 175, 80, 0.18)',
      borderColor: isDarkMode ? 'rgba(129, 199, 132, 0.5)' : 'rgba(56, 142, 60, 0.35)',
    },
    statusSummaryWarning: {
      backgroundColor: isDarkMode ? 'rgba(239, 83, 80, 0.12)' : 'rgba(255, 205, 210, 0.4)',
      borderColor: isDarkMode ? 'rgba(244, 143, 177, 0.45)' : 'rgba(239, 83, 80, 0.4)',
    },
    statusSummaryNeutral: {
      backgroundColor: isDarkMode ? 'rgba(120, 144, 156, 0.16)' : 'rgba(207, 216, 220, 0.35)',
      borderColor: isDarkMode ? 'rgba(176, 190, 197, 0.45)' : 'rgba(144, 164, 174, 0.35)',
    },
    statusSummaryText: {
      flex: 1,
    },
    actions: {
      flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      gap: 12,
      flexWrap: 'wrap',
      alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    },
    button: {
      flexGrow: 1,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a7ea4',
      minWidth: Platform.OS === 'web' ? 220 : 180,
      borderWidth: 1,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.35)' : 'rgba(15, 23, 42, 0.08)',
    },
    secondaryButton: {
      backgroundColor: isDarkMode ? '#334155' : '#1f2933',
    },
    recordingButton: {
      backgroundColor: '#b91c1c',
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: '#ffffff',
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 8,
    },
    statusText: {
      opacity: 0.85,
    },
    errorBox: {
      backgroundColor: isDarkMode ? 'rgba(248, 113, 113, 0.12)' : '#fee2e2',
      borderRadius: 12,
      padding: 16,
      gap: 4,
      borderWidth: 1,
      borderColor: isDarkMode ? 'rgba(248, 113, 113, 0.35)' : '#fecaca',
    },
    errorTitle: {
      color: isDarkMode ? '#fca5a5' : '#991b1b',
    },
    errorText: {
      color: isDarkMode ? '#fecaca' : '#7f1d1d',
    },
    errorMeta: {
      color: isDarkMode ? '#fca5a5' : '#991b1b',
    },
    messagePanel: {
      flex: 1,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(15, 23, 42, 0.08)',
      backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.7)' : '#ffffff',
      overflow: 'hidden',
    },
    messages: {
      flex: 1,
    },
    messageContent: {
      gap: 16,
      paddingHorizontal: 24,
      paddingVertical: 24,
    },
    message: {
      borderRadius: 16,
      padding: 16,
      gap: 8,
      borderWidth: 1,
      minWidth: '60%',
    },
    userMessage: {
      alignSelf: 'flex-end',
      backgroundColor: isDarkMode ? 'rgba(59, 130, 246, 0.18)' : '#e0f2fe',
      borderColor: isDarkMode ? 'rgba(125, 211, 252, 0.35)' : '#bae6fd',
    },
    assistantMessage: {
      alignSelf: 'flex-start',
      backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.12)' : '#f9fafb',
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.35)' : '#e5e7eb',
    },
    messageAuthor: {
      opacity: 0.9,
      color: isDarkMode ? 'rgba(226, 232, 240, 0.85)' : '#1f2937',
    },
    userAuthor: {
      color: isDarkMode ? '#e0f2fe' : '#0f172a',
    },
    messageText: {
      lineHeight: 22,
      color: isDarkMode ? '#f8fafc' : '#111827',
    },
    messageMeta: {
      fontSize: 12,
      color: isDarkMode ? 'rgba(226, 232, 240, 0.65)' : '#4b5563',
    },
    inlineStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pendingText: {
      fontSize: 12,
      color: isDarkMode ? 'rgba(226, 232, 240, 0.65)' : '#4b5563',
    },
  });
