import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Service } from '../lib/domain';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { defaultComponentCopy } from '../locales/componentCopy';
import type { AssistantChatCopy } from '../locales/types';

type AssistantChatProps = {
  colors: {
    text: string;
    subtext: string;
    surface: string;
    border: string;
    accent: string;
    accentFgOn: string;
    danger: string;
    bg: string;
  };
  systemPrompt: string;
  contextSummary: string;
  onBookingsMutated?: () => Promise<void> | void;
  services: Service[];
  copy?: AssistantChatCopy;
};

export default function AssistantChat({
  colors,
  systemPrompt,
  contextSummary,
  onBookingsMutated,
  services,
  copy = defaultComponentCopy.assistantChat,
}: AssistantChatProps) {
  const scrollRef = useRef<ScrollView>(null);

  const {
    messages,
    input,
    setInput,
    pending,
    error,
    canSend,
    assistantEnabled,
    quickReplies,
    suggestionsVisible,
    showSuggestions,
    hideSuggestions,
    isRecording,
    voiceTranscribing,
    voiceButtonDisabled,
    handleSend,
    handleQuickReply,
    handleVoicePress,
  } = useAssistantChat({
    systemPrompt,
    contextSummary,
    services,
    copy,
    onBookingsMutated,
  });

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
        >
          {messages.map((msg) => {
            const fromAssistant = msg.role === 'assistant';
            return (
              <View
                key={`msg-${msg.id}`}
                style={[
                  styles.bubble,
                  {
                    alignSelf: fromAssistant ? 'flex-start' : 'flex-end',
                    backgroundColor: fromAssistant ? colors.surface : colors.accent,
                    borderColor: fromAssistant ? colors.border : colors.accent,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    { color: fromAssistant ? colors.text : colors.accentFgOn },
                  ]}
                >
                  {msg.content}
                </Text>
              </View>
            );
          })}
          {pending && (
            <View
              style={[
                styles.bubble,
                {
                  alignSelf: 'flex-start',
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.typingRow}>
                <ActivityIndicator size="small" color={colors.subtext} />
                <Text style={[styles.typingText, { color: colors.subtext }]}>
                  {copy.typingIndicator}
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}

        {quickReplies.length > 0 && suggestionsVisible ? (
          <View
            style={[styles.quickRepliesContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <View style={styles.quickRepliesHeader}>
              <Text style={[styles.quickRepliesTitle, { color: colors.subtext }]}>
                {copy.quickRepliesTitle}
              </Text>
              <Pressable
                onPress={hideSuggestions}
                accessibilityRole="button"
                accessibilityLabel={copy.suggestionsAccessibility.hide}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color={colors.subtext} />
              </Pressable>
            </View>
            <View style={styles.quickRepliesGrid}>
              {quickReplies.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => handleQuickReply(suggestion)}
                  disabled={pending || voiceTranscribing || !assistantEnabled}
                  style={[
                    styles.quickReplyCard,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      opacity: pending || voiceTranscribing || !assistantEnabled ? 0.5 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={copy.quickReplyAccessibility(suggestion)}
                >
                  <View style={[styles.quickReplyIcon, { backgroundColor: colors.accent }]}>
                    <Ionicons name="sparkles-outline" size={16} color={colors.accentFgOn} />
                  </View>
                  <Text style={[styles.quickReplyText, { color: colors.text }]}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : quickReplies.length > 0 ? (
          <Pressable
            onPress={showSuggestions}
            style={[styles.quickRepliesToggle, { borderColor: colors.border, backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={copy.suggestionsAccessibility.show}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.subtext} />
            <Text style={[styles.quickRepliesToggleText, { color: colors.subtext }]}>
              {copy.quickRepliesToggleShow}
            </Text>
          </Pressable>
        ) : null}

        <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Pressable
            onPress={handleVoicePress}
            disabled={voiceButtonDisabled}
            style={[
              styles.voiceButton,
              {
                borderColor: isRecording ? colors.danger : colors.border,
                backgroundColor: isRecording ? colors.danger : colors.surface,
                opacity: voiceButtonDisabled ? 0.4 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel=
              {isRecording ? copy.voiceButtonAccessibility.stop : copy.voiceButtonAccessibility.start}
          >
            <Ionicons
              name={isRecording ? 'stop-circle' : 'mic'}
              size={18}
              color={isRecording ? colors.accentFgOn : colors.subtext}
            />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={copy.inputPlaceholder}
            placeholderTextColor={colors.subtext}
            style={[styles.input, { color: colors.text }]}
            multiline
            editable={!pending && assistantEnabled && !voiceTranscribing}
          />
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            style={[styles.sendButton, { backgroundColor: canSend ? colors.accent : colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={copy.sendAccessibility}
          >
            {pending ? (
              <ActivityIndicator color={colors.accentFgOn} />
            ) : (
              <Ionicons name="send" size={18} color={colors.accentFgOn} />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 16 },
  messages: { flex: 1 },
  bubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  messageText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  errorText: { fontSize: 12, fontWeight: '700' },
  quickRepliesContainer: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  quickRepliesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickRepliesTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  quickRepliesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickReplyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    flexShrink: 1,
    minWidth: 160,
  },
  quickReplyIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickReplyText: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  quickRepliesToggle: {
    marginTop: 4,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  quickRepliesToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    maxHeight: 100,
  },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
