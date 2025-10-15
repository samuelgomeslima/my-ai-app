import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import AssistantChat from '@/components/assistant-chat';
import type { Service } from '@/lib/domain';

const ASSISTANT_SYSTEM_PROMPT = `You are an attentive concierge for the My AI App studio. You specialise in helping guests plan
appointments, explain available services, and capture any relevant booking details. Always keep your
responses concise, friendly, and proactive. If you do not know something, be transparent about it.`;

const ASSISTANT_CONTEXT_SUMMARY = `The user is talking to a virtual studio concierge that can help with discovery, scheduling, and
questions about the available services. Offer to guide the user through next steps when appropriate.`;

const DEFAULT_SERVICES: Service[] = [
  {
    id: 'svc-cut',
    name: 'Signature Haircut',
    description: 'A precision cut that includes consultation, wash, and finish.',
    durationMinutes: 60,
    price: { amount: 68, currency: '$' },
  },
  {
    id: 'svc-color',
    name: 'Colour Refresh',
    description: 'Full colour service with tone matching and protective treatment.',
    durationMinutes: 120,
    price: { amount: 155, currency: '$' },
  },
  {
    id: 'svc-style',
    name: 'Event Styling',
    description: 'Custom styling session tailored for shoots, events, or special evenings.',
    durationMinutes: 75,
    price: { amount: 95, currency: '$' },
  },
  {
    id: 'svc-consult',
    name: 'New Guest Consultation',
    description: 'A relaxed consultation to understand goals before the first appointment.',
    durationMinutes: 30,
    price: { amount: 0, currency: '$' },
  },
];

const lightPalette = {
  text: '#1f2933',
  subtext: '#4b5563',
  surface: '#ffffff',
  border: '#e5e7eb',
  accent: '#2563eb',
  accentFgOn: '#ffffff',
  danger: '#dc2626',
  bg: '#f3f4f6',
};

const darkPalette = {
  text: '#f9fafb',
  subtext: '#d1d5db',
  surface: '#1f2937',
  border: '#374151',
  accent: '#3b82f6',
  accentFgOn: '#0b1120',
  danger: '#f87171',
  bg: '#111827',
};

export default function HomeScreen() {
  const colorScheme = useColorScheme();

  const colors = useMemo(() => (colorScheme === 'dark' ? darkPalette : lightPalette), [colorScheme]);

  return (
    <AssistantChat
      colors={colors}
      systemPrompt={ASSISTANT_SYSTEM_PROMPT}
      contextSummary={ASSISTANT_CONTEXT_SUMMARY}
      services={DEFAULT_SERVICES}
    />
  );
}
