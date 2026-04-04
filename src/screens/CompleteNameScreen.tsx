import { useUser } from '@clerk/clerk-expo';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppLogo } from '../components/AppLogo';
import { colors, fontFamily, radii } from '../theme/tokens';

type CompleteNameScreenProps = {
  onCompleted?: () => void;
};

function splitFullName(fullName: string): { firstName: string; lastName?: string } {
  const pieces = fullName
    .trim()
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const firstName = pieces[0] ?? '';
  const lastName = pieces.slice(1).join(' ') || undefined;

  return { firstName, lastName };
}

export function CompleteNameScreen({ onCompleted }: CompleteNameScreenProps) {
  const { user } = useUser();

  const currentName = useMemo(() => {
    const combined = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();
    return combined;
  }, [user?.firstName, user?.lastName]);

  const [fullName, setFullName] = useState(currentName);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const canSubmit = fullName.trim().length >= 2;

  const handleSave = async () => {
    if (!user || !canSubmit || isSaving) {
      return;
    }

    setErrorMessage('');
    setIsSaving(true);

    try {
      const { firstName, lastName } = splitFullName(fullName);
      await user.update({ firstName, lastName });
      onCompleted?.();
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Could not save your name. Please try again.';

      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}
      >
        <View style={styles.content}>
          <View style={styles.brandWrap}>
            <AppLogo showWordmark size={46} />
          </View>
          <Text style={styles.title}>One Last Step</Text>
          <Text style={styles.subtitle}>
            Please add your name so others can trust verified claims and handovers.
          </Text>

          <TextInput
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor={colors.outline}
            style={styles.input}
            value={fullName}
          />

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <Pressable
            disabled={!canSubmit || isSaving}
            onPress={handleSave}
            style={[styles.submitButton, !canSubmit ? styles.submitButtonDisabled : undefined]}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.submitText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardWrap: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 28,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.2)',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
    height: 52,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  errorText: {
    color: colors.error,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginBottom: 10,
    textAlign: 'center',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    height: 52,
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#989DB8',
  },
  submitText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
  },
});
