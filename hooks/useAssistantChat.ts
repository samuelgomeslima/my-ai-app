import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { AssistantMessage, Service } from '../lib/domain';
import type { AssistantChatCopy } from '../locales/types';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const PROXY_TOKEN = process.env.EXPO_PUBLIC_OPENAI_PROXY_TOKEN ?? '';

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

const getStatusUrl = () => {
  if (API_BASE_URL.length === 0) {
    return '/api/status';
  }

  return `${API_BASE_URL}/api/status`;
};

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const proxyAuthHeaders = PROXY_TOKEN ? { 'x-api-key': PROXY_TOKEN } : undefined;

const supportsMediaRecorder =
  Platform.OS === 'web' && typeof window !== 'undefined' && 'MediaRecorder' in window && 'navigator' in window;

type UseAssistantChatOptions = {
  systemPrompt: string;
  contextSummary: string;
  services: Service[];
  copy: AssistantChatCopy;
  onBookingsMutated?: () => Promise<void> | void;
};

type QuickReplyHandler = (suggestion: string) => void;

type VoiceHandler = () => void | Promise<void>;

type UseAssistantChatResult = {
  messages: AssistantMessage[];
  input: string;
  setInput: (value: string) => void;
  pending: boolean;
  error: string | null;
  canSend: boolean;
  assistantEnabled: boolean;
  quickReplies: string[];
  suggestionsVisible: boolean;
  showSuggestions: () => void;
  hideSuggestions: () => void;
  isRecording: boolean;
  voiceTranscribing: boolean;
  voiceButtonDisabled: boolean;
  handleSend: () => void;
  handleQuickReply: QuickReplyHandler;
  handleVoicePress: VoiceHandler;
};

const readResponseContent = async (response: Response) => {
  const rawText = await response.text();

  if (!rawText) {
    return { json: null, rawText: '' } as const;
  }

  try {
    return { json: JSON.parse(rawText) as Record<string, unknown>, rawText } as const;
  } catch {
    return { json: null, rawText } as const;
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
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
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

const formatService = (service: Service) => {
  const parts = [service.name.trim()];

  if (typeof service.durationMinutes === 'number' && Number.isFinite(service.durationMinutes)) {
    parts.push(`${service.durationMinutes} min`);
  }

  if (service.price && typeof service.price.amount === 'number' && service.price.currency) {
    const amount = service.price.amount.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    parts.push(`${service.price.currency}${amount}`);
  }

  const description = service.description.trim();
  return `${parts.join(' • ')} — ${description}`;
};

export function useAssistantChat({
  systemPrompt,
  contextSummary,
  services,
  copy,
  onBookingsMutated,
}: UseAssistantChatOptions): UseAssistantChatResult {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      content: copy.introMessage,
    },
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(copy.statusChecking);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const quickReplies = useMemo(() => {
    const serviceSuggestions = services
      .filter((service) => service.name && service.name.trim().length > 0)
      .slice(0, 6)
      .map((service) => `Tell me more about ${service.name.trim()}`);
    const combined = [...copy.defaultSuggestions, ...serviceSuggestions];
    const seen = new Set<string>();

    return combined.filter((suggestion) => {
      const trimmed = suggestion.trim();

      if (trimmed.length === 0) {
        return false;
      }

      const key = trimmed.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [copy.defaultSuggestions, services]);

  const contextMessages = useMemo(() => {
    const results: { role: 'system'; content: string }[] = [];
    const trimmedPrompt = systemPrompt.trim();

    if (trimmedPrompt.length > 0) {
      results.push({ role: 'system', content: trimmedPrompt });
    }

    const contextParts: string[] = [];
    const trimmedSummary = contextSummary.trim();

    if (trimmedSummary.length > 0) {
      contextParts.push(trimmedSummary);
    }

    if (services.length > 0) {
      const formatted = services
        .filter((service) => service.name && service.description)
        .map((service) => formatService(service))
        .join('\n');

      if (formatted.length > 0) {
        contextParts.push(`Available services:\n${formatted}`);
      }
    }

    if (contextParts.length > 0) {
      results.push({ role: 'system', content: contextParts.join('\n\n') });
    }

    return results;
  }, [contextSummary, services, systemPrompt]);

  const showSuggestions = useCallback(() => setSuggestionsVisible(true), []);
  const hideSuggestions = useCallback(() => setSuggestionsVisible(false), []);

  const canSend =
    input.trim().length > 0 && !pending && assistantEnabled && !voiceTranscribing && !isRecording;

  const voiceButtonDisabled =
    !supportsMediaRecorder || !assistantEnabled || voiceTranscribing || pending;

  useEffect(() => {
    let cancelled = false;

    const cleanupStreams = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };

    const checkAssistantAvailability = async () => {
      try {
        setError(copy.statusChecking);

        const statusResponse = await fetch(getStatusUrl());
        const { json: statusJson, rawText: statusRaw } = await readResponseContent(statusResponse);

        if (!statusResponse.ok) {
          const message = extractErrorMessage(
            statusJson,
            statusRaw,
            statusResponse.status,
            statusResponse.statusText ?? '',
          );
          throw new Error(message);
        }

        const configured =
          statusJson && typeof statusJson === 'object' && 'openaiConfigured' in statusJson
            ? Boolean((statusJson as Record<string, unknown>).openaiConfigured)
            : false;

        if (!configured) {
          if (!cancelled) {
            setAssistantEnabled(false);
            setError(copy.statusMissingApiKey);
          }
          return;
        }

        if (!PROXY_TOKEN) {
          if (!cancelled) {
            setAssistantEnabled(false);
            setError(copy.statusUnavailable);
          }
          return;
        }

        const response = await fetch(getTranscribeUrl(), {
          method: 'GET',
          headers: proxyAuthHeaders,
        });
        const { json, rawText } = await readResponseContent(response);

        if (!response.ok) {
          const message = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
          throw new Error(message);
        }

        if (!cancelled) {
          setAssistantEnabled(true);
          setError(null);
        }
      } catch (error) {
        const message = normaliseErrorMessage(
          error instanceof Error ? error.message : copy.statusNetworkError,
        );

        if (!cancelled) {
          setAssistantEnabled(false);
          setError(message.length > 0 ? message : copy.statusNetworkError);
        }
      }
    };

    checkAssistantAvailability();

    return () => {
      cancelled = true;
      cleanupStreams();
    };
  }, [copy.statusChecking, copy.statusMissingApiKey, copy.statusNetworkError, copy.statusUnavailable]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();

      if (trimmed.length === 0 || pending || !assistantEnabled) {
        return;
      }

      hideSuggestions();
      setInput('');
      setError(null);
      setPending(true);

      let history: AssistantMessage[] = [];
      const userMessage: AssistantMessage = { id: createId(), role: 'user', content: trimmed };

      setMessages((current) => {
        const next = [...current, userMessage];
        history = next;
        return next;
      });

      try {
        const payloadMessages = [
          ...contextMessages,
          ...history.map((message) => ({ role: message.role, content: message.content })),
        ];

        const response = await fetch(getChatUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(proxyAuthHeaders ?? {}),
          },
          body: JSON.stringify({
            messages: payloadMessages,
            temperature: 0.6,
          }),
        });

        const { json, rawText } = await readResponseContent(response);

        if (!response.ok) {
          const message = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
          throw new Error(message);
        }

        if (!json || typeof json !== 'object') {
          throw new Error('The assistant returned an empty response.');
        }

        const reply = extractAssistantReply(json);
        const assistantMessage: AssistantMessage = {
          id: createId(),
          role: 'assistant',
          content: reply ?? copy.emptyAssistantResponse,
        };

        setMessages((current) => [...current, assistantMessage]);

        const bookingsMutated =
          json && typeof json === 'object' && 'bookingsMutated' in json
            ? Boolean((json as Record<string, unknown>).bookingsMutated)
            : false;

        if (bookingsMutated && typeof onBookingsMutated === 'function') {
          await onBookingsMutated();
        }
      } catch (error) {
        const fallbackMessage = normaliseErrorMessage(
          error instanceof Error ? error.message : copy.statusNetworkError,
        );

        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: 'assistant',
            content: fallbackMessage,
            status: 'error',
          },
        ]);
        setError(fallbackMessage);
      } finally {
        setPending(false);
      }
    },
    [assistantEnabled, contextMessages, copy.emptyAssistantResponse, copy.statusNetworkError, hideSuggestions, onBookingsMutated, pending],
  );

  const handleSend = useCallback(() => {
    void sendMessage(input);
  }, [input, sendMessage]);

  const handleQuickReply = useCallback<QuickReplyHandler>(
    (suggestion) => {
      void sendMessage(suggestion);
    },
    [sendMessage],
  );

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      if (!PROXY_TOKEN) {
        setError(copy.statusUnavailable);
        return;
      }

      setVoiceTranscribing(true);
      setError(null);

      const pendingMessageId = createId();
      setMessages((current) => [
        ...current,
        {
          id: pendingMessageId,
          role: 'assistant',
          content: copy.voiceTranscribingMessage,
          status: 'pending',
        },
      ]);

      try {
        const formData = new FormData();
        const fileName = blob.type.includes('mpeg')
          ? 'voice-message.mp3'
          : blob.type.includes('wav')
            ? 'voice-message.wav'
            : 'voice-message.webm';
        const file = blob instanceof File ? blob : new File([blob], fileName, { type: blob.type || 'audio/webm' });
        formData.append('file', file);

        const response = await fetch(getTranscribeUrl(), {
          method: 'POST',
          headers: proxyAuthHeaders,
          body: formData,
        });

        const { json, rawText } = await readResponseContent(response);

        if (!response.ok) {
          const message = extractErrorMessage(json, rawText, response.status, response.statusText ?? '');
          throw new Error(message);
        }

        if (!json || typeof json !== 'object') {
          throw new Error('The transcription service returned an empty response.');
        }

        const text = 'text' in json && typeof json.text === 'string' ? json.text.trim() : '';

        if (text.length === 0) {
          throw new Error(copy.voiceTranscriptionFailed);
        }

        setMessages((current) => current.filter((message) => message.id !== pendingMessageId));
        await sendMessage(text);
      } catch (error) {
        const message = normaliseErrorMessage(
          error instanceof Error ? error.message : copy.voiceTranscriptionFailed,
        );

        setMessages((current) =>
          current.map((message) => {
            if (message.id === pendingMessageId) {
              return {
                ...message,
                content: copy.voiceTranscriptionFailed,
                status: 'error',
              };
            }

            return message;
          }),
        );
        setError(message.length > 0 ? message : copy.voiceTranscriptionFailed);
      } finally {
        setVoiceTranscribing(false);
      }
    },
    [copy.statusUnavailable, copy.voiceTranscribingMessage, copy.voiceTranscriptionFailed, sendMessage],
  );

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current) {
      return;
    }

    const recorder = mediaRecorderRef.current;

    if (recorder.state === 'inactive') {
      return;
    }

    recorder.stop();
    setIsRecording(false);
  }, []);

  const handleVoicePress = useCallback(async () => {
    if (!supportsMediaRecorder) {
      setError(copy.voiceNotSupported);
      return;
    }

    if (voiceTranscribing) {
      return;
    }

    if (isRecording) {
      await stopRecording();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        if (chunks.length === 0) {
          setError(copy.voiceRecordingTooShort);
          return;
        }

        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        await transcribeBlob(blob);
      };

      recorder.start();
      setIsRecording(true);
      setError(null);
    } catch (error) {
      setError(
        normaliseErrorMessage(
          error instanceof Error ? error.message : copy.voicePermissionDenied,
        ) || copy.voicePermissionDenied,
      );
    }
  }, [copy.voiceNotSupported, copy.voicePermissionDenied, copy.voiceRecordingTooShort, isRecording, transcribeBlob, voiceTranscribing]);

  return {
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
  };
}
