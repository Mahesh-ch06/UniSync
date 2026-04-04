import { useSSO, useSignIn, useSignUp } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
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

import { colors, fontFamily, radii } from '../theme/tokens';

type AuthMode = 'sign-in' | 'sign-up' | 'verify';

WebBrowser.maybeCompleteAuthSession();

type ClerkErrorShape = {
  errors?: Array<{
    longMessage?: string;
    message?: string;
  }>;
};

function extractClerkErrorMessage(error: unknown): string {
  const apiError = error as ClerkErrorShape;

  if (apiError?.errors?.[0]?.longMessage) {
    return apiError.errors[0].longMessage;
  }

  if (apiError?.errors?.[0]?.message) {
    return apiError.errors[0].message;
  }

  return 'Something went wrong. Please try again.';
}

function splitFullName(fullName: string): { firstName: string; lastName?: string } {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ') || undefined;

  return { firstName, lastName };
}

export function AuthScreen() {
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isGoogleBusy, setIsGoogleBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const headerTitle = useMemo(() => {
    if (mode === 'sign-up') {
      return 'Create Account';
    }

    if (mode === 'verify') {
      return 'Verify Email';
    }

    return 'Welcome Back';
  }, [mode]);

  const headerSubtitle = useMemo(() => {
    if (mode === 'sign-up') {
      return 'Sign up to report and claim items on CampusFind.';
    }

    if (mode === 'verify') {
      return 'Enter the code sent to your email address.';
    }

    return 'Sign in to continue with secure claim flows.';
  }, [mode]);

  const canSubmit = useMemo(() => {
    if (mode === 'verify') {
      return verificationCode.trim().length >= 4;
    }

    if (mode === 'sign-up' && fullName.trim().length < 2) {
      return false;
    }

    return email.trim().length > 5 && password.length >= 8;
  }, [email, fullName, mode, password, verificationCode]);

  const submitLabel = mode === 'sign-in' ? 'Sign In' : mode === 'sign-up' ? 'Create Account' : 'Verify';

  const handleSubmit = async () => {
    if (!canSubmit || isBusy) {
      return;
    }

    setErrorMessage('');
    setIsBusy(true);

    try {
      if (mode === 'sign-in') {
        if (!signInLoaded) {
          return;
        }

        const attempt = await signIn.create({
          identifier: email.trim().toLowerCase(),
          password,
        });

        if (attempt.status === 'complete') {
          await setSignInActive({ session: attempt.createdSessionId });
          return;
        }

        setErrorMessage('Additional verification is required for this account.');
        return;
      }

      if (mode === 'sign-up') {
        if (!signUpLoaded) {
          return;
        }

        const { firstName, lastName } = splitFullName(fullName);

        await signUp.create({
          emailAddress: email.trim().toLowerCase(),
          firstName,
          lastName,
          password,
        });

        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setMode('verify');
        return;
      }

      if (!signUpLoaded) {
        return;
      }

      const attempt = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });

      if (attempt.status === 'complete') {
        await setSignUpActive({ session: attempt.createdSessionId });
        return;
      }

      setErrorMessage('Verification is incomplete. Please check the code and try again.');
    } catch (error) {
      setErrorMessage(extractClerkErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (isBusy || isGoogleBusy) {
      return;
    }

    setErrorMessage('');
    setIsGoogleBusy(true);

    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({
          path: 'oauth-native-callback',
        }),
      });

      if (createdSessionId) {
        await setActive?.({ session: createdSessionId });
        return;
      }

      setErrorMessage('Google authentication was not completed. Please try again.');
    } catch (error) {
      setErrorMessage(extractClerkErrorMessage(error));
    } finally {
      setIsGoogleBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}
      >
        <View style={styles.content}>
          <Text style={styles.brand}>CampusFind</Text>
          <Text style={styles.title}>{headerTitle}</Text>
          <Text style={styles.subtitle}>{headerSubtitle}</Text>

          {mode !== 'verify' ? (
            <>
              {mode === 'sign-up' ? (
                <TextInput
                  onChangeText={setFullName}
                  placeholder="Full name"
                  placeholderTextColor={colors.outline}
                  style={styles.input}
                  value={fullName}
                />
              ) : null}

              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={colors.outline}
                style={styles.input}
                value={email}
              />
              <TextInput
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.outline}
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </>
          ) : (
            <TextInput
              keyboardType="number-pad"
              onChangeText={setVerificationCode}
              placeholder="Verification code"
              placeholderTextColor={colors.outline}
              style={styles.input}
              value={verificationCode}
            />
          )}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <Pressable
            disabled={!canSubmit || isBusy}
            onPress={handleSubmit}
            style={[styles.submitButton, !canSubmit ? styles.submitButtonDisabled : undefined]}
          >
            {isBusy ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.submitText}>{submitLabel}</Text>
            )}
          </Pressable>

          {mode !== 'verify' ? (
            <>
              <View style={styles.separatorWrap}>
                <View style={styles.separatorLine} />
                <Text style={styles.separatorText}>OR</Text>
                <View style={styles.separatorLine} />
              </View>

              <Pressable
                disabled={isBusy || isGoogleBusy}
                onPress={handleGoogleAuth}
                style={[styles.googleButton, isGoogleBusy ? styles.googleButtonDisabled : undefined]}
              >
                {isGoogleBusy ? (
                  <ActivityIndicator color={colors.onSurface} size="small" />
                ) : (
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                )}
              </Pressable>
            </>
          ) : null}

          {mode === 'sign-in' ? (
            <Pressable onPress={() => setMode('sign-up')}>
              <Text style={styles.switchText}>No account yet? Create one</Text>
            </Pressable>
          ) : mode === 'sign-up' ? (
            <Pressable onPress={() => setMode('sign-in')}>
              <Text style={styles.switchText}>Already have an account? Sign in</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setMode('sign-up')}>
              <Text style={styles.switchText}>Did not get a code? Go back</Text>
            </Pressable>
          )}
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
  brand: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 38,
    marginBottom: 8,
    textAlign: 'center',
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
    marginBottom: 14,
  },
  submitButtonDisabled: {
    backgroundColor: '#989DB8',
  },
  submitText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
  },
  switchText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    textAlign: 'center',
  },
  separatorWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 14,
    marginTop: 2,
  },
  separatorLine: {
    backgroundColor: 'rgba(118, 118, 131, 0.26)',
    flex: 1,
    height: 1,
  },
  separatorText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginHorizontal: 8,
    textTransform: 'uppercase',
  },
  googleButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(118, 118, 131, 0.3)',
    borderRadius: radii.md,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginBottom: 14,
  },
  googleButtonDisabled: {
    opacity: 0.75,
  },
  googleButtonText: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 15,
  },
});
