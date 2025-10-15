export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes?: number;
  price?: {
    amount: number;
    currency: string;
  };
};

export type AssistantMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  status?: 'pending' | 'error';
};
