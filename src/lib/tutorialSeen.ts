import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const inMemorySeenKeys = new Set<string>();
const ASYNC_STORAGE_PREFIX = 'tutorial-seen-v1';
const REQUEST_TIMEOUT_MS = 12000;

type SessionTokenResolver = () => Promise<string | null>;

export type TutorialSyncOptions = {
  tutorialKey: string;
  userId: string;
  backendBaseUrl?: string;
  getToken?: SessionTokenResolver;
  userCreatedAtMs?: number;
};

function normalizeKey(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveAsyncStorageKey(key: string): string {
  return `${ASYNC_STORAGE_PREFIX}:${key}`;
}

function resolveLocalTutorialSeenKey(tutorialKey: string, userId: string): string {
  const normalizedTutorialKey = normalizeKey(tutorialKey);
  const normalizedUserId = normalizeKey(userId);

  if (!normalizedTutorialKey || !normalizedUserId) {
    return '';
  }

  return `${normalizedTutorialKey}:${normalizedUserId}`;
}

function resolveBackendBaseUrl(value: string | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\/+$/, '');
}

function toSeenBoolean(value: unknown): boolean | null {
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

  return null;
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...(init ?? {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function requestTutorialSeenFromBackend(options: TutorialSyncOptions): Promise<boolean | null> {
  const tutorialKey = normalizeKey(options.tutorialKey);
  const userId = normalizeKey(options.userId);
  const baseUrl = resolveBackendBaseUrl(options.backendBaseUrl);

  if (!tutorialKey || !userId || !baseUrl || !options.getToken) {
    return null;
  }

  const token = await options.getToken().catch(() => null);
  if (!token) {
    return null;
  }

  try {
    const clientCreatedAtMs =
      typeof options.userCreatedAtMs === 'number' && Number.isFinite(options.userCreatedAtMs)
        ? Math.max(0, Math.round(options.userCreatedAtMs))
        : 0;

    const endpoint =
      clientCreatedAtMs > 0
        ? `${baseUrl}/api/tutorials/me/${encodeURIComponent(tutorialKey)}?client_user_created_at=${clientCreatedAtMs}`
        : `${baseUrl}/api/tutorials/me/${encodeURIComponent(tutorialKey)}`;

    const response = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      seen?: unknown;
      shouldShow?: unknown;
    };

    const seenFromPayload = toSeenBoolean(payload.seen);
    if (seenFromPayload !== null) {
      return seenFromPayload;
    }

    const shouldShow = toSeenBoolean(payload.shouldShow);
    if (shouldShow !== null) {
      return !shouldShow;
    }

    return null;
  } catch {
    return null;
  }
}

async function persistTutorialSeenToBackend(
  options: TutorialSyncOptions,
  seen: boolean,
): Promise<boolean | null> {
  const tutorialKey = normalizeKey(options.tutorialKey);
  const userId = normalizeKey(options.userId);
  const baseUrl = resolveBackendBaseUrl(options.backendBaseUrl);

  if (!tutorialKey || !userId || !baseUrl || !options.getToken) {
    return null;
  }

  const token = await options.getToken().catch(() => null);
  if (!token) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/tutorials/me/${encodeURIComponent(tutorialKey)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seen }),
      },
    );

    if (!response.ok) {
      return null;
    }

    return Boolean(seen);
  } catch {
    return null;
  }
}

export async function readTutorialSeen(key: string): Promise<boolean> {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return true;
  }

  if (inMemorySeenKeys.has(normalizedKey)) {
    return true;
  }

  const asyncKey = resolveAsyncStorageKey(normalizedKey);

  try {
    const asyncValue = await AsyncStorage.getItem(asyncKey);
    if (asyncValue === 'seen') {
      inMemorySeenKeys.add(normalizedKey);
      return true;
    }

    const value = await SecureStore.getItemAsync(normalizedKey);
    const seen = value === 'seen';

    if (seen) {
      inMemorySeenKeys.add(normalizedKey);
      await AsyncStorage.setItem(asyncKey, 'seen').catch(() => {
        return;
      });
    }

    return seen;
  } catch {
    return false;
  }
}

export async function writeTutorialSeen(key: string): Promise<boolean> {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return false;
  }

  inMemorySeenKeys.add(normalizedKey);
  const asyncKey = resolveAsyncStorageKey(normalizedKey);
  let persisted = false;

  try {
    await AsyncStorage.setItem(asyncKey, 'seen');
    const asyncVerification = await AsyncStorage.getItem(asyncKey);
    persisted = asyncVerification === 'seen';
  } catch {
    persisted = false;
  }

  try {
    await SecureStore.setItemAsync(normalizedKey, 'seen');
    const verification = await SecureStore.getItemAsync(normalizedKey);
    if (verification === 'seen') {
      persisted = true;
    }
  } catch {
    return persisted;
  }

  return persisted;
}

export async function shouldShowTutorial(options: TutorialSyncOptions): Promise<boolean> {
  const localKey = resolveLocalTutorialSeenKey(options.tutorialKey, options.userId);

  if (!localKey) {
    return false;
  }

  const localSeen = await readTutorialSeen(localKey);
  const remoteSeen = await requestTutorialSeenFromBackend(options);

  if (typeof remoteSeen === 'boolean') {
    if (remoteSeen) {
      await writeTutorialSeen(localKey);
      return false;
    }

    if (localSeen) {
      await persistTutorialSeenToBackend(options, true);
      await writeTutorialSeen(localKey);
      return false;
    }

    return true;
  }

  return !localSeen;
}

export async function markTutorialCompleted(options: TutorialSyncOptions): Promise<boolean> {
  const localKey = resolveLocalTutorialSeenKey(options.tutorialKey, options.userId);

  if (!localKey) {
    return false;
  }

  const localPersisted = await writeTutorialSeen(localKey);
  const remotePersisted = await persistTutorialSeenToBackend(options, true);

  if (remotePersisted === null) {
    return localPersisted;
  }

  return Boolean(remotePersisted || localPersisted);
}
