import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { isAdminEmail } from '../config/admin';
import { backendEnv } from '../config/env';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const REQUEST_TIMEOUT_MS = 15000;

type AdminNavigationParams = {
  Home: undefined;
  Profile: undefined;
  Settings: undefined;
  Admin: undefined;
  History:
    | {
        focusRequestId?: string;
        focusFoundItemId?: string;
        focusNonce?: number;
        autoOpenMessages?: boolean;
      }
    | undefined;
};

type AdminCounts = {
  users: number;
  foundItems: number;
  claims: number;
  submittedClaims: number;
  approvedClaims: number;
  pickedUpClaims: number;
  rejectedClaims: number;
  activePushDevices: number;
};

type AdminFoundItem = {
  id: string;
  title: string;
  category: string;
  location: string;
  createdAt: string;
  createdBy: string;
};

type AdminRequestRow = {
  id: string;
  status: string;
  createdAt: string;
  claimantUserId: string;
  foundItemId: string;
  foundItemTitle: string;
  foundItemLocation: string;
};

const DEFAULT_COUNTS: AdminCounts = {
  users: 0,
  foundItems: 0,
  claims: 0,
  submittedClaims: 0,
  approvedClaims: 0,
  pickedUpClaims: 0,
  rejectedClaims: 0,
  activePushDevices: 0,
};

function readText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function formatRelativeTime(input: string): string {
  const timestamp = new Date(readText(input)).getTime();
  if (!Number.isFinite(timestamp)) {
    return 'recently';
  }

  const diffMs = Math.max(Date.now() - timestamp, 0);
  const minutes = Math.floor(diffMs / (1000 * 60));

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort) {
      throw new Error('Request timed out. Try again.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readResponseError(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; details?: unknown };
    const errorText = readText(payload.error);
    const detailsText = readText(payload.details);

    if (errorText && detailsText) {
      return `${errorText} (${detailsText})`;
    }

    return errorText || detailsText || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export function AdminScreen() {
  const navigation = useNavigation<NavigationProp<AdminNavigationParams>>();
  const { getToken } = useAuth();
  const { user } = useUser();

  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const userEmail =
    readText(user?.primaryEmailAddress?.emailAddress) ||
    readText(user?.emailAddresses?.[0]?.emailAddress);

  const hasAdminAccess = isAdminEmail(userEmail);
  const backendBaseUrl = useMemo(() => backendEnv.backendUrl.replace(/\/+$/, ''), []);

  const [counts, setCounts] = useState<AdminCounts>(DEFAULT_COUNTS);
  const [recentFoundItems, setRecentFoundItems] = useState<AdminFoundItem[]>([]);
  const [recentRequests, setRecentRequests] = useState<AdminRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [noticeText, setNoticeText] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('UniSync Admin Notice');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [removingItemId, setRemovingItemId] = useState('');
  const [updatingRequestId, setUpdatingRequestId] = useState('');

  const authedAdminRequest = useCallback(
    async (path: string, init: RequestInit) => {
      if (!backendBaseUrl) {
        throw new Error('Backend URL is missing.');
      }

      const token = await getTokenRef.current().catch(() => null);
      if (!token) {
        throw new Error('Admin authentication token is missing. Sign in again.');
      }

      return await fetchWithTimeout(`${backendBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    },
    [backendBaseUrl],
  );

  const loadAdminOverview = useCallback(
    async (options?: { soft?: boolean }) => {
      const soft = options?.soft ?? false;
      setErrorText('');

      if (!soft) {
        setIsLoading(true);
      }

      try {
        if (!hasAdminAccess) {
          setCounts(DEFAULT_COUNTS);
          setRecentFoundItems([]);
          setRecentRequests([]);
          return;
        }

        const response = await authedAdminRequest('/api/admin/overview', {
          method: 'GET',
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Could not load admin overview.'));
        }

        const payload = (await response.json()) as {
          counts?: Partial<AdminCounts>;
          recentFoundItems?: Array<Record<string, unknown>>;
          recentRequests?: Array<Record<string, unknown>>;
        };

        const nextCounts = payload.counts ?? {};
        setCounts({
          users: Math.max(0, Math.round(readNumber(nextCounts.users))),
          foundItems: Math.max(0, Math.round(readNumber(nextCounts.foundItems))),
          claims: Math.max(0, Math.round(readNumber(nextCounts.claims))),
          submittedClaims: Math.max(0, Math.round(readNumber(nextCounts.submittedClaims))),
          approvedClaims: Math.max(0, Math.round(readNumber(nextCounts.approvedClaims))),
          pickedUpClaims: Math.max(0, Math.round(readNumber(nextCounts.pickedUpClaims))),
          rejectedClaims: Math.max(0, Math.round(readNumber(nextCounts.rejectedClaims))),
          activePushDevices: Math.max(0, Math.round(readNumber(nextCounts.activePushDevices))),
        });

        const foundRows = Array.isArray(payload.recentFoundItems) ? payload.recentFoundItems : [];
        const requestRows = Array.isArray(payload.recentRequests) ? payload.recentRequests : [];

        setRecentFoundItems(
          foundRows.map((row, index) => ({
            id: readText(row.id) || `found-${index}`,
            title: readText(row.title) || 'Found item',
            category: readText(row.category) || 'General',
            location: readText(row.location) || 'Campus location',
            createdAt: readText(row.created_at),
            createdBy: readText(row.created_by),
          })),
        );

        setRecentRequests(
          requestRows.map((row, index) => {
            const foundItem =
              row.found_item && typeof row.found_item === 'object'
                ? (row.found_item as Record<string, unknown>)
                : null;

            return {
              id: readText(row.id) || `request-${index}`,
              status: readText(row.status) || 'submitted',
              createdAt: readText(row.created_at),
              claimantUserId: readText(row.claimant_user_id),
              foundItemId: readText(row.found_item_id),
              foundItemTitle: readText(foundItem?.title) || 'Found item',
              foundItemLocation: readText(foundItem?.location) || 'Campus location',
            };
          }),
        );
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Could not load admin overview.';

        setErrorText(message);
      } finally {
        if (!soft) {
          setIsLoading(false);
        }
      }
    },
    [authedAdminRequest, hasAdminAccess],
  );

  useEffect(() => {
    void loadAdminOverview();
  }, [loadAdminOverview]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadAdminOverview({ soft: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAdminOverview]);

  const handleBroadcast = useCallback(async () => {
    if (isBroadcasting) {
      return;
    }

    if (!broadcastMessage.trim()) {
      setErrorText('Enter a broadcast message before sending.');
      return;
    }

    setIsBroadcasting(true);
    setErrorText('');
    setNoticeText('');

    try {
      const response = await authedAdminRequest('/api/admin/notifications/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          title: broadcastTitle.trim() || 'UniSync Admin Notice',
          message: broadcastMessage.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response, 'Failed to send broadcast notification.'));
      }

      const payload = (await response.json()) as { sent?: unknown; recipients?: unknown };
      const sent = Math.max(0, Math.round(readNumber(payload.sent)));
      const recipients = Math.max(0, Math.round(readNumber(payload.recipients)));

      setNoticeText(`Broadcast sent to ${sent} devices across ${recipients} user accounts.`);
      setBroadcastMessage('');
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to send broadcast notification.';

      setErrorText(message);
    } finally {
      setIsBroadcasting(false);
    }
  }, [authedAdminRequest, broadcastMessage, broadcastTitle, isBroadcasting]);

  const handleRemoveFoundItem = useCallback(
    async (foundItemId: string) => {
      if (!foundItemId || removingItemId) {
        return;
      }

      setRemovingItemId(foundItemId);
      setErrorText('');
      setNoticeText('');

      try {
        const response = await authedAdminRequest(`/api/admin/found-items/${encodeURIComponent(foundItemId)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Failed to remove found item.'));
        }

        setRecentFoundItems((previous) => previous.filter((item) => item.id !== foundItemId));
        setNoticeText('Found item removed successfully.');
        await loadAdminOverview({ soft: true });
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to remove found item.';

        setErrorText(message);
      } finally {
        setRemovingItemId('');
      }
    },
    [authedAdminRequest, loadAdminOverview, removingItemId],
  );

  const handleUpdateRequestStatus = useCallback(
    async (requestId: string, status: string) => {
      if (!requestId || !status || updatingRequestId) {
        return;
      }

      setUpdatingRequestId(requestId);
      setErrorText('');
      setNoticeText('');

      try {
        const response = await authedAdminRequest(
          `/api/admin/match-requests/${encodeURIComponent(requestId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          },
        );

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Failed to update request status.'));
        }

        setNoticeText(`Request status updated to ${status.replace('_', ' ')}.`);
        await loadAdminOverview({ soft: true });
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to update request status.';

        setErrorText(message);
      } finally {
        setUpdatingRequestId('');
      }
    },
    [authedAdminRequest, loadAdminOverview, updatingRequestId],
  );

  if (!hasAdminAccess) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <AppTopBar
          leftIcon="arrow-back"
          onLeftPress={() => navigation.navigate('Settings')}
          rightIcon="home"
          onRightPress={() => navigation.navigate('Home')}
          title="Admin"
        />

        <View style={styles.deniedWrap}>
          <View style={styles.deniedCard}>
            <MaterialIcons color={colors.error} name="lock-outline" size={24} />
            <Text style={styles.deniedTitle}>Admin access denied</Text>
            <Text style={styles.deniedSubtitle}>
              Signed-in email {userEmail || 'unknown'} is not allowed to open Admin Dashboard.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar
        leftIcon="arrow-back"
        onLeftPress={() => navigation.navigate('Settings')}
        rightIcon="refresh"
        onRightPress={() => void handleRefresh()}
        title="Admin"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Admin Control Center</Text>
          <Text style={styles.heroSubtitle}>Authorized for {userEmail}</Text>
        </View>

        <View style={styles.statsGrid}>
          {[
            { label: 'Users', value: counts.users, icon: 'group' },
            { label: 'Found Items', value: counts.foundItems, icon: 'inventory-2' },
            { label: 'Claims', value: counts.claims, icon: 'fact-check' },
            { label: 'Submitted', value: counts.submittedClaims, icon: 'schedule' },
            { label: 'Approved', value: counts.approvedClaims, icon: 'verified' },
            { label: 'Picked Up', value: counts.pickedUpClaims, icon: 'task-alt' },
            { label: 'Rejected', value: counts.rejectedClaims, icon: 'cancel' },
            { label: 'Push Devices', value: counts.activePushDevices, icon: 'notifications-active' },
          ].map((item) => (
            <View key={item.label} style={styles.statCard}>
              <MaterialIcons color={colors.primary} name={item.icon as keyof typeof MaterialIcons.glyphMap} size={18} />
              <Text style={styles.statValue}>{item.value}</Text>
              <Text style={styles.statLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Broadcast Notification</Text>
          <TextInput
            onChangeText={setBroadcastTitle}
            placeholder="Broadcast title"
            placeholderTextColor={colors.outline}
            style={styles.input}
            value={broadcastTitle}
          />
          <TextInput
            multiline
            onChangeText={setBroadcastMessage}
            placeholder="Write your announcement to all users"
            placeholderTextColor={colors.outline}
            style={[styles.input, styles.inputMultiline]}
            textAlignVertical="top"
            value={broadcastMessage}
          />

          <Pressable
            disabled={isBroadcasting || isLoading}
            onPress={() => void handleBroadcast()}
            style={[styles.primaryButton, isBroadcasting || isLoading ? styles.primaryButtonDisabled : undefined]}
          >
            {isBroadcasting ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <>
                <MaterialIcons color={colors.onPrimary} name="campaign" size={16} />
                <Text style={styles.primaryButtonText}>Send Broadcast</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Found Item Moderation</Text>
          {recentFoundItems.length ? (
            recentFoundItems.slice(0, 12).map((item) => (
              <View key={item.id} style={styles.rowCard}>
                <View style={styles.rowBody}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>{item.location} • {item.category}</Text>
                  <Text style={styles.rowTime}>{formatRelativeTime(item.createdAt)}</Text>
                </View>
                <Pressable
                  disabled={Boolean(removingItemId) || isLoading}
                  onPress={() => void handleRemoveFoundItem(item.id)}
                  style={styles.rowDangerButton}
                >
                  <MaterialIcons color={colors.error} name="delete-outline" size={16} />
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No found items to moderate.</Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Request Moderation</Text>
          {recentRequests.length ? (
            recentRequests.slice(0, 14).map((request) => (
              <View key={request.id} style={styles.rowCardTall}>
                <View style={styles.rowBody}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{request.foundItemTitle}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    Status: {request.status} • {formatRelativeTime(request.createdAt)}
                  </Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>{request.foundItemLocation}</Text>
                </View>

                <View style={styles.actionRow}>
                  {['approved', 'rejected', 'picked_up', 'submitted', 'cancelled'].map((nextStatus) => (
                    <Pressable
                      key={`${request.id}-${nextStatus}`}
                      disabled={Boolean(updatingRequestId) || request.status === nextStatus}
                      onPress={() => void handleUpdateRequestStatus(request.id, nextStatus)}
                      style={[
                        styles.actionChip,
                        request.status === nextStatus ? styles.actionChipActive : undefined,
                      ]}
                    >
                      <Text
                        style={[
                          styles.actionChipText,
                          request.status === nextStatus ? styles.actionChipTextActive : undefined,
                        ]}
                      >
                        {nextStatus.replace('_', ' ')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No requests to moderate.</Text>
          )}
        </View>

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.loadingText}>Loading admin dashboard...</Text>
          </View>
        ) : null}

        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        {noticeText ? <Text style={styles.noticeText}>{noticeText}</Text> : null}
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
    paddingBottom: 32,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  deniedWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  deniedCard: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: 18,
    paddingVertical: 18,
    width: '100%',
  },
  deniedTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
    marginTop: 8,
  },
  deniedSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  heroCard: {
    ...shadows.soft,
    backgroundColor: '#EEF3FF',
    borderColor: '#D8E1FF',
    borderRadius: radii.xl,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  heroTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 24,
  },
  heroSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.13)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 8,
    minHeight: 82,
    paddingHorizontal: 10,
    paddingVertical: 10,
    width: '48.5%',
  },
  statValue: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 26,
    marginTop: 6,
  },
  statLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  sectionCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.13)',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F7F8FC',
    borderColor: '#DDE3F2',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inputMultiline: {
    minHeight: 84,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
  rowCard: {
    alignItems: 'center',
    borderBottomColor: '#ECEFF6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 8,
  },
  rowCardTall: {
    borderBottomColor: '#ECEFF6',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
  },
  rowMeta: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 2,
  },
  rowTime: {
    color: colors.outline,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 4,
  },
  rowDangerButton: {
    alignItems: 'center',
    backgroundColor: '#FDECED',
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    marginLeft: 8,
    width: 34,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  actionChip: {
    alignItems: 'center',
    backgroundColor: '#EDF2FD',
    borderColor: '#D9E4F8',
    borderRadius: radii.pill,
    borderWidth: 1,
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionChipText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  actionChipTextActive: {
    color: colors.onPrimary,
  },
  emptyText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    paddingVertical: 8,
  },
  loadingCard: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 6,
  },
  errorText: {
    color: colors.error,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  noticeText: {
    color: colors.success,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
});
