export type AssistantChatCopy = {
  introMessage: string;
  typingIndicator: string;
  inputPlaceholder: string;
  sendAccessibility: string;
  quickRepliesTitle: string;
  quickRepliesToggleShow: string;
  suggestionsAccessibility: {
    show: string;
    hide: string;
  };
  quickReplyAccessibility: (suggestion: string) => string;
  defaultSuggestions: string[];
  voiceButtonAccessibility: {
    start: string;
    stop: string;
  };
  voiceNotSupported: string;
  voicePermissionDenied: string;
  voiceRecordingTooShort: string;
  voiceTranscribingMessage: string;
  voiceTranscriptionFailed: string;
  statusChecking: string;
  statusUnavailable: string;
  statusMissingApiKey: string;
  statusNetworkError: string;
  emptyAssistantResponse: string;
};
