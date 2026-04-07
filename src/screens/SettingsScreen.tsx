import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { backendEnv } from '../config/env';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

type SettingsTabParamList = {
  Home: undefined;
  Map: undefined;
  Report: undefined;
  History:
    | {
        focusRequestId?: string;
        focusFoundItemId?: string;
        focusNonce?: number;
        autoOpenMessages?: boolean;
      }
    | undefined;
  Profile: undefined;
  Settings: undefined;
};

type SettingsFormState = {
  notifyClaimUpdates: boolean;
  notifyMessages: boolean;
  publicProfile: boolean;
};

type SyncStatus = 'idle' | 'saving' | 'synced' | 'error';

type LoadSettingsOptions = {
  soft?: boolean;
};

type SaveSettingsOptions = {
  silent?: boolean;
};

type GetTokenFn = NonNullable<ReturnType<typeof useAuth>['getToken']>;

const DEFAULT_SETTINGS_FORM: SettingsFormState = {
  notifyClaimUpdates: true,
  notifyMessages: true,
  publicProfile: true,
};

const SETTINGS_REQUEST_TIMEOUT_MS = 15000;

const settingsSignature = (form: SettingsFormState): string => {
  return [form.notifyClaimUpdates, form.notifyMessages, form.publicProfile].join('|');
};

const readText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const readBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
};

const tokenMissingMessage = (): string => {
  return 'Authentication token missing. Sign out and sign in again.';
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const normalizeSettingsErrorMessage = (error: unknown, fallback: string): string => {
  const extractedMessage =
    isRecord(error) && typeof error.message === 'string' ? readText(error.message) : '';

  if (extractedMessage) {
    const normalized = extractedMessage.toLowerCase();

    if (normalized.includes('failed to fetch') || normalized.includes('network request failed')) {
      return 'Network issue while syncing settings. Check your internet and retry.';
    }

    return extractedMessage;
  }

  return fallback;
};

async function resolveSessionAccessToken(getToken?: GetTokenFn): Promise<string | null> {
  if (!getToken) {
    return null;
  }

  const sessionToken = await getToken().catch(() => null);
  if (sessionToken && readText(sessionToken).length > 0) {
    return sessionToken;
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  const retrySessionToken = await getToken().catch(() => null);
  if (retrySessionToken && readText(retrySessionToken).length > 0) {
    return retrySessionToken;
  }

  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    if (aborted) {
      throw new Error('Settings request timed out. Check your internet connection and retry.');
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseError(response: Response, fallbackMessage: string): Promise<string> {
  if (response.status === 404) {
    return 'Backend settings route is not available. Deploy the latest backend and retry.';
  }

  try {
    const payload = (await response.json()) as { error?: unknown; details?: unknown };
    const errorMessage = readText(payload.error);
    const detailsMessage = readText(payload.details);

    if (errorMessage && detailsMessage) {
      return `${errorMessage} (${detailsMessage})`;
    }

    return errorMessage || detailsMessage || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export function SettingsScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<SettingsTabParamList, 'Settings'>>();
  const { getToken, isLoaded: isAuthLoaded, signOut, userId } = useAuth();
  const { user } = useUser();

  const [form, setForm] = useState<SettingsFormState>(DEFAULT_SETTINGS_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const getTokenRef = useRef(getToken);
  const lastSavedSignatureRef = useRef(settingsSignature(DEFAULT_SETTINGS_FORM));

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const userPrimaryEmail = useMemo(() => {
    return user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || '';
  }, [user]);

  const backendBaseUrl = useMemo(() => backendEnv.backendUrl.replace(/\/+$/, ''), []);

  const authedSettingsRequest = useCallback(
    async (path: string, init: RequestInit) => {
      if (!backendBaseUrl) {
        throw new Error('Backend is not configured. Set EXPO_PUBLIC_BACKEND_URL.');
      }

      const accessToken = await resolveSessionAccessToken(getTokenRef.current);
      if (!accessToken) {
        throw new Error(tokenMissingMessage());
      }

      return await fetchWithTimeout(
        `${backendBaseUrl}${path}`,
        {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(init.headers ?? {}),
          },
        },
        SETTINGS_REQUEST_TIMEOUT_MS,
      );
    },
    [backendBaseUrl],
  );

  const loadSettings = useCallback(
    async (options?: LoadSettingsOptions) => {
      if (!isAuthLoaded || !userId) {
        setForm(DEFAULT_SETTINGS_FORM);
        lastSavedSignatureRef.current = settingsSignature(DEFAULT_SETTINGS_FORM);
        setSyncStatus('idle');
        setIsLoading(false);
        return;
      }

      const soft = options?.soft ?? false;
      if (!soft) {
        setIsLoading(true);
      }

      setErrorMessage('');

      try {
        const response = await authedSettingsRequest('/api/settings/me', {
          method: 'GET',
        });

        if (response.status === 404) {
          setForm(DEFAULT_SETTINGS_FORM);
          lastSavedSignatureRef.current = settingsSignature(DEFAULT_SETTINGS_FORM);
          setSyncStatus('idle');
          setErrorMessage('');
          setSuccessMessage('Using compatibility settings mode. Deploy latest backend for cloud sync.');
          setLastSyncedAt(new Date().toISOString());
          return;
        }

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Could not load settings right now.'));
        }

        const payload = (await response.json()) as {
          settings?: {
            notifyClaimUpdates?: unknown;
            notifyMessages?: unknown;
            publicProfile?: unknown;
          };
        };

        const remote = payload.settings;

        const nextForm: SettingsFormState = {
          notifyClaimUpdates: readBoolean(
            remote?.notifyClaimUpdates,
            DEFAULT_SETTINGS_FORM.notifyClaimUpdates,
          ),
          notifyMessages: readBoolean(remote?.notifyMessages, DEFAULT_SETTINGS_FORM.notifyMessages),
          publicProfile: readBoolean(remote?.publicProfile, DEFAULT_SETTINGS_FORM.publicProfile),
        };

        setForm(nextForm);
        lastSavedSignatureRef.current = settingsSignature(nextForm);
        setSyncStatus('synced');
        setLastSyncedAt(new Date().toISOString());
      } catch (error) {
        setErrorMessage(normalizeSettingsErrorMessage(error, 'Could not load settings right now.'));
        setSyncStatus('error');
      } finally {
        setIsLoading(false);
      }
    },
      [authedSettingsRequest, isAuthLoaded, userId],
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const persistSettings = useCallback(
    async (nextForm: SettingsFormState, options?: SaveSettingsOptions) => {
      if (!isAuthLoaded || !userId || isSaving) {
        return;
      }

      const silent = options?.silent ?? false;
      const currentSignature = settingsSignature(nextForm);

      if (silent && currentSignature === lastSavedSignatureRef.current) {
        setSyncStatus('synced');
        return;
      }

      setIsSaving(true);
      setSyncStatus('saving');
      setErrorMessage('');

      if (!silent) {
        setSuccessMessage('');
      }

      try {
        const response = await authedSettingsRequest('/api/settings/me', {
          method: 'PUT',
          body: JSON.stringify({
            notify_claim_updates: nextForm.notifyClaimUpdates,
            notify_messages: nextForm.notifyMessages,
            public_profile: nextForm.publicProfile,
          }),
        });

        if (response.status === 404) {
          lastSavedSignatureRef.current = currentSignature;
          setSyncStatus('idle');
          setLastSyncedAt(new Date().toISOString());

          if (!silent) {
            setSuccessMessage('Saved locally. Deploy latest backend to enable cloud settings sync.');
          }

          return;
        }

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Could not save settings right now.'));
        }

        lastSavedSignatureRef.current = currentSignature;
        setSyncStatus('synced');
        setLastSyncedAt(new Date().toISOString());

        if (!silent) {
          setSuccessMessage('Settings saved successfully.');
        }
      } catch (error) {
        setErrorMessage(normalizeSettingsErrorMessage(error, 'Could not save settings right now.'));
        setSyncStatus('error');

        if (!silent) {
          setSuccessMessage('');
        }
      } finally {
        setIsSaving(false);
      }
    },
      [authedSettingsRequest, isAuthLoaded, isSaving, userId],
  );

  useEffect(() => {
    if (!isAuthLoaded || !userId || isLoading) {
      return;
    }

    const currentSignature = settingsSignature(form);
    if (currentSignature === lastSavedSignatureRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      void persistSettings(form, { silent: true });
    }, 650);

    return () => clearTimeout(timer);
  }, [form, isAuthLoaded, isLoading, persistSettings, userId]);

  const handleToggle = useCallback(
    (field: keyof SettingsFormState) => {
      if (isLoading || isSaving) {
        return;
      }

      setErrorMessage('');
      setSuccessMessage('');
      setSyncStatus('idle');
      setForm((previous) => ({
        ...previous,
        [field]: !previous[field],
      }));
    },
    [isLoading, isSaving],
  );

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isSaving) {
      return;
    }

    setIsRefreshing(true);

    try {
      await loadSettings({ soft: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, isSaving, loadSettings]);

  const handleSaveNow = useCallback(() => {
    void persistSettings(form, { silent: false });
  }, [form, persistSettings]);

  const handleResetDefaults = useCallback(() => {
    if (isLoading || isSaving) {
      return;
    }

    Alert.alert(
      'Reset settings?',
      'This will restore default notification and privacy preferences.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setErrorMessage('');
            setSuccessMessage('Restored defaults. Saving now...');
            setSyncStatus('idle');
            setForm(DEFAULT_SETTINGS_FORM);
            void persistSettings(DEFAULT_SETTINGS_FORM, { silent: false });
          },
        },
      ],
    );
  }, [isLoading, isSaving, persistSettings]);

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  }, [isSigningOut, signOut]);

  const syncStatusMeta = useMemo(() => {
    if (syncStatus === 'saving') {
      return {
        icon: 'sync' as keyof typeof MaterialIcons.glyphMap,
        color: colors.primary,
        label: 'Saving updates...',
      };
    }

    if (syncStatus === 'synced') {
      return {
        icon: 'check-circle-outline' as keyof typeof MaterialIcons.glyphMap,
        color: colors.success,
        label: lastSyncedAt ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : 'Synced',
      };
    }

    if (syncStatus === 'error') {
      return {
        icon: 'error-outline' as keyof typeof MaterialIcons.glyphMap,
        color: colors.error,
        label: 'Sync issue',
      };
    }

    return {
      icon: 'edit' as keyof typeof MaterialIcons.glyphMap,
      color: colors.onSurfaceVariant,
      label: 'Ready to edit',
    };
  }, [lastSyncedAt, syncStatus]);

  const visibilityHint = useMemo(() => {
    return form.publicProfile
      ? 'Other campus users can view your profile details when matching claims.'
      : 'Your profile details stay private except where required for active claim coordination.';
  }, [form.publicProfile]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar
        leftIcon="arrow-back"
        onLeftPress={() => navigation.navigate('Profile')}
        onRightPress={() => void handleRefresh()}
        rightIcon="refresh"
        title="Settings"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <Text style={styles.headerEyebrow}>Account controls</Text>
          <Text style={styles.headerTitle}>Privacy, notifications, and security</Text>
          <Text style={styles.headerSubtitle}>
            Changes are synced in real time so your profile behavior stays consistent across devices.
          </Text>

          <View style={styles.statusChip}>
            <MaterialIcons color={syncStatusMeta.color} name={syncStatusMeta.icon} size={16} />
            <Text style={[styles.statusChipText, { color: syncStatusMeta.color }]}>
              {syncStatusMeta.label}
            </Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loaderCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loaderText}>Loading settings...</Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Notifications</Text>

              <Pressable
                disabled={isLoading || isSaving}
                onPress={() => handleToggle('notifyClaimUpdates')}
                style={[styles.toggleRow, isLoading || isSaving ? styles.toggleRowDisabled : undefined]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Claim updates</Text>
                  <Text style={styles.toggleSubtitle}>
                    Receive alerts when claim status changes to approved, rejected, or picked up.
                  </Text>
                </View>
                <MaterialIcons
                  color={form.notifyClaimUpdates ? colors.primary : colors.outline}
                  name={form.notifyClaimUpdates ? 'toggle-on' : 'toggle-off'}
                  size={38}
                />
              </Pressable>

              <Pressable
                disabled={isLoading || isSaving}
                onPress={() => handleToggle('notifyMessages')}
                style={[styles.toggleRow, isLoading || isSaving ? styles.toggleRowDisabled : undefined]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Message alerts</Text>
                  <Text style={styles.toggleSubtitle}>
                    Get notified when someone sends a new claim or pickup message.
                  </Text>
                </View>
                <MaterialIcons
                  color={form.notifyMessages ? colors.primary : colors.outline}
                  name={form.notifyMessages ? 'toggle-on' : 'toggle-off'}
                  size={38}
                />
              </Pressable>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Privacy</Text>

              <Pressable
                disabled={isLoading || isSaving}
                onPress={() => handleToggle('publicProfile')}
                style={[styles.toggleRow, isLoading || isSaving ? styles.toggleRowDisabled : undefined]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Public profile visibility</Text>
                  <Text style={styles.toggleSubtitle}>{visibilityHint}</Text>
                </View>
                <MaterialIcons
                  color={form.publicProfile ? colors.primary : colors.outline}
                  name={form.publicProfile ? 'toggle-on' : 'toggle-off'}
                  size={38}
                />
              </Pressable>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Account</Text>
              <View style={styles.accountRow}>
                <MaterialIcons color={colors.primary} name="alternate-email" size={18} />
                <Text numberOfLines={1} style={styles.accountText}>
                  {userPrimaryEmail || 'No email found'}
                </Text>
              </View>
              <View style={styles.accountRow}>
                <MaterialIcons color={colors.primary} name="fingerprint" size={18} />
                <Text numberOfLines={1} style={styles.accountText}>
                  {userId || 'No member id found'}
                </Text>
              </View>

              <Pressable onPress={() => navigation.navigate('Profile')} style={styles.secondaryButton}>
                <MaterialIcons color={colors.primary} name="manage-accounts" size={18} />
                <Text style={styles.secondaryButtonText}>Open profile editor</Text>
              </Pressable>

              <View style={styles.quickActionsRow}>
                <Pressable onPress={() => navigation.navigate('Home')} style={styles.quickActionButton}>
                  <MaterialIcons color={colors.primary} name="home" size={16} />
                  <Text style={styles.quickActionButtonText}>Home</Text>
                </Pressable>

                <Pressable onPress={() => navigation.navigate('Report')} style={styles.quickActionButton}>
                  <MaterialIcons color={colors.primary} name="add-circle-outline" size={16} />
                  <Text style={styles.quickActionButtonText}>Report</Text>
                </Pressable>

                <Pressable onPress={() => navigation.navigate('History')} style={styles.quickActionButton}>
                  <MaterialIcons color={colors.primary} name="history" size={16} />
                  <Text style={styles.quickActionButtonText}>History</Text>
                </Pressable>
              </View>
            </View>

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

            <Pressable
              disabled={isSaving}
              onPress={handleSaveNow}
              style={[styles.primaryButton, isSaving ? styles.primaryButtonDisabled : undefined]}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <>
                  <MaterialIcons color={colors.onPrimary} name="save" size={18} />
                  <Text style={styles.primaryButtonText}>Save now</Text>
                </>
              )}
            </Pressable>

            <Pressable
              disabled={isLoading || isSaving}
              onPress={handleResetDefaults}
              style={[
                styles.dangerButton,
                isLoading || isSaving ? styles.primaryButtonDisabled : undefined,
              ]}
            >
              <MaterialIcons color={colors.error} name="restart-alt" size={18} />
              <Text style={styles.dangerButtonText}>Reset to defaults</Text>
            </Pressable>
          </>
        )}

        <Pressable
          disabled={isSigningOut}
          onPress={handleSignOut}
          style={[styles.signOutButton, isSigningOut ? styles.signOutButtonDisabled : undefined]}
        >
          <MaterialIcons color={colors.primary} name="logout" size={18} />
          <Text style={styles.signOutText}>{isSigningOut ? 'Signing out...' : 'Sign out'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  headerCard: {
    ...shadows.soft,
    backgroundColor: '#EEF1FF',
    borderRadius: radii.xl,
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerEyebrow: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 22,
    marginBottom: 4,
  },
  headerSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  statusChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  loaderCard: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginBottom: 12,
    padding: 20,
  },
  loaderText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginTop: 10,
  },
  sectionCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.12)',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 18,
    marginBottom: 10,
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: '#F5F7FF',
    borderRadius: radii.md,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  toggleRowDisabled: {
    opacity: 0.6,
  },
  toggleTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  toggleTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
  },
  toggleSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  accountRow: {
    alignItems: 'center',
    backgroundColor: '#F8F9FC',
    borderRadius: radii.md,
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  accountText: {
    color: colors.onSurfaceVariant,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginLeft: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E9EEFF',
    borderColor: 'rgba(0, 6, 102, 0.14)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  quickActionButton: {
    alignItems: 'center',
    backgroundColor: '#F5F7FF',
    borderColor: 'rgba(0, 6, 102, 0.12)',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  quickActionButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  errorText: {
    color: colors.error,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginBottom: 8,
    marginTop: 2,
  },
  successText: {
    color: colors.success,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginBottom: 8,
    marginTop: 2,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButtonDisabled: {
    opacity: 0.72,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 15,
    marginLeft: 6,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#FFF4F4',
    borderColor: 'rgba(186, 26, 26, 0.22)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  dangerButtonText: {
    color: colors.error,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    marginLeft: 6,
  },
  signOutButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 6, 102, 0.08)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  signOutButtonDisabled: {
    opacity: 0.7,
  },
  signOutText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
});
