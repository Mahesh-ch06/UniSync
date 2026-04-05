import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSSO, useSignIn, useSignUp } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppLogo } from '../components/AppLogo';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

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

function maskEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!value.includes('@')) {
    return value;
  }

  const [name, domain] = value.split('@');
  if (!name || !domain) {
    return value;
  }

  if (name.length <= 2) {
    return `${name[0] ?? ''}*@${domain}`;
  }

  return `${name.slice(0, 2)}***@${domain}`;
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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isGoogleBusy, setIsGoogleBusy] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const headerTitle = useMemo(() => {
    if (mode === 'sign-up') {
      return 'Create account';
    }

    if (mode === 'verify') {
      return 'Verify your email';
    }

    return 'Welcome back';
  }, [mode]);

  const headerSubtitle = useMemo(() => {
    if (mode === 'sign-up') {
      return 'Join UniSync to report items faster and claim securely.';
    }

    if (mode === 'verify') {
      return 'Enter the 6-digit OTP sent to your inbox.';
    }

    return 'Sign in to continue to your campus lost and found hub.';
  }, [mode]);

  const canSubmit = useMemo(() => {
    if (mode === 'verify') {
      return verificationCode.trim().length >= 6;
    }

    if (mode === 'sign-up' && fullName.trim().length < 2) {
      return false;
    }

    return email.trim().length > 5 && password.length >= 8;
  }, [email, fullName, mode, password, verificationCode]);

  const otpCells = useMemo(() => {
    const sanitized = verificationCode.trim().slice(0, 6);
    const padded = sanitized.padEnd(6, ' ');
    return padded.split('');
  }, [verificationCode]);

  const submitGradient = useMemo(() => {
    if (mode === 'verify') {
      return ['#0F6A9D', '#0891C7'] as const;
    }

    if (mode === 'sign-up') {
      return ['#153893', '#1459B8'] as const;
    }

    return ['#060E3F', '#1B287C'] as const;
  }, [mode]);

  const setScreenMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMessage('');
    setInfoMessage('');

    if (nextMode !== 'verify') {
      setVerificationCode('');
    }
  };

  const submitLabel = mode === 'sign-in' ? 'Sign In' : mode === 'sign-up' ? 'Create Account' : 'Verify';

  const handleSubmit = async () => {
    if (!canSubmit || isBusy) {
      return;
    }

    setErrorMessage('');
    setInfoMessage('');
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
        setInfoMessage(`Code sent to ${maskEmail(email)}.`);
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

  const handleResendCode = async () => {
    if (isBusy || isResendingCode || !signUpLoaded || mode !== 'verify') {
      return;
    }

    setErrorMessage('');
    setInfoMessage('');
    setIsResendingCode(true);

    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setInfoMessage(`New code sent to ${maskEmail(email)}.`);
    } catch (error) {
      setErrorMessage(extractClerkErrorMessage(error));
    } finally {
      setIsResendingCode(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (isBusy || isGoogleBusy) {
      return;
    }

    setErrorMessage('');
    setInfoMessage('');
    setIsGoogleBusy(true);

    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({
          scheme: 'unisync',
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
      <LinearGradient colors={['#01081D', '#07153D', '#0C2A70']} style={styles.backgroundGradient} />
      <View pointerEvents="none" style={styles.orbOne} />
      <View pointerEvents="none" style={styles.orbTwo} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandWrap}>
            <AppLogo showWordmark size={46} textColor="#EEF4FF" wordmark="UniSync" />
            <Text style={styles.brandTagline}>A safer lost and found network for students.</Text>
          </View>

          <View style={styles.panel}>
            {mode !== 'verify' ? (
              <View style={styles.modeSwitch}>
                <Pressable
                  onPress={() => setScreenMode('sign-in')}
                  style={[styles.modeOption, mode === 'sign-in' ? styles.modeOptionActive : undefined]}
                >
                  <Text
                    style={[
                      styles.modeOptionText,
                      mode === 'sign-in' ? styles.modeOptionTextActive : undefined,
                    ]}
                  >
                    Sign In
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setScreenMode('sign-up')}
                  style={[styles.modeOption, mode === 'sign-up' ? styles.modeOptionActive : undefined]}
                >
                  <Text
                    style={[
                      styles.modeOptionText,
                      mode === 'sign-up' ? styles.modeOptionTextActive : undefined,
                    ]}
                  >
                    Sign Up
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.title}>{headerTitle}</Text>
            <Text style={styles.subtitle}>{headerSubtitle}</Text>

            {mode !== 'verify' ? (
              <>
                {mode === 'sign-up' ? (
                  <View style={styles.inputShell}>
                    <MaterialIcons color={colors.outline} name="person-outline" size={20} />
                    <TextInput
                      onChangeText={setFullName}
                      placeholder="Full name"
                      placeholderTextColor={colors.outline}
                      style={styles.inputControl}
                      value={fullName}
                    />
                  </View>
                ) : null}

                <View style={styles.inputShell}>
                  <MaterialIcons color={colors.outline} name="mail-outline" size={20} />
                  <TextInput
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    placeholder="College email"
                    placeholderTextColor={colors.outline}
                    style={styles.inputControl}
                    value={email}
                  />
                </View>

                <View style={styles.inputShell}>
                  <MaterialIcons color={colors.outline} name="lock-outline" size={20} />
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setPassword}
                    placeholder="Password (min 8 characters)"
                    placeholderTextColor={colors.outline}
                    secureTextEntry={!isPasswordVisible}
                    style={styles.inputControl}
                    value={password}
                  />
                  <Pressable
                    hitSlop={8}
                    onPress={() => setIsPasswordVisible((value) => !value)}
                    style={styles.passwordToggle}
                  >
                    <MaterialIcons
                      color={colors.outline}
                      name={isPasswordVisible ? 'visibility-off' : 'visibility'}
                      size={20}
                    />
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.verifyWrap}>
                <Text style={styles.verifyHint}>Code sent to {maskEmail(email)}</Text>

                <View style={styles.otpGrid}>
                  {React.Children.toArray(
                    otpCells.map((digit, index) => (
                      <View
                        style={[
                          styles.otpCell,
                          verificationCode.length === index ? styles.otpCellActive : undefined,
                        ]}
                      >
                        <Text style={styles.otpDigit}>{digit.trim()}</Text>
                      </View>
                    )),
                  )}
                </View>

                <TextInput
                  autoComplete="sms-otp"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => {
                    setVerificationCode(value.replace(/\D/g, '').slice(0, 6));
                  }}
                  placeholder="Enter 6-digit OTP"
                  placeholderTextColor={colors.outline}
                  style={styles.otpInput}
                  textContentType="oneTimeCode"
                  value={verificationCode}
                />

                <View style={styles.verifyActions}>
                  <Pressable disabled={isResendingCode} onPress={handleResendCode}>
                    {isResendingCode ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Text style={styles.inlineAction}>Resend code</Text>
                    )}
                  </Pressable>

                  <Pressable onPress={() => setScreenMode('sign-up')}>
                    <Text style={styles.inlineAction}>Change email</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {infoMessage ? <Text style={styles.infoText}>{infoMessage}</Text> : null}
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Pressable
              disabled={!canSubmit || isBusy}
              onPress={handleSubmit}
              style={styles.submitPressable}
            >
              <LinearGradient
                colors={canSubmit ? submitGradient : ['#96A0C2', '#A8B2CE']}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={[styles.submitButton, !canSubmit ? styles.submitButtonDisabled : undefined]}
              >
                {isBusy ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.submitText}>{submitLabel}</Text>
                )}
              </LinearGradient>
            </Pressable>

            {mode !== 'verify' ? (
              <>
                <View style={styles.separatorWrap}>
                  <View style={styles.separatorLine} />
                  <Text style={styles.separatorText}>or continue with</Text>
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
                    <>
                      <MaterialIcons color={colors.onSurface} name="g-translate" size={18} />
                      <Text style={styles.googleButtonText}>Continue with Google</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : null}

            {mode === 'sign-in' ? (
              <Pressable onPress={() => setScreenMode('sign-up')}>
                <Text style={styles.switchText}>New to UniSync? Create an account</Text>
              </Pressable>
            ) : mode === 'sign-up' ? (
              <Pressable onPress={() => setScreenMode('sign-in')}>
                <Text style={styles.switchText}>Already registered? Sign in</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setScreenMode('sign-up')}>
                <Text style={styles.switchText}>Need to edit details? Go back to sign up</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#050E31',
    flex: 1,
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  orbOne: {
    backgroundColor: 'rgba(35, 124, 255, 0.18)',
    borderRadius: 180,
    height: 180,
    position: 'absolute',
    right: -35,
    top: 90,
    width: 180,
  },
  orbTwo: {
    backgroundColor: 'rgba(62, 216, 255, 0.16)',
    borderRadius: 140,
    bottom: 90,
    height: 140,
    left: -30,
    position: 'absolute',
    width: 140,
  },
  keyboardWrap: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  brandWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  brandTagline: {
    color: 'rgba(229, 236, 255, 0.8)',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginTop: 8,
  },
  panel: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    ...shadows.strong,
  },
  modeSwitch: {
    backgroundColor: '#EDF2FF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 16,
    padding: 4,
  },
  modeOption: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
  },
  modeOptionActive: {
    backgroundColor: '#FFFFFF',
    ...shadows.soft,
  },
  modeOptionText: {
    color: '#4A577A',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  modeOptionTextActive: {
    color: '#1D3265',
  },
  title: {
    color: '#0D1F4F',
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 29,
    marginBottom: 7,
  },
  subtitle: {
    color: '#556189',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D4DCED',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    height: 54,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  inputControl: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
    height: '100%',
    marginLeft: 10,
    paddingVertical: 0,
    flex: 1,
  },
  passwordToggle: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  verifyWrap: {
    marginBottom: 8,
  },
  verifyHint: {
    color: '#50618F',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginBottom: 10,
  },
  otpGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  otpCell: {
    alignItems: 'center',
    backgroundColor: '#F3F7FF',
    borderColor: '#CAD8F3',
    borderRadius: 14,
    borderWidth: 1,
    height: 50,
    justifyContent: 'center',
    width: 44,
  },
  otpCellActive: {
    borderColor: colors.primary,
  },
  otpDigit: {
    color: '#12244C',
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  otpInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D4DCED',
    borderRadius: radii.lg,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
    height: 52,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  verifyActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  inlineAction: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  infoText: {
    color: '#0A6BA5',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginBottom: 8,
    marginTop: 4,
  },
  errorText: {
    color: colors.error,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginBottom: 8,
    marginTop: 4,
  },
  submitPressable: {
    marginTop: 4,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 52,
    justifyContent: 'center',
    marginBottom: 12,
  },
  submitButtonDisabled: {
    opacity: 0.85,
  },
  submitText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  switchText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    marginTop: 2,
    textAlign: 'center',
  },
  separatorWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
    marginTop: 4,
  },
  separatorLine: {
    backgroundColor: '#D4DBED',
    flex: 1,
    height: 1,
  },
  separatorText: {
    color: '#6F7EA5',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginHorizontal: 10,
  },
  googleButton: {
    alignItems: 'center',
    backgroundColor: '#F4F7FF',
    borderColor: '#D3DDF2',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    justifyContent: 'center',
    marginBottom: 12,
  },
  googleButtonDisabled: {
    opacity: 0.75,
  },
  googleButtonText: {
    color: '#1F2E57',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 15,
  },
});
