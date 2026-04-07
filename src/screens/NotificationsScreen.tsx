import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '@clerk/clerk-expo';
import { useUser } from '@clerk/clerk-expo';
import { NavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  mapHistoryRowsToNotifications,
  NOTIFICATION_SEEN_STORAGE_PREFIX,
  type NotificationEntry,
} from '../lib/notifications';
import { useNotificationBadge } from '../lib/notificationBadge';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const REQUEST_TIMEOUT_MS = 15000;
const REALTIME_REFRESH_MS = 10000;

type HistoryRouteParams = {
  focusRequestId?: string;
  focusFoundItemId?: string;
  focusNonce?: number;
  autoOpenMessages?: boolean;
};

type NotificationTabNavigationParams = {
  Home: undefined;
  History: HistoryRouteParams | undefined;
  Notifications: undefined;
  Settings: undefined;
};

type NotificationRow = NotificationEntry & {
  unread: boolean;
};

function readText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function formatRelativeTime(timestampMs: number): string {
  const diffMs = Math.max(Date.now() - timestampMs, 0);
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
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestampMs).toLocaleDateString();
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...(init ?? {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Check your internet and try again.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function NotificationsScreen() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { requestSync } = useNotificationBadge();
  const navigation = useNavigation<NavigationProp<NotificationTabNavigationParams>>();
  const getTokenRef = useRef(getToken);
  const currentUserId = readText(user?.id);

  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [seenNotificationIds, setSeenNotificationIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const seenStorageKey = currentUserId ? `${NOTIFICATION_SEEN_STORAGE_PREFIX}:${currentUserId}` : '';

  useEffect(() => {
    let isActive = true;

    if (!seenStorageKey) {
      setSeenNotificationIds([]);
      return () => {
        isActive = false;
      };
    }

    const loadSeenIds = async () => {
      try {
        const serialized = await SecureStore.getItemAsync(seenStorageKey);
        const parsed = serialized ? (JSON.parse(serialized) as unknown) : [];

        if (!isActive) {
          return;
        }

        if (!Array.isArray(parsed)) {
          setSeenNotificationIds([]);
          return;
        }

        const normalized = parsed
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => Boolean(value));

        setSeenNotificationIds(normalized);
      } catch {
        if (isActive) {
          setSeenNotificationIds([]);
        }
      }
    };

    void loadSeenIds();

    return () => {
      isActive = false;
    };
  }, [seenStorageKey]);

  const markAsSeen = useCallback(
    (notificationIds: string[]) => {
      const validIds = notificationIds.map((id) => id.trim()).filter((id) => Boolean(id));
      if (!validIds.length) {
        return;
      }

      setSeenNotificationIds((previous) => {
        const merged = Array.from(new Set([...previous, ...validIds])).slice(-240);

        if (seenStorageKey) {
          void SecureStore
            .setItemAsync(seenStorageKey, JSON.stringify(merged))
            .then(() => {
              requestSync();
            })
            .catch(() => {
              requestSync();
            });
        } else {
          requestSync();
        }

        return merged;
      });
    },
    [requestSync, seenStorageKey],
  );

  const loadNotifications = useCallback(
    async (options?: { soft?: boolean }) => {
      const soft = options?.soft ?? false;

      setErrorText('');

      if (!soft) {
        setIsLoading(true);
      }

      try {
        if (!currentUserId) {
          setNotifications([]);
          setErrorText('Sign in to access notifications.');
          return;
        }

        const backendBaseUrl = backendEnv.backendUrl.replace(/\/+$/, '');
        if (!backendBaseUrl) {
          setNotifications([]);
          setErrorText('Backend URL is missing. Configure backend to load notifications.');
          return;
        }

        const token = await getTokenRef.current().catch(() => null);
        if (!token) {
          setNotifications([]);
          setErrorText('Could not load secure notifications. Please sign in again.');
          return;
        }

        const response = await fetchWithTimeout(`${backendBaseUrl}/api/match-requests/history/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Could not load notifications (${response.status}).`);
        }

        const payload = (await response.json()) as { items?: Record<string, unknown>[] };
        setNotifications(mapHistoryRowsToNotifications(payload.items, currentUserId, 80));
        requestSync();
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to load notifications.';

        setNotifications([]);
        setErrorText(message);
      } finally {
        if (!soft) {
          setIsLoading(false);
        }
      }
    },
    [currentUserId, requestSync],
  );

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useFocusEffect(
    useCallback(() => {
      const intervalId = setInterval(() => {
        void loadNotifications({ soft: true });
      }, REALTIME_REFRESH_MS);

      return () => {
        clearInterval(intervalId);
      };
    }, [loadNotifications]),
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadNotifications({ soft: true });
    setIsRefreshing(false);
  }, [loadNotifications]);

  const notificationRows = useMemo<NotificationRow[]>(() => {
    return notifications.map((entry) => ({
      ...entry,
      unread: !seenNotificationIds.includes(entry.id),
    }));
  }, [notifications, seenNotificationIds]);

  const unreadCount = useMemo(
    () => notificationRows.filter((entry) => entry.unread).length,
    [notificationRows],
  );

  const handleOpenNotification = useCallback(
    (entry: NotificationRow) => {
      markAsSeen([entry.id]);
      navigation.navigate('History', {
        focusRequestId: entry.requestId,
        focusFoundItemId: entry.foundItemId,
        focusNonce: Date.now(),
        autoOpenMessages: entry.autoOpenMessages,
      });
    },
    [markAsSeen, navigation],
  );

  const handleMarkAllAsRead = useCallback(() => {
    markAsSeen(notificationRows.map((entry) => entry.id));
  }, [markAsSeen, notificationRows]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar
        leftIcon="home"
        onLeftPress={() => navigation.navigate('Home')}
        onRightPress={() => navigation.navigate('Settings')}
        rightIcon="settings"
        title="UniSync"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Notifications</Text>
              <Text style={styles.headerSubtitle}>
                {unreadCount > 0
                  ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'}`
                  : 'All caught up'}
              </Text>
            </View>
            <View style={styles.badgeBubble}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          </View>

          <View style={styles.headerActionRow}>
            <Pressable
              disabled={!notificationRows.length || unreadCount === 0}
              onPress={handleMarkAllAsRead}
              style={[
                styles.headerActionButton,
                (!notificationRows.length || unreadCount === 0) && styles.headerActionButtonDisabled,
              ]}
            >
              <MaterialIcons color={colors.primaryContainer} name="done-all" size={16} />
              <Text style={styles.headerActionText}>Mark all read</Text>
            </Pressable>

            <Pressable onPress={handleRefresh} style={styles.headerActionButton}>
              <MaterialIcons color={colors.primaryContainer} name="refresh" size={16} />
              <Text style={styles.headerActionText}>Refresh</Text>
            </Pressable>
          </View>
        </View>

        {errorText ? (
          <View style={styles.errorCard}>
            <MaterialIcons color={colors.error} name="error-outline" size={18} />
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.primaryContainer} size="small" />
            <Text style={styles.loadingText}>Loading notifications...</Text>
          </View>
        ) : null}

        {!isLoading && !notificationRows.length ? (
          <View style={styles.emptyCard}>
            <MaterialIcons color={colors.outline} name="notifications-none" size={24} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptySubtitle}>
              Claim approvals, reviews, and pickup updates will appear here.
            </Text>
          </View>
        ) : null}

        {!isLoading
          ? notificationRows.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => handleOpenNotification(entry)}
                style={[
                  styles.notificationCard,
                  entry.unread ? styles.notificationCardUnread : undefined,
                ]}
              >
                <View style={[styles.iconBubble, { backgroundColor: entry.iconBackground }]}> 
                  <MaterialIcons color={entry.iconColor} name={entry.icon} size={20} />
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTopRow}>
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {entry.title}
                    </Text>
                    <Text style={styles.cardTime}>{formatRelativeTime(entry.timestampMs)}</Text>
                  </View>

                  <Text style={styles.cardSubtitle}>{entry.subtitle}</Text>
                  <Text style={styles.cardActionLabel}>Open in History</Text>
                </View>
              </Pressable>
            ))
          : null}
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
    paddingTop: 16,
  },
  headerCard: {
    backgroundColor: '#EEF3FF',
    borderColor: '#D8E1FF',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  headerTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 24,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginTop: 2,
  },
  badgeBubble: {
    alignItems: 'center',
    backgroundColor: colors.primaryContainer,
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  headerActionRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  headerActionButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E1FF',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginRight: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerActionButtonDisabled: {
    opacity: 0.4,
  },
  headerActionText: {
    color: colors.primaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  errorCard: {
    alignItems: 'center',
    backgroundColor: '#FDECEC',
    borderColor: '#F5CCCC',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: colors.error,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginLeft: 8,
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginLeft: 10,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  emptyTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 18,
    marginTop: 10,
  },
  emptySubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  notificationCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: '#E4E6F0',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    ...shadows.soft,
  },
  notificationCardUnread: {
    borderColor: '#BDCCFF',
    borderWidth: 1.4,
  },
  iconBubble: {
    alignItems: 'center',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  cardBody: {
    flex: 1,
    marginLeft: 10,
  },
  cardTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
    marginRight: 8,
  },
  cardTime: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 1,
  },
  cardSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  cardActionLabel: {
    color: colors.primaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginTop: 8,
  },
});
