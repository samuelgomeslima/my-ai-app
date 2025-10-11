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
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
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

  const parseJsonSafely = async (response: Response) => {
    const text = await response.text();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error('The server returned an invalid response.');
    }
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

      const result = await parseJsonSafely(response);

      if (!response.ok) {
        const message =
          result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Unable to transcribe the audio.';

        throw new Error(message);
      }

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

      if (!(result && typeof result === 'object' && 'text' in result && typeof result.text === 'string')) {
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
      const fallbackMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred while contacting the server.';

      updateMessage(pendingMessageId, (message) => ({
        ...message,
        status: 'error',
        text: 'I could not transcribe that audio clip.',
        meta: undefined,
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
