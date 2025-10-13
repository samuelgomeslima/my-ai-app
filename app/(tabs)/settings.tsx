import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useColorScheme } from 'react-native';

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
  preview?: string | null;
  message?: string | null;
};

type RemoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: SettingsState }
  | { status: 'error'; message: string };

const initialState: RemoteState = { status: 'idle' };

const getStatusMessage = (state: RemoteState) => {
  if (state.status !== 'success') {
    return null;
  }

  if (state.data.message && state.data.message.trim().length > 0) {
    return state.data.message.trim();
  }

  return state.data.configured
    ? 'OPENAI_API_KEY environment variable is configured.'
    : 'OPENAI_API_KEY environment variable is missing or empty.';
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const styles = useMemo(() => createStyles(colorScheme), [colorScheme]);
  const [remoteState, setRemoteState] = useState<RemoteState>(initialState);

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
          : 'Unable to load the OpenAI API key status.';
      setRemoteState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const statusMessage = getStatusMessage(remoteState);
  const maskedPreview = remoteState.status === 'success' ? remoteState.data.preview ?? null : null;

  return (
    <ThemedView style={styles.wrapper}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">OpenAI API key</ThemedText>
        <ThemedText style={styles.description}>
          Configure the <ThemedText type="defaultSemiBold">OPENAI_API_KEY</ThemedText> environment variable in your Azure
          Functions application settings. This key is never stored by the mobile client—the settings screen simply reports the
          current status returned by the backend.
        </ThemedText>

        <View style={styles.card}>
          <ThemedText type="subtitle">Current status</ThemedText>
          {remoteState.status === 'loading' && <ActivityIndicator color={styles.activity.color} />}
          {remoteState.status === 'error' && <ThemedText style={styles.errorText}>{remoteState.message}</ThemedText>}
          {remoteState.status === 'success' && (
            <View style={styles.statusSection}>
              <ThemedText>
                {remoteState.data.configured
                  ? 'OPENAI_API_KEY is configured on the Functions app.'
                  : 'OPENAI_API_KEY is missing from the Functions app settings.'}
              </ThemedText>
              {maskedPreview && (
                <ThemedText style={styles.preview}>Masked key: {maskedPreview}</ThemedText>
              )}
              {statusMessage && <ThemedText style={styles.preview}>{statusMessage}</ThemedText>}
            </View>
          )}
          <Pressable style={styles.refreshButton} onPress={() => void fetchSettings()}>
            <ThemedText style={styles.refreshButtonText}>Refresh status</ThemedText>
          </Pressable>
        </View>

        <View style={styles.card}>
          <ThemedText type="subtitle">How to update the key</ThemedText>
          <ThemedText style={styles.instructions}>
            1. Open the Azure Portal and navigate to your Static Web Apps resource.
          </ThemedText>
          <ThemedText style={styles.instructions}>
            2. Open the linked Azure Functions app and locate the <ThemedText type="defaultSemiBold">Configuration</ThemedText>{' '}
            blade.
          </ThemedText>
          <ThemedText style={styles.instructions}>
            3. Create or update an application setting named <ThemedText type="defaultSemiBold">OPENAI_API_KEY</ThemedText> with
            your server-side OpenAI key.
          </ThemedText>
          <ThemedText style={styles.instructions}>4. Save the configuration and restart the Functions app if prompted.</ThemedText>
          <ThemedText style={styles.instructions}>
            5. Return to this screen and tap <ThemedText type="defaultSemiBold">Refresh status</ThemedText> to confirm the update.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

type ColorScheme = 'light' | 'dark';

const createStyles = (colorScheme: ColorScheme) => {
  const isDark = colorScheme === 'dark';
  const cardBackground = isDark ? '#1f242b' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)';

  return StyleSheet.create({
    wrapper: {
      flex: 1,
    },
    container: {
      flexGrow: 1,
      padding: 24,
      gap: 16,
    },
    description: {
      color: isDark ? '#d6d9dd' : '#3b4351',
      lineHeight: 20,
    },
    card: {
      backgroundColor: cardBackground,
      borderRadius: 16,
      padding: 20,
      gap: 12,
      borderWidth: 1,
      borderColor,
      shadowColor: '#000',
      shadowOpacity: isDark ? 0.25 : 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    activity: {
      color: Colors[colorScheme].tint,
    },
    errorText: {
      color: '#ef4444',
    },
    statusSection: {
      gap: 6,
    },
    preview: {
      color: isDark ? '#9ca3af' : '#4b5563',
    },
    refreshButton: {
      marginTop: 8,
      alignSelf: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: Colors[colorScheme].tint,
    },
    refreshButtonText: {
      color: isDark ? '#0f172a' : '#ffffff',
      fontWeight: '600',
    },
    instructions: {
      color: isDark ? '#d6d9dd' : '#3b4351',
      lineHeight: 20,
    },
  });
};
