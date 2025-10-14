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

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  status?: 'pending' | 'error';
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
      paddingVertical: 10,
      borderRadius: 16,
      maxWidth: '92%',
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
    errorBubble: {
      backgroundColor: isDarkMode ? 'rgba(248, 113, 113, 0.18)' : '#fee2e2',
      borderColor: isDarkMode ? 'rgba(248, 113, 113, 0.4)' : '#fecaca',
      borderWidth: 1,
    },
    errorText: {
      color: isDarkMode ? '#fca5a5' : '#b91c1c',
    },
  });
};

const placeholderTextColor = (isDarkMode: boolean) => (isDarkMode ? '#94a3b8' : '#64748b');

export default function ChatScreen() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDarkMode), [isDarkMode]);
  const scrollRef = useRef<ScrollView | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      text: 'Hi there! Ask me about your transcripts, get writing help, or brainstorm new ideas.',
    },
  ]);
  const [isSending, setIsSending] = useState(false);

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

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();

    if (trimmed.length === 0 || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      text: trimmed,
    };

    const assistantMessage: ChatMessage = {
      id: createId(),
      role: 'assistant',
      text: 'Thinking...',
      status: 'pending',
    };

    const previousMessages = messages.filter(
      (message) => message.status !== 'pending' && message.status !== 'error',
    );
    const outgoingMessages = [...previousMessages, userMessage].map((message) => ({
      role: message.role,
      content: message.text,
    }));

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInputValue('');
    setIsSending(true);

    try {
      const response = await fetch(getChatUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: outgoingMessages,
          temperature: 0.6,
        }),
      });

      const { json, rawText } = await readResponseContent(response);

      if (!response.ok || !json) {
        const errorMessage = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
        throw new Error(errorMessage);
      }

      const reply = extractAssistantReply(json);

      if (!reply) {
        throw new Error('The AI response did not include a message.');
      }

      updateAssistantMessage(assistantMessage.id, (previous) => ({
        ...previous,
        text: reply,
        status: undefined,
      }));
    } catch (error) {
      const message = normaliseErrorMessage(error instanceof Error ? error.message : 'Unable to send your message.');
      updateAssistantMessage(assistantMessage.id, (previous) => ({
        ...previous,
        text: message,
        status: 'error',
      }));
    } finally {
      setIsSending(false);
    }
  }, [inputValue, isSending, messages, updateAssistantMessage]);

  const sendDisabled = isSending || inputValue.trim().length === 0;
  const theme = Colors[isDarkMode ? 'dark' : 'light'];
  const pendingIndicatorColor = theme.tint;
  const sendIconColor = isDarkMode ? '#0f172a' : '#fff';

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Chat</ThemedText>
        <ThemedText style={styles.subtitle}>
          Talk with the AI assistant to summarise transcripts, draft follow-up questions, or explore new ideas.
        </ThemedText>
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
                  {isPending ? (
                    <View style={styles.pendingRow}>
                      <ActivityIndicator size="small" color={isUser ? '#fff' : pendingIndicatorColor} />
                      <ThemedText
                        style={[isUser ? styles.userText : styles.assistantText, isError ? styles.errorText : undefined]}>
                        {message.text}
                      </ThemedText>
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
        <TextInput
          style={styles.input}
          value={inputValue}
          editable={!isSending}
          placeholder="Ask a question"
          placeholderTextColor={placeholderTextColor(isDarkMode)}
          onChangeText={setInputValue}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          onPress={sendMessage}
          disabled={sendDisabled}
          style={[styles.sendButton, !sendDisabled ? styles.sendEnabled : styles.sendDisabled]}>
          {isSending ? (
            <ActivityIndicator size="small" color={sendIconColor} />
          ) : (
            <IconSymbol name="paperplane.fill" color={sendIconColor} size={22} />
          )}
        </Pressable>
      </View>
    </ThemedView>
  );
}
