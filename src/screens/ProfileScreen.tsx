import { useAuth, useUser } from '@clerk/clerk-expo';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { type SupabaseClient } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { backendEnv } from '../config/env';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

type ProfileFormState = {
  displayName: string;
  campusName: string;
  department: string;
  yearOfStudy: string;
  phone: string;
  bio: string;
  avatarUrl: string;
  notifyClaimUpdates: boolean;
  notifyMessages: boolean;
  publicProfile: boolean;
};

type ProfileStats = {
  totalPoints: number;
  level: string;
  itemsReported: number;
  claimsSubmitted: number;
  claimsInProgress: number;
  claimsApproved: number;
  claimsPickedUp: number;
};

type ProfileSummaryRow = {
  total_points?: unknown;
  level?: unknown;
  items_reported?: unknown;
  claims_submitted?: unknown;
  claims_in_progress?: unknown;
  claims_approved?: unknown;
  claims_picked_up?: unknown;
  last_activity_at?: unknown;
};

type ProfileRow = {
  display_name?: unknown;
  campus_name?: unknown;
  department?: unknown;
  year_of_study?: unknown;
  phone?: unknown;
  bio?: unknown;
  avatar_url?: unknown;
  notify_claim_updates?: unknown;
  notify_messages?: unknown;
  public_profile?: unknown;
};

type PointsLedgerRow = {
  id?: unknown;
  points?: unknown;
  reason?: unknown;
  created_at?: unknown;
};

type PointsStatsRow = {
  total_points?: unknown;
  level?: unknown;
  updated_at?: unknown;
};

type PointsLedgerStatsRow = {
  points?: unknown;
  created_at?: unknown;
};

type FoundStatsRow = {
  created_at?: unknown;
};

type ClaimStatsRow = {
  status?: unknown;
  created_at?: unknown;
  reviewed_at?: unknown;
  pickup_confirmed_at?: unknown;
};

type ActivityItem = {
  id: string;
  points: number;
  reason: string;
  createdAt: string | null;
};

type LoadProfileOptions = {
  soft?: boolean;
};

type PostgrestErrorLike = {
  code?: string;
  message?: string;
};

type ProfileTabParamList = {
  Home: undefined;
  Map: undefined;
  Report: undefined;
  History: {
    focusRequestId?: string;
    focusFoundItemId?: string;
    focusNonce?: number;
    autoOpenMessages?: boolean;
  } | undefined;
  Profile: undefined;
  Settings: undefined;
};

type SaveProfileOptions = {
  refresh?: boolean;
  silent?: boolean;
};

const DEFAULT_STATS: ProfileStats = {
  totalPoints: 0,
  level: 'Seed',
  itemsReported: 0,
  claimsSubmitted: 0,
  claimsInProgress: 0,
  claimsApproved: 0,
  claimsPickedUp: 0,
};

const PROFILE_LOAD_TIMEOUT_MS = 15000;

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

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lowered = value.toLowerCase().trim();
    if (lowered === 'true') {
      return true;
    }

    if (lowered === 'false') {
      return false;
    }
  }

  return fallback;
}

function readIdentifier(value: unknown, fallback: string): string {
  const asText = readText(value);
  if (asText) {
    return asText;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function toTitleCase(value: string): string {
  const cleaned = value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Activity';
  }

  return cleaned
    .split(' ')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function formatTimeAgo(dateText: string | null): string {
  if (!dateText) {
    return 'no activity yet';
  }

  const timestamp = new Date(dateText).getTime();
  if (Number.isNaN(timestamp)) {
    return 'no activity yet';
  }

  // Guard against placeholder/epoch timestamps from fallback SQL logic.
  if (timestamp < Date.UTC(2005, 0, 1)) {
    return 'no activity yet';
  }

  const deltaMs = Math.max(Date.now() - timestamp, 0);
  const minutes = Math.floor(deltaMs / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  if (days >= 365) {
    return `${Math.floor(days / 365)}y ago`;
  }

  return `${days}d ago`;
}

function isMissingSchemaError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }

  const message = readText(error.message).toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === '42883' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('function') && message.includes('does not exist'))
  );
}

function isRlsPolicyError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }

  const message = readText(error.message).toLowerCase();
  return (
    error.code === '42501' ||
    (message.includes('row-level security') && message.includes('user_profiles'))
  );
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    task
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function computeLevelFromPoints(totalPoints: number): string {
  if (totalPoints >= 1200) {
    return 'Legend';
  }

  if (totalPoints >= 700) {
    return 'Champion';
  }

  if (totalPoints >= 350) {
    return 'Guardian';
  }

  if (totalPoints >= 150) {
    return 'Tracker';
  }

  if (totalPoints >= 50) {
    return 'Scout';
  }

  return 'Seed';
}

function resolveImageExtension(uri: string, mimeType?: string | null): string {
  const mime = readText(mimeType);

  if (mime === 'image/png') {
    return 'png';
  }

  if (mime === 'image/webp') {
    return 'webp';
  }

  const uriWithoutQuery = uri.split('?')[0] ?? uri;
  const uriParts = uriWithoutQuery.split('.');
  const candidate = (uriParts[uriParts.length - 1] ?? '').toLowerCase();

  if (candidate === 'jpg' || candidate === 'jpeg' || candidate === 'png' || candidate === 'webp') {
    return candidate === 'jpg' ? 'jpeg' : candidate;
  }

  return 'jpeg';
}

async function resolveSupabaseAccessToken(
  getTokenFn: ReturnType<typeof useAuth>['getToken'],
): Promise<string | null> {
  const firstAttempt = await getTokenFn().catch(() => null);
  const normalizedFirstAttempt = readText(firstAttempt);
  if (normalizedFirstAttempt) {
    return normalizedFirstAttempt;
  }

  // Clerk tokens can be briefly unavailable right after session restore.
  await new Promise((resolve) => setTimeout(resolve, 350));
  const secondAttempt = await getTokenFn().catch(() => null);
  const normalizedSecondAttempt = readText(secondAttempt);
  return normalizedSecondAttempt || null;
}

function tokenMissingMessage(): string {
  return 'Authentication token missing. Sign out and sign in again.';
}

function profileSignature(form: ProfileFormState): string {
  return [
    form.displayName.trim(),
    form.campusName.trim(),
    form.department.trim(),
    form.yearOfStudy.trim(),
    form.phone.trim(),
    form.bio.trim(),
    form.avatarUrl.trim(),
    form.notifyClaimUpdates ? '1' : '0',
    form.notifyMessages ? '1' : '0',
    form.publicProfile ? '1' : '0',
  ].join('|');
}

function normalizeProfileErrorMessage(error: unknown, fallbackMessage: string): string {
  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : fallbackMessage;

  const normalized = readText(message).toLowerCase();

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network request failed') ||
    normalized.includes('network issue')
  ) {
    return 'Network issue while syncing profile. Check your internet and retry.';
  }

  return message || fallbackMessage;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
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
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseError(response: Response, fallbackMessage: string): Promise<string> {
  if (response.status === 404) {
    return 'Backend profile route is not available. Deploy the latest backend and retry.';
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

function buildDefaultProfile(user: ReturnType<typeof useUser>['user']): ProfileFormState {
  const firstName = readText(user?.firstName);
  const lastName = readText(user?.lastName);
  const username = readText(user?.username);
  const email = readText(user?.primaryEmailAddress?.emailAddress);

  const displayName = `${firstName} ${lastName}`.trim() || username || email;

  return {
    displayName,
    campusName: '',
    department: '',
    yearOfStudy: '',
    phone: '',
    bio: '',
    avatarUrl: readText(user?.imageUrl),
    notifyClaimUpdates: true,
    notifyMessages: true,
    publicProfile: false,
  };
}

function mergeProfileData(defaultProfile: ProfileFormState, row: ProfileRow | null): ProfileFormState {
  if (!row) {
    return defaultProfile;
  }

  const yearValue = readNumber(row.year_of_study);

  return {
    displayName: readText(row.display_name) || defaultProfile.displayName,
    campusName: readText(row.campus_name),
    department: readText(row.department),
    yearOfStudy: yearValue > 0 ? String(Math.round(yearValue)) : '',
    phone: readText(row.phone),
    bio: readText(row.bio),
    avatarUrl: readText(row.avatar_url) || defaultProfile.avatarUrl,
    notifyClaimUpdates: readBoolean(row.notify_claim_updates, defaultProfile.notifyClaimUpdates),
    notifyMessages: readBoolean(row.notify_messages, defaultProfile.notifyMessages),
    publicProfile: readBoolean(row.public_profile, defaultProfile.publicProfile),
  };
}

function parseSummaryStats(summary: ProfileSummaryRow | null): ProfileStats {
  if (!summary) {
    return DEFAULT_STATS;
  }

  return {
    totalPoints: Math.max(0, Math.round(readNumber(summary.total_points))),
    level: readText(summary.level) || 'Seed',
    itemsReported: Math.max(0, Math.round(readNumber(summary.items_reported))),
    claimsSubmitted: Math.max(0, Math.round(readNumber(summary.claims_submitted))),
    claimsInProgress: Math.max(0, Math.round(readNumber(summary.claims_in_progress))),
    claimsApproved: Math.max(0, Math.round(readNumber(summary.claims_approved))),
    claimsPickedUp: Math.max(0, Math.round(readNumber(summary.claims_picked_up))),
  };
}

async function loadStatsFallback(
  client: SupabaseClient,
  userId: string,
): Promise<{ stats: ProfileStats; lastActivityAt: string | null }> {
  const [pointsResult, foundResult, claimsResult, ledgerStatsResult] = await Promise.all([
    client
      .from('user_points')
      .select('total_points,level,updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    client.from('found_items').select('created_at').eq('created_by', userId),
    client
      .from('match_requests')
      .select('status,created_at,reviewed_at,pickup_confirmed_at')
      .eq('claimant_user_id', userId),
    client.from('points_ledger').select('points,created_at').eq('user_id', userId),
  ]);

  if (pointsResult.error && !isMissingSchemaError(pointsResult.error)) {
    throw pointsResult.error;
  }

  if (foundResult.error && !isMissingSchemaError(foundResult.error)) {
    throw foundResult.error;
  }

  if (claimsResult.error && !isMissingSchemaError(claimsResult.error)) {
    throw claimsResult.error;
  }

  if (ledgerStatsResult.error && !isMissingSchemaError(ledgerStatsResult.error)) {
    throw ledgerStatsResult.error;
  }

  const pointsRow = (pointsResult.data as PointsStatsRow | null) ?? null;
  const foundRows = Array.isArray(foundResult.data) ? (foundResult.data as FoundStatsRow[]) : [];
  const claimRows = Array.isArray(claimsResult.data) ? (claimsResult.data as ClaimStatsRow[]) : [];
  const ledgerStatsRows = Array.isArray(ledgerStatsResult.data)
    ? (ledgerStatsResult.data as PointsLedgerStatsRow[])
    : [];

  const ledgerPointsTotal = ledgerStatsRows.reduce((sum, row) => sum + Math.round(readNumber(row.points)), 0);
  const pointsFromTable = Math.max(0, Math.round(readNumber(pointsRow?.total_points)));
  const totalPoints = pointsFromTable > 0 ? pointsFromTable : Math.max(0, ledgerPointsTotal);
  const level = readText(pointsRow?.level) || computeLevelFromPoints(totalPoints);

  const claimsInProgress = claimRows.filter((row) => {
    const status = readText(row.status);
    return status === 'submitted' || status === 'approved';
  }).length;
  const claimsApproved = claimRows.filter((row) => readText(row.status) === 'approved').length;
  const claimsPickedUp = claimRows.filter((row) => readText(row.status) === 'picked_up').length;

  const candidateDates: string[] = [];

  const pointsUpdated = readText(pointsRow?.updated_at);
  if (pointsUpdated) {
    candidateDates.push(pointsUpdated);
  }

  ledgerStatsRows.forEach((row) => {
    const created = readText(row.created_at);
    if (created) {
      candidateDates.push(created);
    }
  });

  foundRows.forEach((row) => {
    const created = readText(row.created_at);
    if (created) {
      candidateDates.push(created);
    }
  });

  claimRows.forEach((row) => {
    const created = readText(row.created_at);
    const reviewed = readText(row.reviewed_at);
    const pickedUp = readText(row.pickup_confirmed_at);

    if (created) {
      candidateDates.push(created);
    }

    if (reviewed) {
      candidateDates.push(reviewed);
    }

    if (pickedUp) {
      candidateDates.push(pickedUp);
    }
  });

  let lastActivityAt: string | null = null;
  let latestTimestamp = 0;

  candidateDates.forEach((value) => {
    const timestamp = new Date(value).getTime();
    if (!Number.isNaN(timestamp) && timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      lastActivityAt = value;
    }
  });

  return {
    stats: {
      totalPoints,
      level,
      itemsReported: foundRows.length,
      claimsSubmitted: claimRows.length,
      claimsInProgress,
      claimsApproved,
      claimsPickedUp,
    },
    lastActivityAt,
  };
}

export function ProfileScreen() {
  const { getToken, signOut, isLoaded: isAuthLoaded } = useAuth();
  const { user } = useUser();
  const navigation = useNavigation<BottomTabNavigationProp<ProfileTabParamList>>();

  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const userPrimaryEmail = readText(user?.primaryEmailAddress?.emailAddress);
  const backendBaseUrl = useMemo(() => backendEnv.backendUrl.replace(/\/+$/, ''), []);

  const defaultProfile = useMemo(
    () => buildDefaultProfile(user),
    [user?.id, user?.firstName, user?.lastName, user?.username, user?.imageUrl, userPrimaryEmail],
  );
  const defaultProfileRef = useRef(defaultProfile);
  const userId = readText(user?.id);

  const [form, setForm] = useState<ProfileFormState>(defaultProfile);
  const [stats, setStats] = useState<ProfileStats>(DEFAULT_STATS);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastActivityAt, setLastActivityAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'synced' | 'error'>('idle');

  const lastSavedSignatureRef = useRef(profileSignature(defaultProfile));

  useEffect(() => {
    defaultProfileRef.current = defaultProfile;
    lastSavedSignatureRef.current = profileSignature(defaultProfile);
  }, [defaultProfile]);

  useEffect(() => {
    setForm(defaultProfileRef.current);
  }, [userId]);

  const authedProfileRequest = useCallback(
    async (path: string, init: RequestInit, timeoutMessage: string) => {
      if (!backendBaseUrl) {
        throw new Error('Backend is not configured. Set EXPO_PUBLIC_BACKEND_URL.');
      }

      const accessToken = await withTimeout(
        resolveSupabaseAccessToken(getTokenRef.current),
        PROFILE_LOAD_TIMEOUT_MS,
        timeoutMessage,
      );

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
        PROFILE_LOAD_TIMEOUT_MS,
        timeoutMessage,
      );
    },
    [backendBaseUrl],
  );

  const loadProfileData = useCallback(
    async (options?: LoadProfileOptions) => {
      const isSoft = options?.soft ?? false;

      if (!isAuthLoaded) {
        if (!isSoft) {
          setIsLoading(true);
        }
        return;
      }

      if (!userId) {
        setErrorMessage('Sign in to manage your profile.');
        setStats(DEFAULT_STATS);
        setActivityItems([]);
        setLastActivityAt(null);
        setSyncStatus('idle');
        setIsLoading(false);
        return;
      }

      setErrorMessage('');

      if (!isSoft) {
        setIsLoading(true);
      }

      try {
        const timeoutMessage =
          'Profile loading timed out. Check your internet connection and pull to refresh.';

        const response = await authedProfileRequest(
          '/api/profile/me',
          {
            method: 'GET',
          },
          timeoutMessage,
        );

        if (response.status === 404) {
          let legacyPointsPayload: {
            totalPoints?: unknown;
            level?: unknown;
            recentActivity?: PointsLedgerRow[];
          } | null = null;

          try {
            const legacyPointsResponse = await authedProfileRequest(
              '/api/points/me',
              {
                method: 'GET',
              },
              timeoutMessage,
            );

            if (legacyPointsResponse.ok) {
              legacyPointsPayload = (await legacyPointsResponse.json()) as {
                totalPoints?: unknown;
                level?: unknown;
                recentActivity?: PointsLedgerRow[];
              };
            }
          } catch {
            // Keep fallback defaults if legacy points route is unavailable.
          }

          const fallbackForm = defaultProfileRef.current;
          setForm(fallbackForm);
          lastSavedSignatureRef.current = profileSignature(fallbackForm);

          const legacyRows = Array.isArray(legacyPointsPayload?.recentActivity)
            ? legacyPointsPayload.recentActivity
            : [];

          setStats({
            ...DEFAULT_STATS,
            totalPoints: Math.max(0, Math.round(readNumber(legacyPointsPayload?.totalPoints))),
            level: readText(legacyPointsPayload?.level) || 'Seed',
          });

          setActivityItems(
            legacyRows.map((row, index) => ({
              id: readIdentifier(row.id, `legacy-activity-${index}`),
              points: Math.round(readNumber(row.points)),
              reason: toTitleCase(readText(row.reason) || 'Activity'),
              createdAt: readText(row.created_at) || null,
            })),
          );

          setLastActivityAt(readText(legacyRows[0]?.created_at) || null);
          setErrorMessage('');
          setSuccessMessage('Using compatibility profile mode. Deploy latest backend for full profile sync.');
          setSyncStatus('synced');
          return;
        }

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Failed to load profile data.'));
        }

        const payload = (await response.json()) as {
          profile?: unknown;
          stats?: {
            totalPoints?: unknown;
            level?: unknown;
            itemsReported?: unknown;
            claimsSubmitted?: unknown;
            claimsInProgress?: unknown;
            claimsApproved?: unknown;
            claimsPickedUp?: unknown;
          };
          activity?: PointsLedgerRow[];
          lastActivityAt?: unknown;
        };

        const profileRow =
          payload.profile && typeof payload.profile === 'object'
            ? (payload.profile as ProfileRow)
            : null;

        const mergedForm = mergeProfileData(defaultProfileRef.current, profileRow);
        setForm(mergedForm);
        lastSavedSignatureRef.current = profileSignature(mergedForm);
        setSyncStatus('synced');

        const statsPayload = payload.stats;
        setStats({
          totalPoints: Math.max(0, Math.round(readNumber(statsPayload?.totalPoints))),
          level: readText(statsPayload?.level) || 'Seed',
          itemsReported: Math.max(0, Math.round(readNumber(statsPayload?.itemsReported))),
          claimsSubmitted: Math.max(0, Math.round(readNumber(statsPayload?.claimsSubmitted))),
          claimsInProgress: Math.max(0, Math.round(readNumber(statsPayload?.claimsInProgress))),
          claimsApproved: Math.max(0, Math.round(readNumber(statsPayload?.claimsApproved))),
          claimsPickedUp: Math.max(0, Math.round(readNumber(statsPayload?.claimsPickedUp))),
        });

        const ledgerRows = Array.isArray(payload.activity) ? payload.activity : [];
        setActivityItems(
          ledgerRows.map((row, index) => ({
            id: readIdentifier(row.id, `activity-${index}`),
            points: Math.round(readNumber(row.points)),
            reason: toTitleCase(readText(row.reason) || 'Activity'),
            createdAt: readText(row.created_at) || null,
          })),
        );

        setLastActivityAt(readText(payload.lastActivityAt) || null);
      } catch (error) {
        const message = normalizeProfileErrorMessage(error, 'Failed to load profile data.');

        setErrorMessage(message);
        setSyncStatus('error');
      } finally {
        if (!isSoft) {
          setIsLoading(false);
        }
      }
    },
      [authedProfileRequest, isAuthLoaded, userId],
  );

  useEffect(() => {
    void loadProfileData();
  }, [loadProfileData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadProfileData({ soft: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadProfileData]);

  const handleToggle = useCallback((key: 'notifyClaimUpdates' | 'notifyMessages' | 'publicProfile') => {
    if (isSaving || isUploadingAvatar || isLoading) {
      return;
    }

    setSuccessMessage('');
    setSyncStatus('idle');
    setForm((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  }, [isLoading, isSaving, isUploadingAvatar]);

  const handleFieldChange = useCallback((field: keyof ProfileFormState, value: string) => {
    setSuccessMessage('');
    setSyncStatus('idle');
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }, []);

  const handleUploadAvatar = useCallback(async () => {
    if (!isAuthLoaded || isUploadingAvatar || isSaving || isLoading || !userId) {
      return;
    }

    setIsUploadingAvatar(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage('Allow photo access to upload a profile image.');
        return;
      }

      const pickedImage = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
        quality: 0.8,
      });

      if (pickedImage.canceled || pickedImage.assets.length === 0) {
        return;
      }

      const selectedAsset = pickedImage.assets[0];
      const encodedImage = readText(selectedAsset.base64);

      if (!encodedImage) {
        setErrorMessage('Could not encode the selected image. Try a different photo.');
        return;
      }

      const response = await authedProfileRequest(
        '/api/profile/avatar',
        {
          method: 'POST',
          body: JSON.stringify({
            image_base64: encodedImage,
            mime_type: selectedAsset.mimeType || 'image/jpeg',
          }),
        },
        'Avatar upload timed out. Try again.',
      );

      if (!response.ok) {
        throw new Error(await readResponseError(response, 'Could not upload profile image.'));
      }

      const payload = (await response.json()) as { avatarUrl?: unknown };
      const publicAvatarUrl = readText(payload.avatarUrl);

      if (!publicAvatarUrl) {
        setErrorMessage('Image uploaded, but failed to create public URL.');
        return;
      }

      setForm((previous) => ({
        ...previous,
        avatarUrl: publicAvatarUrl,
      }));
      setSyncStatus('idle');
      setSuccessMessage('Profile photo uploaded. Tap Save Profile to keep this change.');
    } catch (error) {
      const message = normalizeProfileErrorMessage(error, 'Could not upload profile image.');

      setErrorMessage(message);
      setSuccessMessage('');
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [authedProfileRequest, isAuthLoaded, isLoading, isSaving, isUploadingAvatar, userId]);

  const handleRemoveAvatar = useCallback(() => {
    if (isUploadingAvatar || isSaving || isLoading) {
      return;
    }

    setForm((previous) => ({
      ...previous,
      avatarUrl: '',
    }));
    setSyncStatus('idle');
    setSuccessMessage('Profile photo removed. Tap Save Profile to keep this change.');
  }, [isLoading, isSaving, isUploadingAvatar]);

  const handleSaveProfile = useCallback(async (options?: SaveProfileOptions) => {
    const shouldRefresh = options?.refresh ?? true;
    const silent = options?.silent ?? false;

    if (!isAuthLoaded || isSaving || isUploadingAvatar || !userId) {
      return;
    }

    const currentSignature = profileSignature(form);
    if (silent && currentSignature === lastSavedSignatureRef.current) {
      setSyncStatus('synced');
      return;
    }

    const normalizedName = form.displayName.trim();
    if (normalizedName.length < 2) {
      setErrorMessage('Display name should be at least 2 characters.');
      setSuccessMessage('');
      return;
    }

    const yearInput = form.yearOfStudy.trim();
    let normalizedYear: number | null = null;

    if (yearInput) {
      const parsed = Number(yearInput);
      const rounded = Math.round(parsed);

      if (!Number.isFinite(parsed) || String(rounded) !== yearInput || rounded < 1 || rounded > 8) {
        setErrorMessage('Year of study should be a number between 1 and 8.');
        setSuccessMessage('');
        return;
      }

      normalizedYear = rounded;
    }

    setIsSaving(true);
    setSyncStatus('saving');
    setErrorMessage('');
    if (!silent) {
      setSuccessMessage('');
    }

    try {
      const payload = {
        display_name: normalizedName,
        campus_name: readText(form.campusName) || null,
        department: readText(form.department) || null,
        year_of_study: normalizedYear !== null ? String(normalizedYear) : '',
        phone: readText(form.phone) || null,
        bio: readText(form.bio) || null,
        avatar_url: readText(form.avatarUrl) || null,
        notify_claim_updates: form.notifyClaimUpdates,
        notify_messages: form.notifyMessages,
        public_profile: form.publicProfile,
      };

      const response = await authedProfileRequest(
        '/api/profile/me',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        'Profile save timed out. Try again.',
      );

      if (response.status === 404) {
        lastSavedSignatureRef.current = currentSignature;
        setSyncStatus('idle');

        if (!silent) {
          setSuccessMessage('Saved locally. Deploy latest backend to enable server profile sync.');
        }

        return;
      }

      if (!response.ok) {
        throw new Error(await readResponseError(response, 'Could not save profile right now.'));
      }

      lastSavedSignatureRef.current = currentSignature;
      setSyncStatus('synced');

      if (!silent) {
        setSuccessMessage('Profile saved successfully.');
      }

      if (shouldRefresh) {
        await loadProfileData({ soft: true });
      }
    } catch (error) {
      const message = normalizeProfileErrorMessage(error, 'Could not save profile right now.');

      setErrorMessage(message);
      setSyncStatus('error');

      if (!silent) {
        setSuccessMessage('');
      }
    } finally {
      setIsSaving(false);
    }
  }, [authedProfileRequest, form, isAuthLoaded, isSaving, isUploadingAvatar, loadProfileData, userId]);

  const handleDiscardProfileChanges = useCallback(async () => {
    if (isSaving || isUploadingAvatar || isLoading) {
      return;
    }

    setErrorMessage('');
    setSuccessMessage('Reverted pending edits.');
    setSyncStatus('saving');

    try {
      await loadProfileData({ soft: true });
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  }, [isLoading, isSaving, isUploadingAvatar, loadProfileData]);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  const avatarPreviewUrl = useMemo(
    () => readText(form.avatarUrl) || readText(user?.imageUrl),
    [form.avatarUrl, user?.imageUrl],
  );

  const profileIdentityLabel = useMemo(() => {
    return userPrimaryEmail || 'No email available';
  }, [userPrimaryEmail]);

  const shortUserId = useMemo(() => {
    if (!userId) {
      return 'Not available';
    }

    if (userId.length <= 14) {
      return userId;
    }

    return `${userId.slice(0, 8)}...${userId.slice(-4)}`;
  }, [userId]);

  const profileCompletion = useMemo(() => {
    const checks = [
      form.displayName,
      form.campusName,
      form.department,
      form.yearOfStudy,
      form.phone,
      form.bio,
      form.avatarUrl,
    ];

    const completeCount = checks.filter((value) => readText(value).length > 0).length;
    return Math.round((completeCount / checks.length) * 100);
  }, [
    form.avatarUrl,
    form.bio,
    form.campusName,
    form.department,
    form.displayName,
    form.phone,
    form.yearOfStudy,
  ]);

  const profileCompletionHint = useMemo(() => {
    if (profileCompletion >= 100) {
      return 'Profile complete. Great work keeping your account up to date.';
    }

    if (profileCompletion >= 70) {
      return 'Almost there. Add one or two details to complete your profile.';
    }

    return 'Complete your profile to improve trust and claim success.';
  }, [profileCompletion]);

  const hasPendingChanges = useMemo(() => {
    return profileSignature(form) !== lastSavedSignatureRef.current;
  }, [form]);

  const syncStatusMeta = useMemo(() => {
    if (syncStatus === 'saving') {
      return {
        icon: 'sync' as keyof typeof MaterialIcons.glyphMap,
        label: 'Saving changes...',
        color: colors.primary,
      };
    }

    if (syncStatus === 'synced') {
      return {
        icon: 'check-circle-outline' as keyof typeof MaterialIcons.glyphMap,
        label: 'All changes saved',
        color: colors.success,
      };
    }

    if (syncStatus === 'error') {
      return {
        icon: 'error-outline' as keyof typeof MaterialIcons.glyphMap,
        label: 'Sync paused',
        color: colors.error,
      };
    }

    return {
      icon: 'edit' as keyof typeof MaterialIcons.glyphMap,
      label: 'Manual save mode',
      color: colors.onSurfaceVariant,
    };
  }, [syncStatus]);

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
        <View style={styles.heroCard}>
          <View style={styles.avatarFrame}>
            {avatarPreviewUrl ? (
              <Image source={{ uri: avatarPreviewUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <MaterialIcons color={colors.onPrimary} name="person" size={42} />
              </View>
            )}
          </View>

          <View style={styles.heroContent}>
            <Text numberOfLines={1} style={styles.heroTitle}>
              {form.displayName || 'Campus User'}
            </Text>
            <Text numberOfLines={1} style={styles.heroSubtitle}>
              {profileIdentityLabel}
            </Text>
            <Text numberOfLines={1} style={styles.memberIdText}>
              Member ID: {shortUserId}
            </Text>

            <View style={styles.heroChipsRow}>
              <View style={styles.heroChip}>
                <MaterialIcons color={colors.primary} name="workspace-premium" size={14} />
                <Text style={styles.heroChipText}>{stats.level}</Text>
              </View>
              <View style={styles.heroChip}>
                <MaterialIcons color={colors.primary} name="stars" size={14} />
                <Text style={styles.heroChipText}>{stats.totalPoints} pts</Text>
              </View>
            </View>

            <Text style={styles.lastActivityText}>Last activity: {formatTimeAgo(lastActivityAt)}</Text>
          </View>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Progress Overview</Text>
          <Text style={styles.sectionCaption}>Live profile metrics</Text>
        </View>

        <View style={styles.statsGrid}>
          {[
            { label: 'Reported', value: stats.itemsReported, icon: 'assignment-turned-in' },
            { label: 'Claims', value: stats.claimsSubmitted, icon: 'fact-check' },
            { label: 'In Progress', value: stats.claimsInProgress, icon: 'hourglass-top', wide: true },
            { label: 'Approved', value: stats.claimsApproved, icon: 'verified' },
            { label: 'Picked Up', value: stats.claimsPickedUp, icon: 'done-all' },
          ].map((item) => (
            <View key={item.label} style={[styles.statCard, item.wide ? styles.statCardWide : undefined]}>
              <MaterialIcons
                color={colors.primary}
                name={item.icon as keyof typeof MaterialIcons.glyphMap}
                size={20}
              />
              <Text style={styles.statValue}>{item.value}</Text>
              <Text style={styles.statLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.completionCard}>
          <View style={styles.completionHeaderRow}>
            <Text style={styles.completionTitle}>Profile Completion</Text>
            <Text style={styles.completionPercent}>{profileCompletion}%</Text>
          </View>
          <View style={styles.completionTrack}>
            <View style={[styles.completionFill, { width: `${profileCompletion}%` }]} />
          </View>
          <Text style={styles.completionHint}>{profileCompletionHint}</Text>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <Text style={styles.sectionCaption}>Fast navigation</Text>
        </View>

        <View style={styles.quickActionsGrid}>
          <Pressable onPress={() => navigation.navigate('Report')} style={styles.quickActionCard}>
            <MaterialIcons color={colors.primary} name="add-circle-outline" size={18} />
            <Text style={styles.quickActionLabel}>Report</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate('History')} style={styles.quickActionCard}>
            <MaterialIcons color={colors.primary} name="history" size={18} />
            <Text style={styles.quickActionLabel}>History</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Map')} style={styles.quickActionCard}>
            <MaterialIcons color={colors.primary} name="map" size={18} />
            <Text style={styles.quickActionLabel}>Map</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Settings')} style={styles.quickActionCard}>
            <MaterialIcons color={colors.primary} name="settings" size={18} />
            <Text style={styles.quickActionLabel}>Settings</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loaderCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loaderText}>Loading your profile...</Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Edit Profile</Text>
              <Text style={styles.sectionCaption}>Manual save only</Text>
            </View>

            <View style={styles.formCard}>
              <View style={styles.syncStatusRow}>
                <MaterialIcons color={syncStatusMeta.color} name={syncStatusMeta.icon} size={16} />
                <Text style={[styles.syncStatusText, { color: syncStatusMeta.color }]}>
                  {syncStatusMeta.label}
                </Text>
              </View>

              <View style={styles.formUtilityRow}>
                <Text style={styles.formUtilityText}>
                  {hasPendingChanges ? 'Unsaved local edits detected' : 'No local edits pending'}
                </Text>
                <Pressable
                  disabled={!hasPendingChanges || isSaving || isUploadingAvatar || isLoading}
                  onPress={handleDiscardProfileChanges}
                  style={[
                    styles.discardChangesButton,
                    !hasPendingChanges || isSaving || isUploadingAvatar || isLoading
                      ? styles.avatarActionDisabled
                      : undefined,
                  ]}
                >
                  <MaterialIcons color={colors.primary} name="restart-alt" size={16} />
                  <Text style={styles.discardChangesText}>Discard</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Display Name</Text>
              <TextInput
                onChangeText={(value) => handleFieldChange('displayName', value)}
                placeholder="Your full name"
                placeholderTextColor={colors.outline}
                style={styles.fieldInput}
                value={form.displayName}
              />

              <Text style={styles.fieldLabel}>Email (Read-only)</Text>
              <View style={styles.readOnlyField}>
                <MaterialIcons color={colors.outline} name="lock" size={16} />
                <Text numberOfLines={1} style={styles.readOnlyFieldText}>
                  {profileIdentityLabel}
                </Text>
              </View>
              <Text style={styles.readOnlyHint}>
                Email is managed by your sign-in account and cannot be edited here.
              </Text>

              <Text style={styles.fieldLabel}>Campus</Text>
              <TextInput
                onChangeText={(value) => handleFieldChange('campusName', value)}
                placeholder="Campus name"
                placeholderTextColor={colors.outline}
                style={styles.fieldInput}
                value={form.campusName}
              />

              <View style={styles.inlineFieldsRow}>
                <View style={styles.inlineFieldWrap}>
                  <Text style={styles.fieldLabel}>Department</Text>
                  <TextInput
                    onChangeText={(value) => handleFieldChange('department', value)}
                    placeholder="Department"
                    placeholderTextColor={colors.outline}
                    style={styles.fieldInput}
                    value={form.department}
                  />
                </View>

                <View style={styles.inlineFieldWrapSmall}>
                  <Text style={styles.fieldLabel}>Year</Text>
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={(value) =>
                      handleFieldChange('yearOfStudy', value.replace(/[^0-9]/g, ''))
                    }
                    placeholder="1-8"
                    placeholderTextColor={colors.outline}
                    style={styles.fieldInput}
                    value={form.yearOfStudy}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                keyboardType="phone-pad"
                onChangeText={(value) => handleFieldChange('phone', value)}
                placeholder="Phone number"
                placeholderTextColor={colors.outline}
                style={styles.fieldInput}
                value={form.phone}
              />

              <Text style={styles.fieldLabel}>Profile Photo</Text>
              <View style={styles.readOnlyField}>
                <MaterialIcons color={colors.outline} name="lock" size={16} />
                <Text numberOfLines={1} style={styles.readOnlyFieldText}>
                  {form.avatarUrl ? 'Uploaded profile photo' : 'No profile photo uploaded'}
                </Text>
              </View>
              <Text style={styles.readOnlyHint}>Avatar URL is locked and managed by image upload.</Text>

              <View style={styles.avatarActionsRow}>
                <Pressable
                  disabled={isUploadingAvatar || isSaving || isLoading}
                  onPress={handleUploadAvatar}
                  style={[
                    styles.avatarUploadButton,
                    isUploadingAvatar || isSaving || isLoading ? styles.avatarActionDisabled : undefined,
                  ]}
                >
                  {isUploadingAvatar ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <>
                      <MaterialIcons color={colors.onPrimary} name="file-upload" size={16} />
                      <Text style={styles.avatarUploadButtonText}>
                        {form.avatarUrl ? 'Change Photo' : 'Upload Photo'}
                      </Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  disabled={!form.avatarUrl || isUploadingAvatar || isSaving || isLoading}
                  onPress={handleRemoveAvatar}
                  style={[
                    styles.avatarRemoveButton,
                    !form.avatarUrl || isUploadingAvatar || isSaving || isLoading
                      ? styles.avatarActionDisabled
                      : undefined,
                  ]}
                >
                  <MaterialIcons color={colors.primary} name="delete-outline" size={16} />
                  <Text style={styles.avatarRemoveButtonText}>Remove</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Bio</Text>
              <TextInput
                multiline
                onChangeText={(value) => handleFieldChange('bio', value)}
                placeholder="Tell your campus community about yourself"
                placeholderTextColor={colors.outline}
                style={styles.bioInput}
                value={form.bio}
              />

              <Pressable
                disabled={isSaving || isUploadingAvatar || isLoading}
                onPress={() => handleToggle('notifyClaimUpdates')}
                style={[
                  styles.toggleRow,
                  isSaving || isUploadingAvatar || isLoading ? styles.toggleRowDisabled : undefined,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Claim Updates</Text>
                  <Text style={styles.toggleSubtitle}>
                    Get notified when your claim status changes.
                  </Text>
                </View>
                <MaterialIcons
                  color={form.notifyClaimUpdates ? colors.primary : colors.outline}
                  name={form.notifyClaimUpdates ? 'toggle-on' : 'toggle-off'}
                  size={36}
                />
              </Pressable>

              <Pressable
                disabled={isSaving || isUploadingAvatar || isLoading}
                onPress={() => handleToggle('notifyMessages')}
                style={[
                  styles.toggleRow,
                  isSaving || isUploadingAvatar || isLoading ? styles.toggleRowDisabled : undefined,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Messages</Text>
                  <Text style={styles.toggleSubtitle}>Receive alerts for claim chat messages.</Text>
                </View>
                <MaterialIcons
                  color={form.notifyMessages ? colors.primary : colors.outline}
                  name={form.notifyMessages ? 'toggle-on' : 'toggle-off'}
                  size={36}
                />
              </Pressable>

              <Pressable
                disabled={isSaving || isUploadingAvatar || isLoading}
                onPress={() => handleToggle('publicProfile')}
                style={[
                  styles.toggleRow,
                  isSaving || isUploadingAvatar || isLoading ? styles.toggleRowDisabled : undefined,
                ]}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Public Profile</Text>
                  <Text style={styles.toggleSubtitle}>
                    Allow your profile details to be visible to other users.
                  </Text>
                </View>
                <MaterialIcons
                  color={form.publicProfile ? colors.primary : colors.outline}
                  name={form.publicProfile ? 'toggle-on' : 'toggle-off'}
                  size={36}
                />
              </Pressable>

              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
              {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

              <Pressable
                disabled={isSaving || isUploadingAvatar || isLoading}
                onPress={() => void handleSaveProfile({ refresh: true, silent: false })}
                style={[
                  styles.saveButton,
                  isSaving || isUploadingAvatar || isLoading ? styles.saveButtonDisabled : undefined,
                ]}
              >
                {isSaving || isUploadingAvatar ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <>
                    <MaterialIcons color={colors.onPrimary} name="save" size={18} />
                    <Text style={styles.saveButtonText}>Save Profile</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <Text style={styles.sectionCaption}>Points and achievements</Text>
            </View>

            <View style={styles.activityCard}>
              {activityItems.length ? (
                activityItems.map((item) => (
                  <View key={item.id} style={styles.activityRow}>
                    <View style={styles.activityMeta}>
                      <Text style={styles.activityReason}>{item.reason}</Text>
                      <Text style={styles.activityTime}>{formatTimeAgo(item.createdAt)}</Text>
                    </View>
                    <Text
                      style={[
                        styles.activityPoints,
                        item.points >= 0 ? styles.activityPointsPositive : styles.activityPointsNegative,
                      ]}
                    >
                      {item.points >= 0 ? `+${item.points}` : `${item.points}`}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.activityEmptyText}>
                  No activity yet. Submit a claim or report an item to earn points.
                </Text>
              )}
            </View>
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
    paddingBottom: 30,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  heroCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.14)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 16,
    padding: 16,
  },
  avatarFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarImage: {
    borderRadius: 44,
    height: 88,
    width: 88,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 44,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  heroContent: {
    flex: 1,
  },
  heroTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 22,
    marginBottom: 2,
  },
  heroSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginBottom: 4,
  },
  memberIdText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginBottom: 10,
  },
  heroChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  heroChip: {
    alignItems: 'center',
    backgroundColor: '#E9EEFF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroChipText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  lastActivityText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  sectionCaption: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  quickActionCard: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: '#F5F7FF',
    borderColor: 'rgba(0, 6, 102, 0.12)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    minWidth: '47%',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  quickActionLabel: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
  statCard: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    minWidth: '47%',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  statCardWide: {
    minWidth: '100%',
  },
  statValue: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 22,
    marginTop: 4,
  },
  statLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 2,
  },
  completionCard: {
    ...shadows.soft,
    backgroundColor: '#EEF1FF',
    borderRadius: radii.lg,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  completionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  completionTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
  },
  completionPercent: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 15,
  },
  completionTrack: {
    backgroundColor: 'rgba(0, 6, 102, 0.15)',
    borderRadius: radii.pill,
    height: 8,
    overflow: 'hidden',
  },
  completionFill: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: 8,
  },
  completionHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  loaderCard: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginBottom: 14,
    padding: 20,
  },
  loaderText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginTop: 10,
  },
  formCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.12)',
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  syncStatusRow: {
    alignItems: 'center',
    backgroundColor: '#F7F9FF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncStatusText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  formUtilityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  formUtilityText: {
    color: colors.onSurfaceVariant,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginRight: 8,
  },
  discardChangesButton: {
    alignItems: 'center',
    backgroundColor: '#E9EEFF',
    borderColor: 'rgba(0, 6, 102, 0.14)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  discardChangesText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  fieldLabel: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: colors.surfaceHighest,
    borderColor: 'rgba(118, 118, 131, 0.22)',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    marginBottom: 12,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  readOnlyField: {
    alignItems: 'center',
    backgroundColor: '#F1F2F4',
    borderColor: 'rgba(118, 118, 131, 0.22)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  readOnlyFieldText: {
    color: colors.onSurfaceVariant,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    marginLeft: 8,
  },
  readOnlyHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginBottom: 12,
  },
  avatarActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  avatarUploadButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  avatarUploadButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
  avatarRemoveButton: {
    alignItems: 'center',
    backgroundColor: '#E9EEFF',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(0, 6, 102, 0.15)',
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  avatarRemoveButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 4,
  },
  avatarActionDisabled: {
    opacity: 0.55,
  },
  inlineFieldsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineFieldWrap: {
    flex: 1,
  },
  inlineFieldWrapSmall: {
    width: 96,
  },
  bioInput: {
    backgroundColor: colors.surfaceHighest,
    borderColor: 'rgba(118, 118, 131, 0.22)',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    marginBottom: 12,
    minHeight: 90,
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: '#F3F5FF',
    borderRadius: radii.md,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  saveButtonDisabled: {
    opacity: 0.72,
  },
  saveButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 15,
    marginLeft: 6,
  },
  activityCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.12)',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  activityRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(118, 118, 131, 0.12)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  activityMeta: {
    flex: 1,
    marginRight: 10,
  },
  activityReason: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  activityTime: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 2,
  },
  activityPoints: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
  },
  activityPointsPositive: {
    color: colors.success,
  },
  activityPointsNegative: {
    color: colors.error,
  },
  activityEmptyText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8,
  },
  signOutButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 6, 102, 0.08)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 10,
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
