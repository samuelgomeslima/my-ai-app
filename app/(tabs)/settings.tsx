import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

const getSettingsUrl = () => {
  if (!API_BASE_URL) {
    return '/api/openai-settings';
  }

  return `${API_BASE_URL}/api/openai-settings`;
};

type SettingsState = {
  configured: boolean;
};

type RemoteState =
  | { status: 'loading' }
  | { status: 'success'; data: SettingsState }
  | { status: 'error'; message: string };

const initialState: RemoteState = { status: 'loading' };

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const [remoteState, setRemoteState] = useState<RemoteState>(initialState);

  const styles = useMemo(() => createStyles(colorScheme), [colorScheme]);

  const fetchSettings = useCallback(async () => {
    setRemoteState({ status: 'loading' });

    try {
      const response = await fetch(getSettingsUrl());

      if (!response.ok) {
        const text = await response.text();
        const fallback = text.trim().length > 0 ? text.trim() : `Request failed with status ${response.status}`;
        throw new Error(fallback);
      }

      const data = (await response.json()) as SettingsState;
      setRemoteState({ status: 'success', data });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to check the OpenAI API key status.';
      setRemoteState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return (
    <ThemedView style={styles.wrapper}>
      <View style={styles.container}>
        <ThemedText type="title">OpenAI API key</ThemedText>
        <ThemedText style={styles.description}>
          Checking whether an OpenAI API key is configured for the backend.
        </ThemedText>

        <View style={styles.card}>
          {remoteState.status === 'loading' && (
            <View style={styles.statusRow}>
              <ActivityIndicator color={styles.activity.color} />
              <ThemedText>Checking status…</ThemedText>
            </View>
          )}

          {remoteState.status === 'error' && (
            <ThemedText style={styles.errorText}>{remoteState.message}</ThemedText>
          )}

          {remoteState.status === 'success' && (
            <ThemedText>
              {remoteState.data.configured
                ? 'An OpenAI API key is available for the backend.'
                : 'No OpenAI API key is currently configured.'}
            </ThemedText>
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const createStyles = (scheme: 'light' | 'dark') => {
  const palette = Colors[scheme];

  return StyleSheet.create({
    wrapper: {
      flex: 1,
      backgroundColor: palette.background,
    },
    container: {
      paddingHorizontal: 20,
      paddingVertical: 24,
      gap: 16,
    },
    description: {
      lineHeight: 20,
    },
    card: {
      borderRadius: 16,
      padding: 20,
      backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.05)' : '#ffffff',
      gap: 12,
      shadowColor: '#0f172a33',
      shadowOpacity: scheme === 'dark' ? 0 : 0.08,
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 30,
      elevation: 2,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    activity: {
      color: palette.tint,
    },
    errorText: {
      color: '#dc2626',
    },
  });
};
