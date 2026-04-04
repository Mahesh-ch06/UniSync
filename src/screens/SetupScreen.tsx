import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontFamily, radii } from '../theme/tokens';

type SetupScreenProps = {
  missingKeys: string[];
};

export function SetupScreen({ missingKeys }: SetupScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Backend Setup Required</Text>
        <Text style={styles.subtitle}>
          Add these environment variables to a .env file in project root, then restart Expo.
        </Text>

        <View style={styles.keysCard}>
          {missingKeys.map((keyName) => (
            <Text key={keyName} style={styles.keyLine}>
              {keyName}
            </Text>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 34,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
    textAlign: 'center',
  },
  keysCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.2)',
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 18,
  },
  keyLine: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    marginBottom: 8,
  },
});
