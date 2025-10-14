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
// eslint-disable-next-line import/no-unresolved
import { Audio } from 'expo-av';

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

const getTranscribeUrl = () => {
  if (API_BASE_URL.length === 0) {
    return '/api/transcribe';
  }

  return `${API_BASE_URL}/api/transcribe`;
};

type ChatRole = 'user' | 'assistant';

type MessageSource = 'text' | 'audio';

type EvaluationDetail = {
  score?: number;
  rating?: string;
  feedback?: string;
  issues?: string[];
  recommendations?: string[];
  actionableTips?: string[];
};

type CefrAssessment = {
  level?: string;
  justification?: string;
  focusAreas?: string[];
  nextSteps?: string[];
};

type EvaluationResult = {
  language?: string;
  summary?: string;
  pronunciation?: EvaluationDetail;
  grammar?: EvaluationDetail;
  fluency?: EvaluationDetail;
  cefrAssessment?: CefrAssessment;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status?: 'pending' | 'error';
  source?: MessageSource;
  metadata?: {
    language: string;
    durationSeconds?: number | null;
  };
  evaluation?: EvaluationResult;
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

const extractAssistantReply = (payload: Record<string, unknown>) => {
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
    return content.trim();
  }

  if (Array.isArray(content)) {
    const textContent = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: string }).text;
          if (typeof text === 'string') {
            return text;
          }
        }

        return '';
      })
      .join('');

    const trimmed = textContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
};

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
    languageSelector: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    languageOption: {
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.4)' : '#cbd5f5',
      backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.6)' : '#fff',
    },
    languageSelected: {
      backgroundColor: theme.tint,
      borderColor: theme.tint,
    },
    languageText: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#CBD5F5' : '#1e293b',
    },
    languageTextActive: {
      color: isDarkMode ? '#0f172a' : '#fff',
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
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 18,
      maxWidth: '96%',
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
      width: '100%',
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
    metadataText: {
      fontSize: 13,
      color: isDarkMode ? '#cbd5f5' : '#475569',
      marginBottom: 6,
    },
    pendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
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
    },
    sendEnabled: {
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
      borderWidth: 1,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.35)' : '#cbd5f5',
      backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.6)' : '#e2e8f0',
    },
    recordButtonActive: {
      backgroundColor: '#ef4444',
      borderColor: '#ef4444',
    },
    recordButtonDisabled: {
      opacity: 0.5,
    },
    recordingStatusRow: {
      gap: 6,
    },
    recordingIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    recordingLabel: {
      fontSize: 13,
      color: isDarkMode ? '#f8fafc' : '#1e293b',
    },
    recordingMessage: {
      fontSize: 13,
      color: '#f97316',
    },
    errorBubble: {
      backgroundColor: isDarkMode ? 'rgba(248, 113, 113, 0.18)' : '#fee2e2',
      borderColor: isDarkMode ? 'rgba(248, 113, 113, 0.4)' : '#fecaca',
      borderWidth: 1,
    },
    errorText: {
      color: isDarkMode ? '#fca5a5' : '#b91c1c',
    },
    evaluationSummary: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.text,
      marginBottom: 12,
    },
    metricsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 12,
    },
    metricCard: {
      flexGrow: 1,
      minWidth: 220,
      borderRadius: 14,
      padding: 14,
      gap: 6,
      backgroundColor: isDarkMode ? 'rgba(148, 163, 184, 0.12)' : '#e2e8f0',
    },
    metricHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    metricLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: isDarkMode ? '#e2e8f0' : '#0f172a',
    },
    metricScore: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.tint,
    },
    metricRating: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#cbd5f5' : '#1f2937',
    },
    metricFeedback: {
      fontSize: 14,
      lineHeight: 20,
      color: isDarkMode ? '#e2e8f0' : '#1e293b',
    },
    metricListSection: {
      gap: 4,
    },
    metricListTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: isDarkMode ? '#cbd5f5' : '#475569',
    },
    metricListItem: {
      fontSize: 13,
      lineHeight: 18,
      color: isDarkMode ? '#f8fafc' : '#334155',
    },
    cefrCard: {
      borderRadius: 14,
      padding: 16,
      gap: 8,
      backgroundColor: isDarkMode ? 'rgba(79, 70, 229, 0.22)' : '#e0e7ff',
      borderWidth: isDarkMode ? 1 : 0,
      borderColor: isDarkMode ? 'rgba(99, 102, 241, 0.45)' : 'transparent',
    },
    cefrHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cefrLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: isDarkMode ? '#ede9fe' : '#1e1b4b',
    },
    cefrBadge: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 4,
      backgroundColor: isDarkMode ? '#6366f1' : '#4338ca',
    },
    cefrBadgeText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#fff',
    },
    cefrText: {
      fontSize: 14,
      lineHeight: 20,
      color: isDarkMode ? '#f8fafc' : '#1e293b',
    },
  });
};

const placeholderTextColor = (isDarkMode: boolean) => (isDarkMode ? '#94a3b8' : '#64748b');

const evaluationMetricSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    score: { type: 'number', minimum: 0, maximum: 100 },
    rating: { type: 'string' },
    feedback: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    actionableTips: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'rating', 'feedback'],
} as const;

const evaluationResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'language_speaking_evaluation',
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        language: { type: 'string' },
        summary: { type: 'string' },
        pronunciation: evaluationMetricSchema,
        grammar: evaluationMetricSchema,
        fluency: evaluationMetricSchema,
        cefrAssessment: {
          type: 'object',
          additionalProperties: true,
          properties: {
            level: { type: 'string', enum: ['B1', 'B2', 'C1', 'C2', 'A1', 'A2'] },
            justification: { type: 'string' },
            focusAreas: { type: 'array', items: { type: 'string' } },
            nextSteps: { type: 'array', items: { type: 'string' } },
          },
          required: ['level', 'justification'],
        },
      },
      required: ['summary', 'pronunciation', 'grammar', 'fluency', 'cefrAssessment'],
    },
  },
} as const;

const languageOptions = [
  { id: 'English', label: 'English' },
  { id: 'Italian', label: 'Italian' },
  { id: 'French', label: 'French' },
];

const parseEvaluation = (value: string): EvaluationResult | null => {
  try {
    const parsed = JSON.parse(value) as EvaluationResult;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
};

const buildSystemPrompt = (language: string) =>
  `You are a supportive ${language} language speaking coach. Evaluate each submission using the provided transcript and any metadata. Offer concise, constructive feedback on pronunciation, grammar, and fluency with scores from 0-100 and short ratings. Suggest targeted practice activities. Estimate the speaker's CEFR level (B1, B2, C1, or C2) with justification and next steps. Mention if audio quality limits the pronunciation analysis. Respond using the JSON schema provided.`;

export default function ChatScreen() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDarkMode), [isDarkMode]);
  const scrollRef = useRef<ScrollView | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(languageOptions[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      text:
        'Welcome! Choose English, Italian, or French, then record or type a short speaking sample so I can evaluate your pronunciation, grammar, and CEFR level.',
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [microphoneMessage, setMicrophoneMessage] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const updateAssistantMessage = useCallback((messageId: string, updater: (previous: ChatMessage) => ChatMessage) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id === messageId) {
          return updater(message);
        }
        return message;
      }),
    );
  }, []);

  const evaluateSpeech = useCallback(
    async (
      transcript: string,
      metadata: {
        source: MessageSource;
        durationSeconds?: number | null;
      },
    ) => {
      const trimmed = transcript.trim();

      if (trimmed.length === 0) {
        setMicrophoneMessage('I could not detect any speech. Please try again with a clearer sample.');
        return;
      }

      const language = selectedLanguage.label;

      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        text: trimmed,
        source: metadata.source,
        metadata: {
          language,
          durationSeconds: metadata.durationSeconds ?? null,
        },
      };

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        text: `Evaluating your ${language} speaking sample...`,
        status: 'pending',
      };

      setMessages((current) => [...current, userMessage, assistantMessage]);
      setIsSending(true);

      try {
        const response = await fetch(getChatUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content: buildSystemPrompt(language),
              },
              {
                role: 'user',
                content: JSON.stringify({
                  language,
                  transcript: trimmed,
                  durationSeconds: metadata.durationSeconds ?? null,
                  submissionType: metadata.source,
                }),
              },
            ],
            temperature: 0.3,
            response_format: evaluationResponseFormat,
          }),
        });

        const { json, rawText } = await readResponseContent(response);

        if (!response.ok || !json) {
          const errorMessage = extractErrorMessage(
            json,
            rawText,
            response.status,
            response.statusText ?? '',
          );
          throw new Error(errorMessage);
        }

        const reply = extractAssistantReply(json);

        if (!reply) {
          throw new Error('The evaluation response was empty.');
        }

        const parsed = parseEvaluation(reply);

        updateAssistantMessage(assistantMessage.id, (previous) => ({
          ...previous,
          text: parsed?.summary || reply,
          status: undefined,
          evaluation: parsed
            ? {
                language: parsed.language ?? language,
                summary: parsed.summary,
                pronunciation: parsed.pronunciation,
                grammar: parsed.grammar,
                fluency: parsed.fluency,
                cefrAssessment: parsed.cefrAssessment,
              }
            : undefined,
        }));
      } catch (error) {
        const message = normaliseErrorMessage(
          error instanceof Error ? error.message : 'Unable to evaluate your speaking sample.',
        );
        updateAssistantMessage(assistantMessage.id, (previous) => ({
          ...previous,
          text: message,
          status: 'error',
        }));
      } finally {
        setIsSending(false);
      }
    },
    [selectedLanguage, updateAssistantMessage],
  );

  const transcribeAudio = useCallback(
    async (uri: string, durationSeconds: number | null) => {
      setIsTranscribing(true);
      setMicrophoneMessage(null);

      try {
        const formData = new FormData();

        if (Platform.OS === 'web') {
          const response = await fetch(uri);
          const blob = await response.blob();
          formData.append('file', blob, 'speech.webm');
        } else {
          const nativeAudioFile = {
            uri,
            name: 'speech.m4a',
            type: 'audio/m4a',
          } as const;
          formData.append('file', nativeAudioFile as unknown as Blob);
        }

        const response = await fetch(getTranscribeUrl(), {
          method: 'POST',
          body: formData,
        });

        const { json, rawText } = await readResponseContent(response);

        if (!response.ok || !json) {
          const errorMessage = extractErrorMessage(
            json,
            rawText,
            response.status,
            response.statusText ?? '',
          );
          throw new Error(errorMessage);
        }

        const transcript = typeof json.text === 'string' ? json.text.trim() : '';

        if (!transcript) {
          setMicrophoneMessage('No speech was detected in the recording. Please try again.');
          return;
        }

        await evaluateSpeech(transcript, { source: 'audio', durationSeconds });
      } catch (error) {
        const message = normaliseErrorMessage(
          error instanceof Error ? error.message : 'Unable to transcribe the audio sample.',
        );
        setMicrophoneMessage(message);
      } finally {
        setIsTranscribing(false);
      }
    },
    [evaluateSpeech],
  );

  const startRecording = useCallback(async () => {
    if (isRecording || isSending || isTranscribing) {
      return;
    }

    if (Platform.OS === 'web') {
      setMicrophoneMessage('Audio recording is not supported in the web preview.');
      return;
    }

    setMicrophoneMessage(null);

    try {
      const permission = await Audio.requestPermissionsAsync();

      if (!permission.granted) {
        setMicrophoneMessage('Please enable microphone access to record audio.');
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();

      setRecording(newRecording);
      setIsRecording(true);
    } catch (error) {
      const message = normaliseErrorMessage(
        error instanceof Error ? error.message : 'Unable to start recording.',
      );
      setMicrophoneMessage(message);
    }
  }, [isRecording, isSending, isTranscribing]);

  const stopRecording = useCallback(async () => {
    if (!recording) {
      return;
    }

    setIsRecording(false);

    try {
      await recording.stopAndUnloadAsync();
    } catch (error) {
      const message = normaliseErrorMessage(
        error instanceof Error ? error.message : 'There was a problem stopping the recording.',
      );
      setMicrophoneMessage(message);
      return;
    }

    let durationSeconds: number | null = null;

    try {
      const status = await recording.getStatusAsync();
      if (status && typeof status === 'object' && 'durationMillis' in status) {
        const millis = Number((status as { durationMillis?: number }).durationMillis);
        if (Number.isFinite(millis)) {
          durationSeconds = Math.round(millis / 1000);
        }
      }
    } catch {
      durationSeconds = null;
    }

    const uri = recording.getURI();
    setRecording(null);

    if (!uri) {
      setMicrophoneMessage('We could not access the recorded file. Please try again.');
      return;
    }

    await transcribeAudio(uri, durationSeconds);
  }, [recording, transcribeAudio]);

  useEffect(() => {
    return () => {
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => undefined);
      }
    };
  }, [recording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      void stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleSendText = useCallback(() => {
    const trimmed = inputValue.trim();

    if (!trimmed || isSending || isRecording || isTranscribing) {
      return;
    }

    setInputValue('');
    void evaluateSpeech(trimmed, { source: 'text', durationSeconds: null });
  }, [inputValue, isSending, isRecording, isTranscribing, evaluateSpeech]);

  const sendDisabled =
    isSending || isRecording || isTranscribing || inputValue.trim().length === 0;
  const recordDisabled = isSending || isTranscribing;
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const pendingIndicatorColor = theme.tint;
  const sendIconColor = isDarkMode ? '#0f172a' : '#fff';
  const recordIconColor = isRecording ? '#fff' : isDarkMode ? '#f8fafc' : '#1f2937';

  const renderMetricCard = useCallback(
    (label: string, detail?: EvaluationDetail) => {
      if (!detail) {
        return null;
      }

      const practiceItems = detail.recommendations?.length
        ? detail.recommendations
        : detail.actionableTips;

      return (
        <View key={label} style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <ThemedText style={styles.metricLabel}>{label}</ThemedText>
            {typeof detail.score === 'number' ? (
              <ThemedText style={styles.metricScore}>{`${Math.round(detail.score)}/100`}</ThemedText>
            ) : null}
          </View>
          {detail.rating ? <ThemedText style={styles.metricRating}>{detail.rating}</ThemedText> : null}
          {detail.feedback ? (
            <ThemedText style={styles.metricFeedback}>{detail.feedback}</ThemedText>
          ) : null}
          {detail.issues && detail.issues.length > 0 ? (
            <View style={styles.metricListSection}>
              <ThemedText style={styles.metricListTitle}>Key issues</ThemedText>
              {detail.issues.map((issue) => (
                <ThemedText key={issue} style={styles.metricListItem}>
                  • {issue}
                </ThemedText>
              ))}
            </View>
          ) : null}
          {practiceItems && practiceItems.length > 0 ? (
            <View style={styles.metricListSection}>
              <ThemedText style={styles.metricListTitle}>Suggested practice</ThemedText>
              {practiceItems.map((tip) => (
                <ThemedText key={tip} style={styles.metricListItem}>
                  • {tip}
                </ThemedText>
              ))}
            </View>
          ) : null}
        </View>
      );
    },
    [styles],
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Language Coach</ThemedText>
        <ThemedText style={styles.subtitle}>
          Practise English, Italian, or French and receive instant feedback on pronunciation, grammar, and CEFR speaking level.
        </ThemedText>
        <View style={styles.languageSelector}>
          {languageOptions.map((option) => {
            const isActive = option.id === selectedLanguage.id;

            return (
              <Pressable
                key={option.id}
                onPress={() => setSelectedLanguage(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={[styles.languageOption, isActive ? styles.languageSelected : undefined]}>
                <ThemedText
                  style={[styles.languageText, isActive ? styles.languageTextActive : undefined]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.conversation}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const isError = message.status === 'error';
            const isPending = message.status === 'pending';

            return (
              <View
                key={message.id}
                style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
                <View
                  style={[
                    styles.bubble,
                    isUser ? styles.userBubble : styles.assistantBubble,
                    isError ? styles.errorBubble : undefined,
                  ]}>
                  {isUser && message.metadata ? (
                    <ThemedText style={styles.metadataText}>
                      {message.source === 'audio' ? '🎙️ Audio sample' : '✍️ Text prompt'} • {message.metadata.language}
                      {typeof message.metadata.durationSeconds === 'number'
                        ? ` • ${message.metadata.durationSeconds}s`
                        : ''}
                    </ThemedText>
                  ) : null}

                  {isPending ? (
                    <View style={styles.pendingRow}>
                      <ActivityIndicator size="small" color={isUser ? '#fff' : pendingIndicatorColor} />
                      <ThemedText
                        style={[isUser ? styles.userText : styles.assistantText, isError ? styles.errorText : undefined]}>
                        {message.text}
                      </ThemedText>
                    </View>
                  ) : message.evaluation ? (
                    <View>
                      <ThemedText style={styles.evaluationSummary}>{message.evaluation.summary}</ThemedText>
                      <View style={styles.metricsRow}>
                        {renderMetricCard('Pronunciation', message.evaluation.pronunciation)}
                        {renderMetricCard('Grammar', message.evaluation.grammar)}
                        {renderMetricCard('Fluency', message.evaluation.fluency)}
                      </View>
                      {message.evaluation.cefrAssessment ? (
                        <View style={styles.cefrCard}>
                          <View style={styles.cefrHeader}>
                            <ThemedText style={styles.cefrLabel}>CEFR level</ThemedText>
                            <View style={styles.cefrBadge}>
                              <ThemedText style={styles.cefrBadgeText}>
                                {message.evaluation.cefrAssessment.level ?? '—'}
                              </ThemedText>
                            </View>
                          </View>
                          {message.evaluation.cefrAssessment.justification ? (
                            <ThemedText style={styles.cefrText}>
                              {message.evaluation.cefrAssessment.justification}
                            </ThemedText>
                          ) : null}
                          {message.evaluation.cefrAssessment.focusAreas &&
                          message.evaluation.cefrAssessment.focusAreas.length > 0 ? (
                            <View style={styles.metricListSection}>
                              <ThemedText style={styles.metricListTitle}>Focus next on</ThemedText>
                              {message.evaluation.cefrAssessment.focusAreas.map((item) => (
                                <ThemedText key={item} style={styles.metricListItem}>
                                  • {item}
                                </ThemedText>
                              ))}
                            </View>
                          ) : null}
                          {message.evaluation.cefrAssessment.nextSteps &&
                          message.evaluation.cefrAssessment.nextSteps.length > 0 ? (
                            <View style={styles.metricListSection}>
                              <ThemedText style={styles.metricListTitle}>Next speaking actions</ThemedText>
                              {message.evaluation.cefrAssessment.nextSteps.map((item) => (
                                <ThemedText key={item} style={styles.metricListItem}>
                                  • {item}
                                </ThemedText>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <ThemedText
                      style={[isUser ? styles.userText : styles.assistantText, isError ? styles.errorText : undefined]}>
                      {message.text}
                    </ThemedText>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.composer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
          onPress={toggleRecording}
          disabled={recordDisabled}
          style={[
            styles.recordButton,
            isRecording ? styles.recordButtonActive : undefined,
            recordDisabled ? styles.recordButtonDisabled : undefined,
          ]}>
          {isRecording ? (
            <IconSymbol name="stop.fill" color={recordIconColor} size={20} />
          ) : (
            <IconSymbol name="mic.fill" color={recordIconColor} size={20} />
          )}
        </Pressable>

        <TextInput
          style={styles.input}
          value={inputValue}
          editable={!isSending && !isRecording && !isTranscribing}
          placeholder={`Share a ${selectedLanguage.label} speaking sample`}
          placeholderTextColor={placeholderTextColor(isDarkMode)}
          onChangeText={setInputValue}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send for feedback"
          onPress={handleSendText}
          disabled={sendDisabled}
          style={[styles.sendButton, !sendDisabled ? styles.sendEnabled : styles.sendDisabled]}>
          {isSending ? (
            <ActivityIndicator size="small" color={sendIconColor} />
          ) : (
            <IconSymbol name="paperplane.fill" color={sendIconColor} size={22} />
          )}
        </Pressable>
      </View>

      {(isRecording || isTranscribing || microphoneMessage) && (
        <View style={styles.recordingStatusRow}>
          {isRecording ? (
            <ThemedText style={styles.recordingLabel}>
              Recording... tap the button again when you finish speaking.
            </ThemedText>
          ) : null}
          {isTranscribing ? (
            <View style={styles.recordingIndicator}>
              <ActivityIndicator size="small" color={pendingIndicatorColor} />
              <ThemedText style={styles.recordingLabel}>Analysing your pronunciation…</ThemedText>
            </View>
          ) : null}
          {microphoneMessage ? (
            <ThemedText style={styles.recordingMessage}>{microphoneMessage}</ThemedText>
          ) : null}
        </View>
      )}
    </ThemedView>
  );
}
