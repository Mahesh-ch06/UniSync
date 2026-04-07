import { useAuth } from '@clerk/clerk-expo';
import { useUser } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { backendEnv } from '../config/env';
import { mapHistoryRowsToNotifications, NOTIFICATION_SEEN_STORAGE_PREFIX } from './notifications';

type NotificationBadgeContextValue = {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  requestSync: () => void;
};

const NotificationBadgeContext = createContext<NotificationBadgeContextValue | null>(null);

const REQUEST_TIMEOUT_MS = 12000;
const REALTIME_SYNC_INTERVAL_MS = 10000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function readText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
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
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function NotificationBadgeProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  const currentUserId = readText(user?.id);

  const [unreadCount, setUnreadCountState] = useState(0);
  const [syncNonce, setSyncNonce] = useState(0);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const setUnreadCount = useCallback((count: number) => {
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    setUnreadCountState(safeCount);
  }, []);

  const requestSync = useCallback(() => {
    setSyncNonce((previous) => previous + 1);
  }, []);

  const syncUnreadCountFromBackend = useCallback(async () => {
    if (!currentUserId) {
      setUnreadCountState(0);
      return;
    }

    const backendBaseUrl = backendEnv.backendUrl.replace(/\/+$/, '');
    if (!backendBaseUrl) {
      setUnreadCountState(0);
      return;
    }

    const token = await getTokenRef.current().catch(() => null);
    if (!token) {
      return;
    }

    try {
      const response = await fetchWithTimeout(`${backendBaseUrl}/api/match-requests/history/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        items?: Record<string, unknown>[];
      };

      const notifications = mapHistoryRowsToNotifications(payload.items, currentUserId, 120);
      const seenStorageKey = `${NOTIFICATION_SEEN_STORAGE_PREFIX}:${currentUserId}`;

      const serializedSeen = await SecureStore.getItemAsync(seenStorageKey).catch(() => null);
      const parsedSeen = serializedSeen ? (JSON.parse(serializedSeen) as unknown) : [];
      const seenIds = Array.isArray(parsedSeen)
        ? parsedSeen
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => Boolean(value))
        : [];

      const nextUnreadCount = notifications.filter((entry) => !seenIds.includes(entry.id)).length;
      setUnreadCountState(nextUnreadCount);
    } catch {
      return;
    }
  }, [currentUserId]);

  useEffect(() => {
    void syncUnreadCountFromBackend();

    if (!currentUserId) {
      return;
    }

    const intervalId = setInterval(() => {
      void syncUnreadCountFromBackend();
    }, REALTIME_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [currentUserId, syncNonce, syncUnreadCountFromBackend]);

  useEffect(() => {
    let isActive = true;
    const subscriptions: Array<{ remove: () => void }> = [];

    const notificationReceivedSubscription = Notifications.addNotificationReceivedListener(() => {
      requestSync();
    });

    const notificationResponseSubscription =
      Notifications.addNotificationResponseReceivedListener(() => {
        requestSync();
      });

    subscriptions.push(notificationReceivedSubscription, notificationResponseSubscription);

    const registerDevicePushToken = async () => {
      if (!currentUserId) {
        return;
      }

      const backendBaseUrl = backendEnv.backendUrl.replace(/\/+$/, '');
      if (!backendBaseUrl || !Device.isDevice) {
        return;
      }

      const token = await getTokenRef.current().catch(() => null);
      if (!token) {
        return;
      }

      let permissionStatus = (await Notifications.getPermissionsAsync()).status;

      if (permissionStatus !== 'granted') {
        permissionStatus = (await Notifications.requestPermissionsAsync()).status;
      }

      if (permissionStatus !== 'granted') {
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      const easProjectId =
        readText(Constants?.expoConfig?.extra?.eas?.projectId) ||
        readText(Constants?.easConfig?.projectId);

      const pushTokenResponse = await Notifications.getExpoPushTokenAsync(
        easProjectId ? { projectId: easProjectId } : undefined,
      );

      const expoPushToken = readText(pushTokenResponse?.data);
      if (!expoPushToken || !isActive) {
        return;
      }

      await fetchWithTimeout(`${backendBaseUrl}/api/push/register-device`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expo_push_token: expoPushToken,
          platform: Platform.OS,
          device_label: readText(Device.modelName),
          app_version: readText(Constants?.expoConfig?.version),
        }),
      }).catch(() => {
        return;
      });
    };

    void registerDevicePushToken();

    return () => {
      isActive = false;
      subscriptions.forEach((subscription) => {
        try {
          subscription.remove();
        } catch {
          return;
        }
      });
    };
  }, [currentUserId, requestSync]);

  const value = useMemo(
    () => ({
      unreadCount,
      setUnreadCount,
      requestSync,
    }),
    [requestSync, setUnreadCount, unreadCount],
  );

  return <NotificationBadgeContext.Provider value={value}>{children}</NotificationBadgeContext.Provider>;
}

export function useNotificationBadge(): NotificationBadgeContextValue {
  const context = useContext(NotificationBadgeContext);

  if (!context) {
    return {
      unreadCount: 0,
      setUnreadCount: () => {
        return;
      },
      requestSync: () => {
        return;
      },
    };
  }

  return context;
}
