import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

const getChatUrl = () => {
  if (API_BASE_URL.length === 0) {
    return '/api/chat';
  }

  return `${API_BASE_URL}/api/chat`;
};

const SYSTEM_PROMPT = `You are AI Language Coach, an encouraging English tutor. Always reply in JSON that matches the provided schema.\n- Give a friendly short reply in the \\"reply\\" field that references the learner's ideas.\n- Provide separate actionable feedback for grammar, writing, and pronunciation. Pronunciation feedback must be based on any input_audio provided. If no audio is included, note that pronunciation feedback is limited and base it on the writing instead.\n- Estimate the learner's CEFR level (A1, A2, B1, B2, C1, or C2) in the \\"english_level\\" field.\n- Summarise their overall progress in \\"overall_feedback\\" and suggest up to three focused practice ideas in \\"action_items\\".\n- When audio is sent include a polished transcript in the \\"transcript\\" field.`;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'language_coach_response',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'reply',
        'grammar_feedback',
        'writing_feedback',
        'pronunciation_feedback',
        'english_level',
        'overall_feedback',
      ],
      properties: {
        reply: { type: 'string' },
        grammar_feedback: { type: 'string' },
        writing_feedback: { type: 'string' },
        pronunciation_feedback: { type: 'string' },
        english_level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
        overall_feedback: { type: 'string' },
        transcript: { type: 'string', default: '' },
        action_items: {
          type: 'array',
          items: { type: 'string' },
          minItems: 0,
          maxItems: 3,
          default: [],
        },
      },
    },
  },
} as const;

type ChatRole = 'user' | 'assistant';

type ConversationContent =
  | string
  | ({ type: 'input_text'; text: string } | { type: 'input_audio'; audio_url: string })[];

type ConversationMessage = {
  role: ChatRole;
  content: ConversationContent;
};

type CoachResponse = {
  reply: string;
  grammar: string;
  writing: string;
  pronunciation: string;
  overall: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  transcript: string | null;
  actionItems: string[];
};

type MessageSource = 'text' | 'audio';

type CoachMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status?: 'pending' | 'error';
  source?: MessageSource;
  evaluation?: CoachResponse;
  transcript?: string | null;
  audioPlaybackUrl?: string | null;
};

type ParsedResponse = {
  json: Record<string, unknown> | null;
  rawText: string;
};

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    const errorValue = data.error;

    if (errorValue && typeof errorValue === 'object') {
      const message = (errorValue as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim();
      }
    }

    const detail = data.detail;
    if (typeof detail === 'string' && detail.trim().length > 0) {
      return detail.trim();
    }

    const message = data.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
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

const extractAssistantReply = (payload: Record<string, unknown>): unknown | null => {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];

  if (choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0] as Record<string, unknown> | undefined;

  if (!firstChoice) {
    return null;
  }

  const message = firstChoice.message as Record<string, unknown> | undefined;

  if (!message) {
    return null;
  }

  const content = message.content;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];

    for (const part of content) {
      if (typeof part === 'string') {
        textParts.push(part);
        continue;
      }

      if (part && typeof part === 'object') {
        const partRecord = part as Record<string, unknown>;

        if ('json' in partRecord) {
          const jsonValue = (partRecord as { json?: unknown }).json;

          if (jsonValue !== undefined) {
            return jsonValue;
          }
        }

        if ('text' in partRecord) {
          const text = (partRecord as { text?: string }).text;

          if (typeof text === 'string') {
            textParts.push(text);
          }
        }
      }
    }

    const trimmed = textParts.join('').trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
};

const parseCoachResponse = (value: unknown): CoachResponse => {
  if (!value || typeof value !== 'object') {
    throw new Error('The AI response was empty.');
  }

  const data = value as Record<string, unknown>;

  const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
  const grammar = typeof data.grammar_feedback === 'string' ? data.grammar_feedback.trim() : '';
  const writing = typeof data.writing_feedback === 'string' ? data.writing_feedback.trim() : '';
  const pronunciation =
    typeof data.pronunciation_feedback === 'string' ? data.pronunciation_feedback.trim() : '';
  const overall = typeof data.overall_feedback === 'string' ? data.overall_feedback.trim() : '';
  const level = typeof data.english_level === 'string' ? data.english_level.trim().toUpperCase() : '';

  if (!reply) {
    throw new Error('The AI response did not include a reply.');
  }

  if (!grammar || !writing || !pronunciation || !overall) {
    throw new Error('The AI response was missing required feedback fields.');
  }

  const allowedLevels = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  const normalisedLevel = allowedLevels.has(level) ? (level as CoachResponse['level']) : 'B1';

  const transcriptValue =
    typeof data.transcript === 'string' && data.transcript.trim().length > 0
      ? data.transcript.trim()
      : null;

  const actionItems = Array.isArray(data.action_items)
    ? (data.action_items
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0) as string[])
    : [];

  return {
    reply,
    grammar,
    writing,
    pronunciation,
    overall,
    level: normalisedLevel,
    transcript: transcriptValue,
    actionItems,
  };
};

const placeholderTextColor = (isDarkMode: boolean) => (isDarkMode ? '#94a3b8' : '#64748b');

const createStyles = (isDarkMode: boolean) => {
  const theme = Colors[isDarkMode ? 'dark' : 'light'];

  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: Platform.OS === 'web' ? 24 : 16,
      gap: 16,
    },
    header: {
      gap: 8,
    },
    subtitle: {
      color: isDarkMode ? '#CBD5F5' : '#334155',
      fontSize: 15,
      lineHeight: 22,
    },
    conversation: {
      flex: 1,
      borderRadius: 16,
      padding: 16,
      backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.08)' : '#f1f5f9',
    },
    scrollContent: {
      gap: 16,
      paddingBottom: 8,
    },
    messageRow: {
      gap: 6,
    },
    userRow: {
      alignItems: 'flex-end',
    },
    assistantRow: {
      alignItems: 'flex-start',
    },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 16,
      maxWidth: '92%',
      gap: 8,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: theme.tint,
    },
    assistantBubble: {
      alignSelf: 'flex-start',
      backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#fff',
      borderWidth: isDarkMode ? 1 : 0,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.18)' : 'transparent',
    },
    userText: {
      color: isDarkMode ? '#0f172a' : '#fff',
      fontSize: 15,
      lineHeight: 22,
    },
    assistantText: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 22,
    },
    pendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    evaluationCard: {
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.12)' : '#f8fafc',
      borderWidth: isDarkMode ? 1 : 0,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.22)' : 'transparent',
    },
    evaluationLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: isDarkMode ? '#cbd5f5' : '#1e293b',
    },
    evaluationText: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.text,
    },
    levelBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: isDarkMode ? 'rgba(96, 165, 250, 0.22)' : '#dbeafe',
    },
    levelText: {
      fontSize: 13,
      fontWeight: '700',
      color: isDarkMode ? '#bfdbfe' : '#1d4ed8',
    },
    actionList: {
      gap: 6,
    },
    actionItem: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.text,
    },
    transcriptLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: isDarkMode ? '#cbd5f5' : '#1e293b',
    },
    transcriptText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.text,
    },
    composerContainer: {
      gap: 6,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.08)' : '#f8fafc',
      borderWidth: isDarkMode ? 1 : 0,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.18)' : 'transparent',
    },
    input: {
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      paddingVertical: Platform.OS === 'web' ? 10 : 6,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: isDarkMode ? 'rgba(30, 41, 59, 0.8)' : '#fff',
      color: theme.text,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.tint,
    },
    sendDisabled: {
      backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.3)' : '#cbd5f5',
    },
    recordButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDarkMode ? 'rgba(96, 165, 250, 0.22)' : '#bfdbfe',
    },
    recordActive: {
      backgroundColor: isDarkMode ? 'rgba(248, 113, 113, 0.4)' : '#fecaca',
    },
    recordingBanner: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: isDarkMode ? 'rgba(248, 113, 113, 0.25)' : '#fee2e2',
    },
    recordingText: {
      fontSize: 12,
      color: isDarkMode ? '#fecaca' : '#b91c1c',
      fontWeight: '600',
    },
    errorBubble: {
      backgroundColor: isDarkMode ? 'rgba(248, 113, 113, 0.18)' : '#fee2e2',
      borderColor: isDarkMode ? 'rgba(248, 113, 113, 0.4)' : '#fecaca',
      borderWidth: 1,
    },
    errorText: {
      color: isDarkMode ? '#fca5a5' : '#b91c1c',
    },
    audioPlayer: {
      width: 220,
      alignSelf: 'stretch',
    },
    helperText: {
      fontSize: 12,
      color: isDarkMode ? '#94a3b8' : '#475569',
    },
  });
};

const isRecordingSupported =
  Platform.OS === 'web' && typeof window !== 'undefined' && 'MediaRecorder' in window;

const encodeBlobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read audio blob.'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read audio blob.'));
    reader.readAsDataURL(blob);
  });

export default function LanguageCoachScreen() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDarkMode), [isDarkMode]);
  const scrollRef = useRef<ScrollView | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioUrlsRef = useRef<string[]>([]);
  const conversationRef = useRef<ConversationMessage[]>([]);

  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<CoachMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      text: 'Hi! I am your AI Language Coach. Send a message or record yourself speaking and I will evaluate your skills.',
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  useEffect(() => () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const updateMessage = useCallback((messageId: string, updater: (previous: CoachMessage) => CoachMessage) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id === messageId) {
          return updater(message);
        }
        return message;
      }),
    );
  }, []);

  const submitInteraction = useCallback(
    async (
      content: ConversationContent,
      assistantMessageId: string,
      userMessageId: string,
      source: MessageSource,
    ) => {
      const previousHistory = conversationRef.current;
      const updatedHistory = [...previousHistory, { role: 'user', content }];
      conversationRef.current = updatedHistory;
      setIsSending(true);

      try {
        const response = await fetch(getChatUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...updatedHistory,
            ],
            temperature: 0.4,
            response_format: RESPONSE_FORMAT,
          }),
        });

        const { json, rawText } = await readResponseContent(response);

        if (!response.ok) {
          const message = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
          throw new Error(message);
        }

        if (!json || typeof json !== 'object') {
          throw new Error('The AI service returned an empty response.');
        }

        const assistantPayload = extractAssistantReply(json);

        if (assistantPayload == null) {
          throw new Error('The AI response did not include any content.');
        }

        let parsed: unknown = assistantPayload;

        if (typeof assistantPayload === 'string') {
          try {
            parsed = JSON.parse(assistantPayload);
          } catch {
            throw new Error('The AI response was not valid JSON.');
          }
        }

        const result = parseCoachResponse(parsed);

        updateMessage(assistantMessageId, (previous) => ({
          ...previous,
          text: result.reply,
          status: undefined,
          evaluation: result,
        }));

        if (source === 'audio' && result.transcript) {
          updateMessage(userMessageId, (previous) => ({
            ...previous,
            transcript: result.transcript,
          }));
        }

        conversationRef.current = [...updatedHistory, { role: 'assistant', content: result.reply }];
      } catch (error) {
        conversationRef.current = previousHistory;
        const message = normaliseErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to contact the AI service right now. Please try again later.',
        );

        updateMessage(assistantMessageId, (previous) => ({
          ...previous,
          text: message,
          status: 'error',
        }));
      } finally {
        setIsSending(false);
      }
    },
    [updateMessage],
  );

  const sendTextMessage = useCallback(() => {
    const trimmed = inputValue.trim();

    if (trimmed.length === 0 || isSending) {
      return;
    }

    const userMessageId = createId();
    const assistantMessageId = createId();

    const userMessage: CoachMessage = {
      id: userMessageId,
      role: 'user',
      text: trimmed,
      source: 'text',
    };

    const assistantMessage: CoachMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: 'Evaluating…',
      status: 'pending',
    };

    setInputValue('');
    setMessages((current) => [...current, userMessage, assistantMessage]);

    void submitInteraction(trimmed, assistantMessageId, userMessageId, 'text');
  }, [inputValue, isSending, submitInteraction]);

  const stopMedia = useCallback(() => {
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const handleRecordingStop = useCallback(
    async (blob: Blob | null) => {
      setIsRecording(false);

      if (!blob || blob.size === 0) {
        return;
      }

      const playbackUrl = URL.createObjectURL(blob);
      audioUrlsRef.current.push(playbackUrl);

      const userMessageId = createId();
      const assistantMessageId = createId();

      const userMessage: CoachMessage = {
        id: userMessageId,
        role: 'user',
        text: 'Spoken practice clip',
        source: 'audio',
        audioPlaybackUrl: playbackUrl,
      };

      const assistantMessage: CoachMessage = {
        id: assistantMessageId,
        role: 'assistant',
        text: 'Evaluating pronunciation and language skills…',
        status: 'pending',
      };

      setMessages((current) => [...current, userMessage, assistantMessage]);

      try {
        const dataUrl = await encodeBlobToDataUrl(blob);

        const content: ConversationContent = [
          {
            type: 'input_text',
            text: 'Please review my spoken English practice. Evaluate pronunciation using the audio and comment on grammar and writing based on your transcript.',
          },
          {
            type: 'input_audio',
            audio_url: dataUrl,
          },
        ];

        await submitInteraction(content, assistantMessageId, userMessageId, 'audio');
      } catch (error) {
        const message = normaliseErrorMessage(
          error instanceof Error ? error.message : 'Failed to process the recorded audio.',
        );
        updateMessage(assistantMessageId, (previous) => ({
          ...previous,
          text: message,
          status: 'error',
        }));
      }
    },
    [submitInteraction, updateMessage],
  );

  const stopRecording = useCallback(() => {
    if (!isRecording) {
      return;
    }

    const recorder = mediaRecorderRef.current;

    if (recorder) {
      recorder.stop();
      mediaRecorderRef.current = null;
    } else {
      void handleRecordingStop(null);
    }

    stopMedia();
  }, [handleRecordingStop, isRecording, stopMedia]);

  const startRecording = useCallback(async () => {
    if (!isRecordingSupported || isRecording || isSending) {
      return;
    }

    setRecordingError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = audioChunksRef.current.length > 0 ? new Blob(audioChunksRef.current, { type: 'audio/webm' }) : null;
        audioChunksRef.current = [];
        handleRecordingStop(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      stopMedia();
      const message = normaliseErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to access the microphone. Please check your browser permissions.',
      );
      setRecordingError(message);
    }
  }, [handleRecordingStop, isRecording, isSending, stopMedia]);

  const toggleRecording = useCallback(() => {
    if (!isRecordingSupported) {
      return;
    }

    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const sendButtonDisabled = inputValue.trim().length === 0 || isSending;
  const recordButtonDisabled = !isRecordingSupported || isSending;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">AI Language Coach</ThemedText>
        <ThemedText style={styles.subtitle}>
          Practice your English, receive instant feedback on pronunciation, grammar, and writing, and track your CEFR level.
        </ThemedText>
        {isRecording && (
          <View style={styles.recordingBanner}>
            <ThemedText style={styles.recordingText}>Recording… tap again to stop.</ThemedText>
          </View>
        )}
      </View>

      <View style={styles.conversation}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent}>
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const bubbleStyles = [
              styles.bubble,
              isUser ? styles.userBubble : styles.assistantBubble,
              message.status === 'error' ? styles.errorBubble : null,
            ];
            const textStyles = [
              isUser ? styles.userText : styles.assistantText,
              message.status === 'error' ? styles.errorText : null,
            ];

            return (
              <View
                key={message.id}
                style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}
              >
                <View style={bubbleStyles}>
                  {message.audioPlaybackUrl && Platform.OS === 'web' ? (
                    <audio controls src={message.audioPlaybackUrl} style={styles.audioPlayer} />
                  ) : null}

                  {message.transcript ? (
                    <View>
                      <ThemedText style={styles.transcriptLabel}>Transcript</ThemedText>
                      <ThemedText style={styles.transcriptText}>{message.transcript}</ThemedText>
                    </View>
                  ) : null}

                  <ThemedText style={textStyles}>{message.text}</ThemedText>

                  {message.status === 'pending' ? (
                    <View style={styles.pendingRow}>
                      <ActivityIndicator size="small" color={isDarkMode ? '#cbd5f5' : '#334155'} />
                      <ThemedText style={styles.assistantText}>Analysing your skills…</ThemedText>
                    </View>
                  ) : null}

                  {message.evaluation ? (
                    <View style={styles.evaluationCard}>
                      <View style={styles.levelBadge}>
                        <ThemedText style={styles.levelText}>{message.evaluation.level}</ThemedText>
                      </View>
                      <View>
                        <ThemedText style={styles.evaluationLabel}>Overall</ThemedText>
                        <ThemedText style={styles.evaluationText}>{message.evaluation.overall}</ThemedText>
                      </View>
                      <View>
                        <ThemedText style={styles.evaluationLabel}>Grammar</ThemedText>
                        <ThemedText style={styles.evaluationText}>{message.evaluation.grammar}</ThemedText>
                      </View>
                      <View>
                        <ThemedText style={styles.evaluationLabel}>Writing</ThemedText>
                        <ThemedText style={styles.evaluationText}>{message.evaluation.writing}</ThemedText>
                      </View>
                      <View>
                        <ThemedText style={styles.evaluationLabel}>Pronunciation</ThemedText>
                        <ThemedText style={styles.evaluationText}>{message.evaluation.pronunciation}</ThemedText>
                      </View>
                      {message.evaluation.actionItems.length > 0 ? (
                        <View style={styles.actionList}>
                          <ThemedText style={styles.evaluationLabel}>Try next</ThemedText>
                          {message.evaluation.actionItems.map((item, index) => (
                            <ThemedText key={index} style={styles.actionItem}>
                              • {item}
                            </ThemedText>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.composerContainer}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={inputValue}
            onChangeText={setInputValue}
            placeholder="Write your reply in English…"
            placeholderTextColor={placeholderTextColor(isDarkMode)}
            editable={!isSending}
            multiline
            onSubmitEditing={sendTextMessage}
            returnKeyType="send"
          />
          <Pressable
            onPress={toggleRecording}
            disabled={recordButtonDisabled}
            style={[styles.recordButton, isRecording ? styles.recordActive : null, recordButtonDisabled ? styles.sendDisabled : null]}
          >
            <IconSymbol name={isRecording ? 'stop.fill' : 'mic.fill'} color={isDarkMode ? '#0f172a' : '#1e293b'} size={22} />
          </Pressable>
          <Pressable
            onPress={sendTextMessage}
            disabled={sendButtonDisabled}
            style={[styles.sendButton, sendButtonDisabled ? styles.sendDisabled : null]}
          >
            <IconSymbol name="paperplane.fill" color={sendButtonDisabled ? '#64748b' : '#fff'} size={22} />
          </Pressable>
        </View>
        {recordingError ? <ThemedText style={styles.helperText}>{recordingError}</ThemedText> : null}
        {!isRecordingSupported ? (
          <ThemedText style={styles.helperText}>
            In-browser recording is only available on modern desktop browsers. You can still chat by typing.
          </ThemedText>
        ) : null}
      </View>
    </ThemedView>
  );
}
