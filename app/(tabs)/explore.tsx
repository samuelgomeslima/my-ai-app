import { Linking, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const openLink = (url: string) => {
  void Linking.openURL(url);
};

export default function GuideScreen() {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.section}>
        <ThemedText type="title">How it works</ThemedText>
        <ThemedText style={styles.paragraph}>
          The Audio Assistant sends recordings to an Azure Function that wraps OpenAI&apos;s transcription API. Your API key is
          stored securely in the Azure Functions configuration, so it never reaches the browser.
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Local testing checklist</ThemedText>
        <ThemedText style={styles.paragraph}>1. Install dependencies for both the Expo app and the `api` folder.</ThemedText>
        <ThemedText style={styles.paragraph}>
          2. Copy <ThemedText type="defaultSemiBold">api/local.settings.json.example</ThemedText> to{' '}
          <ThemedText type="defaultSemiBold">api/local.settings.json</ThemedText> and add your OpenAI key.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          3. Export <ThemedText type="defaultSemiBold">EXPO_PUBLIC_TRANSCRIBE_API_KEY</ThemedText> with the same proxy token
          defined in <ThemedText type="defaultSemiBold">api/local.settings.json</ThemedText> (or set
          <ThemedText type="defaultSemiBold">EXPO_PUBLIC_AZURE_FUNCTIONS_KEY</ThemedText>).
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          4. Run the Azure Functions host with <ThemedText type="defaultSemiBold">npm run start --prefix api</ThemedText>.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          5. Launch the Expo development server with <ThemedText type="defaultSemiBold">npx expo start --web</ThemedText>.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          6. Open the app in your browser, upload audio, and read the transcription response.
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Azure deployment steps</ThemedText>
        <ThemedText style={styles.paragraph}>
          • Create an Azure Static Web App and connect this repository.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          • Add the deployment token to the repository secret named{' '}
          <ThemedText type="defaultSemiBold">AZURE_STATIC_WEB_APPS_API_TOKEN</ThemedText>.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          • In the Azure Portal, set the Functions app setting <ThemedText type="defaultSemiBold">OPENAI_API_KEY</ThemedText>.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          • Add <ThemedText type="defaultSemiBold">OPENAI_PROXY_TOKEN</ThemedText> and expose the same value to the front end via
          <ThemedText type="defaultSemiBold">EXPO_PUBLIC_TRANSCRIBE_API_KEY</ThemedText> (or <ThemedText type="defaultSemiBold">EXPO_PUBLIC_AZURE_FUNCTIONS_KEY</ThemedText>).
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          • Push to the <ThemedText type="defaultSemiBold">main</ThemedText> branch to trigger the GitHub Actions workflow.
        </ThemedText>
        <ThemedText style={styles.paragraph}>
          • Monitor the deployment in the Actions tab—once completed, your Static Web App will host the chat and API.
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Helpful links</ThemedText>
        <ThemedText
          style={[styles.link, styles.paragraph]}
          onPress={() => openLink('https://learn.microsoft.com/azure/static-web-apps/')}
          accessibilityRole="link">
          Azure Static Web Apps documentation
        </ThemedText>
        <ThemedText
          style={[styles.link, styles.paragraph]}
          onPress={() => openLink('https://learn.microsoft.com/azure/azure-functions/')}
          accessibilityRole="link">
          Azure Functions documentation
        </ThemedText>
        <ThemedText
          style={[styles.link, styles.paragraph]}
          onPress={() => openLink('https://platform.openai.com/docs/guides/speech-to-text')}
          accessibilityRole="link">
          OpenAI speech-to-text guide
        </ThemedText>
      </View>

      {Platform.OS !== 'web' && (
        <View style={styles.notice}>
          <ThemedText type="defaultSemiBold">Tip</ThemedText>
          <ThemedText style={styles.paragraph}>
            The chat UI is optimized for the web build of Expo. Deploy to Azure Static Web Apps or run `npx expo start --web` to
            try the full audio workflow.
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 24,
  },
  section: {
    gap: 12,
  },
  paragraph: {
    lineHeight: 20,
  },
  link: {
    color: '#0a7ea4',
    textDecorationLine: 'underline',
  },
  notice: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    gap: 8,
  },
});
