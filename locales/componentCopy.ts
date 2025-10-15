import type { AssistantChatCopy } from './types';

const assistantChat: AssistantChatCopy = {
  introMessage:
    "Hi there! I'm your AI booking assistant. Ask me about services, availability, or anything else you'd like to plan.",
  typingIndicator: 'Assistant is thinking…',
  inputPlaceholder: 'Send a message…',
  sendAccessibility: 'Send message to the assistant',
  quickRepliesTitle: 'Suggested questions',
  quickRepliesToggleShow: 'Show suggestions',
  suggestionsAccessibility: {
    show: 'Show quick reply suggestions',
    hide: 'Hide quick reply suggestions',
  },
  quickReplyAccessibility: (suggestion) => `Ask the assistant: ${suggestion}`,
  defaultSuggestions: [
    'Show me popular services',
    'Can you help me book an appointment?',
    'What are your opening hours?',
    'I need recommendations based on my schedule',
  ],
  voiceButtonAccessibility: {
    start: 'Start recording a voice message for the assistant',
    stop: 'Stop recording your voice message',
  },
  voiceNotSupported: 'Voice capture is not supported on this device.',
  voicePermissionDenied: 'Microphone access was denied. Please enable it in your browser settings.',
  voiceRecordingTooShort: 'I did not catch that. Try recording again and speak a little longer.',
  voiceTranscribingMessage: 'Transcribing your voice message…',
  voiceTranscriptionFailed: 'Sorry, I could not understand that recording.',
  statusChecking: 'Checking assistant availability…',
  statusUnavailable: 'The assistant is currently unavailable. Please try again later.',
  statusMissingApiKey: 'The assistant is not configured with an API key on the server.',
  statusNetworkError: 'Unable to contact the assistant service right now.',
  emptyAssistantResponse: "I'm not sure how to respond to that, but I'm still here to help!",
};

export const defaultComponentCopy = {
  assistantChat,
};
