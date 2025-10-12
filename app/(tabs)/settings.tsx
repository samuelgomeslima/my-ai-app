import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

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
  updatedAt?: string | null;
};

type RemoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: SettingsState }
  | { status: 'error'; message: string };

const initialState: RemoteState = { status: 'idle' };

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toLocaleString();
  } catch {
    return null;
  }
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const [apiKey, setApiKey] = useState('');
  const [remoteState, setRemoteState] = useState<RemoteState>(initialState);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

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
          : 'Unable to load the OpenAI API key status.';
      setRemoteState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const handleSave = useCallback(async () => {
    const trimmed = apiKey.trim();

    if (trimmed.length === 0) {
      Alert.alert('Missing key', 'Enter your OpenAI API key before saving.');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(getSettingsUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: trimmed }),
      });

      if (!response.ok) {
        const text = await response.text();
        const fallback = text.trim().length > 0 ? text.trim() : `Request failed with status ${response.status}`;
        throw new Error(fallback);
      }

      const data = (await response.json()) as SettingsState;
      setRemoteState({ status: 'success', data });
      setApiKey('');

      if (Platform.OS !== 'web') {
        Alert.alert('Saved', 'Your OpenAI API key has been stored on the server.');
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to store the OpenAI API key. Please try again.';
      Alert.alert('Save failed', message);
    } finally {
      setIsSaving(false);
    }
  }, [apiKey]);

  const handleClear = useCallback(async () => {
    setIsClearing(true);

    try {
      const response = await fetch(getSettingsUrl(), {
        method: 'DELETE',
      });

      if (!response.ok) {
        const text = await response.text();
        const fallback = text.trim().length > 0 ? text.trim() : `Request failed with status ${response.status}`;
        throw new Error(fallback);
      }

      setRemoteState({ status: 'success', data: { configured: false } });

      if (Platform.OS !== 'web') {
        Alert.alert('Removed', 'The stored OpenAI API key has been cleared.');
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to delete the stored key. Please try again.';
      Alert.alert('Delete failed', message);
    } finally {
      setIsClearing(false);
    }
  }, []);

  const currentPreview = remoteState.status === 'success' ? remoteState.data.preview ?? null : null;
  const updatedAt = remoteState.status === 'success' ? formatTimestamp(remoteState.data.updatedAt) : null;

  return (
    <ThemedView style={styles.wrapper}>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedText type="title">OpenAI API key</ThemedText>
        <ThemedText style={styles.description}>
          Save your OpenAI API key to the Azure Functions backend. The key is stored on the server, so the transcription
          endpoint can call OpenAI on your behalf without exposing secrets to the browser.
        </ThemedText>

        <View style={styles.card}>
          <ThemedText type="subtitle">Current status</ThemedText>
          {remoteState.status === 'loading' && <ActivityIndicator color={styles.activity.color} />}
          {remoteState.status === 'error' && <ThemedText style={styles.errorText}>{remoteState.message}</ThemedText>}
          {remoteState.status === 'success' && (
            <View style={styles.statusSection}>
              <ThemedText>
                {remoteState.data.configured
                  ? 'An OpenAI API key is stored for the Functions API.'
                  : 'No OpenAI API key is stored yet.'}
              </ThemedText>
              {currentPreview && (
                <ThemedText style={styles.preview}>Masked key: {currentPreview}</ThemedText>
              )}
              {updatedAt && <ThemedText style={styles.preview}>Last updated: {updatedAt}</ThemedText>}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <ThemedText type="subtitle">Update key</ThemedText>
          <ThemedText style={styles.description}>Paste a new OpenAI API key and press Save to store it.</ThemedText>
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-..."
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
          <View style={styles.buttonRow}>
            <Pressable style={[styles.button, styles.primaryButton]} onPress={handleSave} disabled={isSaving}>
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.primaryButtonText}>Save key</ThemedText>
              )}
            </Pressable>
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              onPress={handleClear}
              disabled={isClearing || remoteState.status !== 'success' || !remoteState.data.configured}>
              {isClearing ? (
                <ActivityIndicator color={Colors[colorScheme].tint} />
              ) : (
                <ThemedText style={styles.secondaryButtonText}>Clear stored key</ThemedText>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <ThemedText type="subtitle">Configure via API</ThemedText>
          <ThemedText style={styles.description}>
            Prefer automation? Send a POST request to the Azure Functions endpoint to rotate the key without using the UI.
          </ThemedText>
          <ThemedText style={styles.codeBlock}>
            {`curl -X POST ${getSettingsUrl()} \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-your-key"}'`}
          </ThemedText>
          <ThemedText style={styles.description}>
            A GET request returns the current configuration status, and DELETE removes the stored key. These endpoints power the
            Settings screen above and can be triggered from CI/CD pipelines or infrastructure scripts.
          </ThemedText>
        </View>
      </ScrollView>
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
      gap: 24,
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
    statusSection: {
      gap: 6,
    },
    preview: {
      fontFamily: Platform.select({ web: 'monospace', default: undefined }),
    },
    input: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.16)' : '#d4d4d8',
      paddingHorizontal: 16,
      paddingVertical: Platform.select({ web: 12, default: 10 }),
      fontFamily: Platform.select({ web: 'monospace', default: undefined }),
      backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.08)' : '#f8fafc',
      color: palette.text,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      flexWrap: 'wrap',
    },
    button: {
      borderRadius: 999,
      paddingHorizontal: 20,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 140,
      gap: 8,
    },
    primaryButton: {
      backgroundColor: palette.tint,
    },
    primaryButtonText: {
      color: '#ffffff',
      fontWeight: '600',
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.24)' : palette.tint,
      backgroundColor: 'transparent',
    },
    secondaryButtonText: {
      color: palette.tint,
      fontWeight: '600',
      textAlign: 'center',
    },
    activity: {
      color: palette.tint,
    },
    errorText: {
      color: '#dc2626',
    },
    codeBlock: {
      fontFamily: Platform.select({ web: 'monospace', default: undefined }),
      backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.08)' : '#f1f5f9',
      padding: 16,
      borderRadius: 12,
      lineHeight: 18,
    },
  });
};
