import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { isAdminEmail } from '../config/admin';
import { backendEnv } from '../config/env';
import { fontFamily, radii, shadows } from '../theme/tokens';

const REQUEST_TIMEOUT_MS = 15000;
const LIVE_SYNC_INTERVAL_MS = 20000;
const WIDGET_PREFERENCES_STORAGE_KEY = 'admin-dashboard-widget-preferences-v2';

const REQUEST_STATUSES = ['submitted', 'approved', 'rejected', 'picked_up', 'cancelled'] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];
type RequestStatusFilter = 'all' | RequestStatus;

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
  Report: undefined;
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

type DashboardPalette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  inputBackground: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  warning: string;
  error: string;
  live: string;
  heroGradient: [string, string, ...string[]];
};

type WidgetKey =
  | 'overview'
  | 'analytics'
  | 'insights'
  | 'alerts'
  | 'activity'
  | 'broadcast'
  | 'foundModeration'
  | 'requestModeration';

type WidgetPreferences = Record<WidgetKey, boolean>;

type ActivityTone = 'neutral' | 'success' | 'warning' | 'danger';

type ActivityEvent = {
  id: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  detail: string;
  createdAt: number;
  tone: ActivityTone;
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

const DEFAULT_WIDGET_PREFERENCES: WidgetPreferences = {
  overview: true,
  analytics: true,
  insights: true,
  alerts: true,
  activity: true,
  broadcast: true,
  foundModeration: true,
  requestModeration: true,
};

const WIDGET_LIBRARY: Array<{ key: WidgetKey; label: string; icon: keyof typeof MaterialIcons.glyphMap }> = [
  { key: 'overview', label: 'Overview', icon: 'grid-view' },
  { key: 'analytics', label: 'Analytics', icon: 'query-stats' },
  { key: 'insights', label: 'Insights', icon: 'psychology' },
  { key: 'alerts', label: 'Smart Alerts', icon: 'notifications-active' },
  { key: 'activity', label: 'Activity', icon: 'history' },
  { key: 'broadcast', label: 'Broadcast', icon: 'campaign' },
  { key: 'foundModeration', label: 'Found Items', icon: 'inventory-2' },
  { key: 'requestModeration', label: 'Requests', icon: 'rule' },
];

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

function readDateMs(value: unknown): number {
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatRelativeTime(input: string | number): string {
  const timestamp = readDateMs(input);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
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

function formatStatusLabel(status: string): string {
  const normalized = readText(status).toLowerCase();
  return normalized ? normalized.replace(/_/g, ' ') : 'submitted';
}

function formatCompactNumber(value: number): string {
  const rounded = Math.max(0, Math.round(readNumber(value)));
  if (rounded >= 1000000) {
    return `${(rounded / 1000000).toFixed(1)}m`;
  }

  if (rounded >= 1000) {
    return `${(rounded / 1000).toFixed(1)}k`;
  }

  return String(rounded);
}

function isOlderThanHours(input: string, hours: number): boolean {
  const timestamp = readDateMs(input);
  if (!Number.isFinite(timestamp) || hours <= 0) {
    return false;
  }

  return Date.now() - timestamp >= hours * 60 * 60 * 1000;
}

function createDashboardPalette(isDarkMode: boolean): DashboardPalette {
  if (isDarkMode) {
    return {
      background: '#0A0F1E',
      surface: '#131B2E',
      surfaceAlt: '#1A243A',
      border: '#2B3A58',
      borderStrong: '#335188',
      textPrimary: '#E8EEFF',
      textSecondary: '#B8C6E6',
      textMuted: '#8EA0C7',
      inputBackground: '#18233A',
      primary: '#78A5FF',
      primarySoft: '#1B315C',
      onPrimary: '#06152F',
      success: '#34D399',
      warning: '#FBBF24',
      error: '#F87171',
      live: '#4ADE80',
      heroGradient: ['#132349', '#1D3E7D', '#25538F'],
    };
  }

  return {
    background: '#F2F6FF',
    surface: '#FFFFFF',
    surfaceAlt: '#F8FAFE',
    border: '#D9E4FB',
    borderStrong: '#B2CBF8',
    textPrimary: '#0E1A35',
    textSecondary: '#334669',
    textMuted: '#5C6D8A',
    inputBackground: '#F4F7FF',
    primary: '#1E4ED8',
    primarySoft: '#E7F0FF',
    onPrimary: '#FFFFFF',
    success: '#16A34A',
    warning: '#CA8A04',
    error: '#DC2626',
    live: '#16A34A',
    heroGradient: ['#E8F0FF', '#D9E8FF', '#CFE0FF'],
  };
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
  const { width: windowWidth } = useWindowDimensions();
  const systemColorScheme = useColorScheme();

  const getTokenRef = useRef(getToken);
  const introOpacity = useRef(new Animated.Value(0)).current;
  const introTranslate = useRef(new Animated.Value(20)).current;
  const livePulse = useRef(new Animated.Value(1)).current;
  const previousCountsRef = useRef<AdminCounts | null>(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(introTranslate, {
        toValue: 0,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [introOpacity, introTranslate]);

  const userEmail =
    readText(user?.primaryEmailAddress?.emailAddress) ||
    readText(user?.emailAddresses?.[0]?.emailAddress);

  const hasAdminAccess = isAdminEmail(userEmail);
  const backendBaseUrl = useMemo(() => backendEnv.backendUrl.replace(/\/+$/, ''), []);
  const isWideLayout = windowWidth >= 900;
  const isTabletLayout = windowWidth >= 720;

  const [isDarkMode, setIsDarkMode] = useState(systemColorScheme === 'dark');
  const [isLiveSyncEnabled, setIsLiveSyncEnabled] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);

  const [counts, setCounts] = useState<AdminCounts>(DEFAULT_COUNTS);
  const [recentFoundItems, setRecentFoundItems] = useState<AdminFoundItem[]>([]);
  const [recentRequests, setRecentRequests] = useState<AdminRequestRow[]>([]);
  const [pushTableReady, setPushTableReady] = useState(true);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [noticeText, setNoticeText] = useState('');

  const [globalSearch, setGlobalSearch] = useState('');
  const deferredGlobalSearch = useDeferredValue(globalSearch);

  const [isWidgetPanelOpen, setIsWidgetPanelOpen] = useState(false);
  const [widgetPreferences, setWidgetPreferences] = useState<WidgetPreferences>(DEFAULT_WIDGET_PREFERENCES);

  const [analyticsRange, setAnalyticsRange] = useState<'7d' | '30d'>('7d');
  const [requestStatusFilter, setRequestStatusFilter] = useState<RequestStatusFilter>('all');

  const [broadcastTitle, setBroadcastTitle] = useState('UniSync Admin Notice');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastTargetUserId, setBroadcastTargetUserId] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const [foundItemQuery, setFoundItemQuery] = useState('');
  const [showStaleFoundItemsOnly, setShowStaleFoundItemsOnly] = useState(false);
  const [removingItemId, setRemovingItemId] = useState('');

  const [requestQuery, setRequestQuery] = useState('');
  const [updatingRequestId, setUpdatingRequestId] = useState('');

  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);

  const palette = useMemo(() => createDashboardPalette(isDarkMode), [isDarkMode]);

  const statusColors = useMemo(
    () => ({
      submitted: isDarkMode ? '#FBBF24' : '#D97706',
      approved: isDarkMode ? '#4ADE80' : '#15803D',
      rejected: isDarkMode ? '#F87171' : '#DC2626',
      picked_up: isDarkMode ? '#60A5FA' : '#2563EB',
      cancelled: isDarkMode ? '#A78BFA' : '#7C3AED',
    }),
    [isDarkMode],
  );

  const toneColors = useMemo(
    () => ({
      neutral: palette.primary,
      success: palette.success,
      warning: palette.warning,
      danger: palette.error,
    }),
    [palette.error, palette.primary, palette.success, palette.warning],
  );

  const appendActivity = useCallback(
    (
      title: string,
      detail: string,
      options?: {
        icon?: keyof typeof MaterialIcons.glyphMap;
        tone?: ActivityTone;
      },
    ) => {
      setActivityFeed((previous) => {
        const nextEvent: ActivityEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          icon: options?.icon ?? 'timeline',
          title,
          detail,
          createdAt: Date.now(),
          tone: options?.tone ?? 'neutral',
        };

        return [nextEvent, ...previous].slice(0, 24);
      });
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    const loadWidgetPreferences = async () => {
      try {
        const raw = await AsyncStorage.getItem(WIDGET_PREFERENCES_STORAGE_KEY);
        if (!isMounted || !raw) {
          return;
        }

        const parsed = JSON.parse(raw) as Partial<WidgetPreferences>;
        const sanitized = Object.entries(DEFAULT_WIDGET_PREFERENCES).reduce<WidgetPreferences>(
          (accumulator, [key, defaultValue]) => {
            const typedKey = key as WidgetKey;
            const candidate = parsed?.[typedKey];
            accumulator[typedKey] = typeof candidate === 'boolean' ? candidate : defaultValue;
            return accumulator;
          },
          { ...DEFAULT_WIDGET_PREFERENCES },
        );

        setWidgetPreferences(sanitized);
      } catch {
        // Ignore corrupted preference payloads and continue with defaults.
      }
    };

    void loadWidgetPreferences();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(WIDGET_PREFERENCES_STORAGE_KEY, JSON.stringify(widgetPreferences)).catch(() => undefined);
  }, [widgetPreferences]);

  useEffect(() => {
    if (!isLiveSyncEnabled) {
      livePulse.stopAnimation();
      livePulse.setValue(1);
      return;
    }

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, {
          toValue: 1.18,
          duration: 760,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(livePulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
    };
  }, [isLiveSyncEnabled, livePulse]);

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
    async (options?: { soft?: boolean; reason?: 'initial' | 'manual' | 'live-sync' | 'resume' }) => {
      const soft = options?.soft ?? false;
      const reason = options?.reason ?? 'manual';
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
          pushTableReady?: unknown;
        };

        const nextCounts = payload.counts ?? {};
        const normalizedCounts: AdminCounts = {
          users: Math.max(0, Math.round(readNumber(nextCounts.users))),
          foundItems: Math.max(0, Math.round(readNumber(nextCounts.foundItems))),
          claims: Math.max(0, Math.round(readNumber(nextCounts.claims))),
          submittedClaims: Math.max(0, Math.round(readNumber(nextCounts.submittedClaims))),
          approvedClaims: Math.max(0, Math.round(readNumber(nextCounts.approvedClaims))),
          pickedUpClaims: Math.max(0, Math.round(readNumber(nextCounts.pickedUpClaims))),
          rejectedClaims: Math.max(0, Math.round(readNumber(nextCounts.rejectedClaims))),
          activePushDevices: Math.max(0, Math.round(readNumber(nextCounts.activePushDevices))),
        };

        const foundRows = Array.isArray(payload.recentFoundItems) ? payload.recentFoundItems : [];
        const requestRows = Array.isArray(payload.recentRequests) ? payload.recentRequests : [];

        const normalizedFoundItems: AdminFoundItem[] = foundRows.map((row, index) => ({
          id: readText(row.id) || `found-${index}`,
          title: readText(row.title) || 'Found item',
          category: readText(row.category) || 'General',
          location: readText(row.location) || 'Campus location',
          createdAt: readText(row.created_at),
          createdBy: readText(row.created_by),
        }));

        const normalizedRequests: AdminRequestRow[] = requestRows.map((row, index) => {
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
        });

        setCounts(normalizedCounts);
        setRecentFoundItems(normalizedFoundItems);
        setRecentRequests(normalizedRequests);
        setPushTableReady(Boolean(payload.pushTableReady ?? true));
        setLastSyncedAt(Date.now());

        const previousCounts = previousCountsRef.current;
        if (previousCounts) {
          const changes: string[] = [];

          if (previousCounts.submittedClaims !== normalizedCounts.submittedClaims) {
            changes.push(`submitted ${previousCounts.submittedClaims} -> ${normalizedCounts.submittedClaims}`);
          }

          if (previousCounts.approvedClaims !== normalizedCounts.approvedClaims) {
            changes.push(`approved ${previousCounts.approvedClaims} -> ${normalizedCounts.approvedClaims}`);
          }

          if (previousCounts.foundItems !== normalizedCounts.foundItems) {
            changes.push(`found items ${previousCounts.foundItems} -> ${normalizedCounts.foundItems}`);
          }

          if ((reason === 'live-sync' || reason === 'resume') && changes.length) {
            appendActivity('Live sync update', changes.join(' | '), {
              icon: 'sync',
              tone: 'neutral',
            });
          }
        } else if (reason === 'initial') {
          appendActivity('Dashboard ready', 'Overview and moderation data loaded.', {
            icon: 'rocket-launch',
            tone: 'success',
          });
        }

        previousCountsRef.current = normalizedCounts;
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Could not load admin overview.';

        setErrorText(message);

        appendActivity('Sync issue', message, {
          icon: 'error-outline',
          tone: 'danger',
        });
      } finally {
        if (!soft) {
          setIsLoading(false);
        }
      }
    },
    [appendActivity, authedAdminRequest, hasAdminAccess],
  );

  useEffect(() => {
    void loadAdminOverview({ reason: 'initial' });
  }, [loadAdminOverview]);

  useEffect(() => {
    if (!hasAdminAccess || !isLiveSyncEnabled) {
      return;
    }

    const runLiveSync = () => {
      if (AppState.currentState === 'active') {
        void loadAdminOverview({ soft: true, reason: 'live-sync' });
      }
    };

    const intervalId = setInterval(runLiveSync, LIVE_SYNC_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void loadAdminOverview({ soft: true, reason: 'resume' });
      }
    });

    return () => {
      clearInterval(intervalId);
      appStateSubscription.remove();
    };
  }, [hasAdminAccess, isLiveSyncEnabled, loadAdminOverview]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setNoticeText('');
    try {
      await loadAdminOverview({ soft: true, reason: 'manual' });
      setNoticeText('Dashboard refreshed successfully.');
      appendActivity('Manual refresh', 'Dashboard data refreshed on demand.', {
        icon: 'refresh',
        tone: 'success',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [appendActivity, loadAdminOverview]);

  const staleFoundItemsCount = useMemo(
    () => recentFoundItems.filter((item) => isOlderThanHours(item.createdAt, 24)).length,
    [recentFoundItems],
  );

  const requestStatusCounts = useMemo(
    () =>
      recentRequests.reduce<Record<RequestStatus, number>>(
        (accumulator, request) => {
          const normalizedStatus = readText(request.status).toLowerCase();
          if (normalizedStatus === 'submitted') {
            accumulator.submitted += 1;
          } else if (normalizedStatus === 'approved') {
            accumulator.approved += 1;
          } else if (normalizedStatus === 'rejected') {
            accumulator.rejected += 1;
          } else if (normalizedStatus === 'picked_up') {
            accumulator.picked_up += 1;
          } else if (normalizedStatus === 'cancelled') {
            accumulator.cancelled += 1;
          }

          return accumulator;
        },
        {
          submitted: 0,
          approved: 0,
          rejected: 0,
          picked_up: 0,
          cancelled: 0,
        },
      ),
    [recentRequests],
  );

  const requestFilterOptions = useMemo(
    () => [
      {
        key: 'all' as RequestStatusFilter,
        label: 'all',
        count: recentRequests.length,
      },
      ...REQUEST_STATUSES.map((status) => ({
        key: status as RequestStatusFilter,
        label: formatStatusLabel(status),
        count: requestStatusCounts[status],
      })),
    ],
    [recentRequests.length, requestStatusCounts],
  );

  const filteredFoundItems = useMemo(() => {
    const query = `${deferredGlobalSearch} ${foundItemQuery}`.trim().toLowerCase();

    return recentFoundItems.filter((item) => {
      if (showStaleFoundItemsOnly && !isOlderThanHours(item.createdAt, 24)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [item.id, item.title, item.category, item.location, item.createdBy].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredGlobalSearch, foundItemQuery, recentFoundItems, showStaleFoundItemsOnly]);

  const filteredRequests = useMemo(() => {
    const query = `${deferredGlobalSearch} ${requestQuery}`.trim().toLowerCase();

    return recentRequests.filter((request) => {
      const normalizedStatus = readText(request.status).toLowerCase();

      if (requestStatusFilter !== 'all' && normalizedStatus !== requestStatusFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        request.id,
        request.foundItemId,
        request.claimantUserId,
        request.foundItemTitle,
        request.foundItemLocation,
        normalizedStatus,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [deferredGlobalSearch, recentRequests, requestQuery, requestStatusFilter]);

  const visibleFoundItems = useMemo(() => filteredFoundItems.slice(0, 12), [filteredFoundItems]);
  const visibleRequests = useMemo(() => filteredRequests.slice(0, 14), [filteredRequests]);

  const statusChartRows = useMemo(
    () => [
      {
        key: 'submitted' as RequestStatus,
        label: 'Submitted',
        icon: 'schedule' as keyof typeof MaterialIcons.glyphMap,
        value: counts.submittedClaims,
        color: statusColors.submitted,
      },
      {
        key: 'approved' as RequestStatus,
        label: 'Approved',
        icon: 'verified' as keyof typeof MaterialIcons.glyphMap,
        value: counts.approvedClaims,
        color: statusColors.approved,
      },
      {
        key: 'rejected' as RequestStatus,
        label: 'Rejected',
        icon: 'cancel' as keyof typeof MaterialIcons.glyphMap,
        value: counts.rejectedClaims,
        color: statusColors.rejected,
      },
      {
        key: 'picked_up' as RequestStatus,
        label: 'Picked Up',
        icon: 'task-alt' as keyof typeof MaterialIcons.glyphMap,
        value: counts.pickedUpClaims,
        color: statusColors.picked_up,
      },
      {
        key: 'cancelled' as RequestStatus,
        label: 'Cancelled',
        icon: 'block' as keyof typeof MaterialIcons.glyphMap,
        value: requestStatusCounts.cancelled,
        color: statusColors.cancelled,
      },
    ],
    [counts.approvedClaims, counts.pickedUpClaims, counts.rejectedClaims, counts.submittedClaims, requestStatusCounts.cancelled, statusColors],
  );

  const maxStatusChartValue = useMemo(
    () => Math.max(1, ...statusChartRows.map((row) => row.value)),
    [statusChartRows],
  );

  const trendSeries = useMemo(() => {
    const days = analyticsRange === '7d' ? 7 : 30;
    const today = new Date();
    const keys: string[] = [];
    const counter = new Map<string, number>();

    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      date.setHours(0, 0, 0, 0);
      const key = date.toISOString().slice(0, 10);
      keys.push(key);
      counter.set(key, 0);
    }

    recentRequests.forEach((request) => {
      const timestamp = readDateMs(request.createdAt);
      if (!timestamp) {
        return;
      }

      const date = new Date(timestamp);
      date.setHours(0, 0, 0, 0);
      const key = date.toISOString().slice(0, 10);

      if (!counter.has(key)) {
        return;
      }

      counter.set(key, (counter.get(key) || 0) + 1);
    });

    return keys.map((key) => {
      const date = new Date(`${key}T00:00:00`);
      const label = analyticsRange === '7d' ? date.toLocaleDateString(undefined, { weekday: 'short' }) : key.slice(5);
      return {
        key,
        label,
        value: counter.get(key) || 0,
      };
    });
  }, [analyticsRange, recentRequests]);

  const maxTrendValue = useMemo(
    () => Math.max(1, ...trendSeries.map((point) => point.value)),
    [trendSeries],
  );

  const personalizedInsights = useMemo(() => {
    const approvalRate = counts.claims > 0 ? Math.round((counts.approvedClaims / counts.claims) * 100) : 0;
    const pickupRate = counts.approvedClaims > 0 ? Math.round((counts.pickedUpClaims / counts.approvedClaims) * 100) : 0;
    const backlog = Math.max(0, counts.submittedClaims - counts.approvedClaims - counts.rejectedClaims);

    return [
      {
        id: 'approval-rate',
        icon: 'insights' as keyof typeof MaterialIcons.glyphMap,
        title: 'Approval Conversion',
        value: `${approvalRate}%`,
        detail: `Based on ${counts.claims} total claim request(s).`,
      },
      {
        id: 'pickup-rate',
        icon: 'volunteer-activism' as keyof typeof MaterialIcons.glyphMap,
        title: 'Pickup Completion',
        value: `${pickupRate}%`,
        detail: `Picked up ${counts.pickedUpClaims} of ${counts.approvedClaims} approved requests.`,
      },
      {
        id: 'queue-health',
        icon: 'speed' as keyof typeof MaterialIcons.glyphMap,
        title: 'Queue Health',
        value: backlog > 0 ? `${backlog} pending` : 'Healthy',
        detail: backlog > 0 ? 'Consider prioritizing submitted requests.' : 'Decision pipeline is balanced.',
      },
      {
        id: 'stale-items',
        icon: 'schedule-send' as keyof typeof MaterialIcons.glyphMap,
        title: 'Stale Found Items',
        value: `${staleFoundItemsCount}`,
        detail:
          staleFoundItemsCount > 0
            ? 'Items older than 24 hours need moderation attention.'
            : 'No stale found item entries detected.',
      },
    ];
  }, [counts.approvedClaims, counts.claims, counts.pickedUpClaims, counts.rejectedClaims, counts.submittedClaims, staleFoundItemsCount]);

  const smartAlerts = useMemo(() => {
    const alerts: Array<{
      id: string;
      title: string;
      detail: string;
      icon: keyof typeof MaterialIcons.glyphMap;
      tone: ActivityTone;
    }> = [];

    if (!pushTableReady) {
      alerts.push({
        id: 'push-table',
        title: 'Push token table missing',
        detail: 'Run SQL migration 026 to enable push telemetry and broadcasts.',
        icon: 'warning-amber',
        tone: 'warning',
      });
    }

    if (counts.activePushDevices === 0) {
      alerts.push({
        id: 'no-devices',
        title: 'No active push devices',
        detail: 'Broadcasts will not reach users until devices register again.',
        icon: 'notifications-off',
        tone: 'warning',
      });
    }

    if (counts.submittedClaims >= 8) {
      alerts.push({
        id: 'queue-backlog',
        title: 'High pending queue',
        detail: `${counts.submittedClaims} submitted claims waiting for review.`,
        icon: 'pending-actions',
        tone: 'danger',
      });
    }

    if (staleFoundItemsCount >= 3) {
      alerts.push({
        id: 'stale-found-items',
        title: 'Stale found-item inventory',
        detail: `${staleFoundItemsCount} found item(s) are older than 24 hours.`,
        icon: 'hourglass-bottom',
        tone: 'warning',
      });
    }

    if (!alerts.length) {
      alerts.push({
        id: 'healthy',
        title: 'All systems stable',
        detail: 'Queue, moderation, and notifications currently look healthy.',
        icon: 'verified',
        tone: 'success',
      });
    }

    return alerts;
  }, [counts.activePushDevices, counts.submittedClaims, pushTableReady, staleFoundItemsCount]);

  const toggleWidget = useCallback((key: WidgetKey) => {
    setWidgetPreferences((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  }, []);

  const handlePresetDirectNotification = useCallback(
    (targetUserId: string, contextLabel: string) => {
      const normalizedTarget = readText(targetUserId);
      if (!normalizedTarget) {
        setNoticeText('No user ID found to target this notification.');
        return;
      }

      setBroadcastTargetUserId(normalizedTarget);
      setBroadcastTitle('UniSync Admin Follow-up');
      setBroadcastMessage(`Hi, this is a quick follow-up regarding ${contextLabel}. Please check your claim history.`);
      setNoticeText('Direct notification is prefilled. Review message and press Send Broadcast.');
    },
    [],
  );

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
      const targetUserId = broadcastTargetUserId.trim();

      const response = await authedAdminRequest('/api/admin/notifications/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          title: broadcastTitle.trim() || 'UniSync Admin Notice',
          message: broadcastMessage.trim(),
          ...(targetUserId ? { target_user_id: targetUserId } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response, 'Failed to send broadcast notification.'));
      }

      const payload = (await response.json()) as {
        sent?: unknown;
        recipients?: unknown;
        targetMode?: unknown;
        target_mode?: unknown;
      };

      const sent = Math.max(0, Math.round(readNumber(payload.sent)));
      const recipients = Math.max(0, Math.round(readNumber(payload.recipients)));
      const targetMode = readText(payload.targetMode ?? payload.target_mode);

      if (targetUserId || targetMode === 'single') {
        const message =
          sent > 0
            ? `Direct notification sent to ${sent} active device(s).`
            : 'Direct notification submitted, but no active device received it.';
        setNoticeText(message);
        appendActivity('Direct notification', message, {
          icon: 'send',
          tone: sent > 0 ? 'success' : 'warning',
        });
      } else {
        const message = `Broadcast sent to ${sent} device(s) across ${recipients} account(s).`;
        setNoticeText(message);
        appendActivity('Broadcast notification', message, {
          icon: 'campaign',
          tone: 'success',
        });
      }

      setBroadcastMessage('');
      if (targetUserId) {
        setBroadcastTargetUserId('');
      }
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to send broadcast notification.';

      setErrorText(message);
      appendActivity('Broadcast failure', message, {
        icon: 'error-outline',
        tone: 'danger',
      });
    } finally {
      setIsBroadcasting(false);
    }
  }, [appendActivity, authedAdminRequest, broadcastMessage, broadcastTargetUserId, broadcastTitle, isBroadcasting]);

  const removeFoundItemNow = useCallback(
    async (item: AdminFoundItem) => {
      if (!item.id || removingItemId) {
        return;
      }

      setRemovingItemId(item.id);
      setErrorText('');
      setNoticeText('');

      try {
        const response = await authedAdminRequest(`/api/admin/found-items/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Failed to remove found item.'));
        }

        setRecentFoundItems((previous) => previous.filter((row) => row.id !== item.id));
        const message = `${item.title || 'Found item'} removed successfully.`;
        setNoticeText(message);

        appendActivity('Found item removed', `${item.title || item.id} moderated by admin.`, {
          icon: 'delete-outline',
          tone: 'warning',
        });

        await loadAdminOverview({ soft: true, reason: 'manual' });
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
    [appendActivity, authedAdminRequest, loadAdminOverview, removingItemId],
  );

  const handleRemoveFoundItem = useCallback(
    (item: AdminFoundItem) => {
      if (!item.id || removingItemId) {
        return;
      }

      Alert.alert(
        'Remove found item?',
        `Delete "${item.title || 'this item'}" and all related claim requests? This cannot be undone.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void removeFoundItemNow(item);
            },
          },
        ],
      );
    },
    [removeFoundItemNow, removingItemId],
  );

  const updateRequestStatusNow = useCallback(
    async (request: AdminRequestRow, nextStatus: RequestStatus) => {
      if (!request.id || !nextStatus || updatingRequestId) {
        return;
      }

      setUpdatingRequestId(request.id);
      setErrorText('');
      setNoticeText('');

      try {
        const response = await authedAdminRequest(
          `/api/admin/match-requests/${encodeURIComponent(request.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus }),
          },
        );

        if (!response.ok) {
          throw new Error(await readResponseError(response, 'Failed to update request status.'));
        }

        const message = `Request status updated to ${formatStatusLabel(nextStatus)}.`;
        setNoticeText(message);

        appendActivity('Request status updated', `${request.foundItemTitle || request.id} -> ${formatStatusLabel(nextStatus)}.`, {
          icon: 'rule',
          tone: nextStatus === 'rejected' ? 'warning' : 'success',
        });

        await loadAdminOverview({ soft: true, reason: 'manual' });
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
    [appendActivity, authedAdminRequest, loadAdminOverview, updatingRequestId],
  );

  const handleUpdateRequestStatus = useCallback(
    (request: AdminRequestRow, nextStatus: RequestStatus) => {
      if (!request.id || request.status === nextStatus || updatingRequestId) {
        return;
      }

      const runUpdate = () => {
        void updateRequestStatusNow(request, nextStatus);
      };

      if (nextStatus === 'rejected' || nextStatus === 'cancelled' || nextStatus === 'picked_up') {
        Alert.alert(
          'Confirm status update',
          `Set "${request.foundItemTitle || 'this request'}" to ${formatStatusLabel(nextStatus)}?`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Confirm',
              style: 'destructive',
              onPress: runUpdate,
            },
          ],
        );
        return;
      }

      runUpdate();
    },
    [updateRequestStatusNow, updatingRequestId],
  );

  const handleOpenRequestInHistory = useCallback(
    (requestId: string) => {
      if (!requestId) {
        return;
      }

      navigation.navigate(
        'History',
        {
          focusRequestId: requestId,
          focusNonce: Date.now(),
          autoOpenMessages: true,
        } as AdminNavigationParams['History'],
      );

      appendActivity('Conversation opened', `Jumped to request ${requestId} in History.`, {
        icon: 'forum',
        tone: 'neutral',
      });
    },
    [appendActivity, navigation],
  );

  if (!hasAdminAccess) {
    return (
      <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <AppTopBar
          leftIcon="arrow-back"
          onLeftPress={() => navigation.navigate('Settings')}
          rightIcon="home"
          onRightPress={() => navigation.navigate('Home')}
          title="Admin"
        />

        <View style={styles.deniedWrap}>
          <View style={[styles.deniedCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
            <MaterialIcons color={palette.error} name="lock-outline" size={24} />
            <Text style={[styles.deniedTitle, { color: palette.textPrimary }]}>Admin access denied</Text>
            <Text style={[styles.deniedSubtitle, { color: palette.textSecondary }]}> 
              Signed-in email {userEmail || 'unknown'} is not allowed to open the Admin Dashboard.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: palette.background }]}> 
      <AppTopBar
        leftIcon="arrow-back"
        onLeftPress={() => navigation.navigate('Settings')}
        rightIcon="refresh"
        onRightPress={() => void handleRefresh()}
        title="Admin"
      />

      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: isWideLayout ? 26 : 16,
            paddingBottom: 36,
          },
        ]}
        refreshControl={
          <RefreshControl
            colors={[palette.primary]}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={palette.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={{
            opacity: introOpacity,
            transform: [{ translateY: introTranslate }],
          }}
        >
          <LinearGradient
            colors={palette.heroGradient}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={[styles.heroCard, { borderColor: palette.borderStrong }]}
          >
            <View style={styles.heroHeaderRow}>
              <View style={styles.heroTitleWrap}>
                <Text style={[styles.heroTitle, { color: palette.textPrimary }]}>Command Bridge</Text>
                <Text style={[styles.heroSubtitle, { color: palette.textSecondary }]}>Authorized as {userEmail}</Text>
                <Text style={[styles.heroMeta, { color: palette.textMuted }]}> 
                  {lastSyncedAt > 0 ? `Synced ${formatRelativeTime(lastSyncedAt)}` : 'Waiting for first live sync'}
                </Text>
              </View>

              <View style={styles.heroControlColumn}>
                <Pressable
                  onPress={() => setIsDarkMode((previous) => !previous)}
                  style={[styles.heroToggle, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}
                >
                  <MaterialIcons
                    color={palette.primary}
                    name={isDarkMode ? 'light-mode' : 'dark-mode'}
                    size={16}
                  />
                  <Text style={[styles.heroToggleText, { color: palette.textPrimary }]}>
                    {isDarkMode ? 'Light' : 'Dark'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setIsLiveSyncEnabled((previous) => !previous)}
                  style={[
                    styles.heroToggle,
                    {
                      backgroundColor: isLiveSyncEnabled ? palette.primarySoft : palette.surfaceAlt,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Animated.View
                    style={[
                      styles.liveDot,
                      {
                        backgroundColor: isLiveSyncEnabled ? palette.live : palette.textMuted,
                        transform: [{ scale: livePulse }],
                      },
                    ]}
                  />
                  <Text style={[styles.heroToggleText, { color: palette.textPrimary }]}> 
                    {isLiveSyncEnabled ? 'Live on' : 'Live off'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.quickActionRow}>
              <Pressable
                onPress={() => navigation.navigate('Home')}
                style={[styles.quickAction, { backgroundColor: palette.surface, borderColor: palette.border }]}
              >
                <MaterialIcons color={palette.primary} name="home" size={14} />
                <Text style={[styles.quickActionText, { color: palette.textPrimary }]}>Home</Text>
              </Pressable>

              <Pressable
                onPress={() => navigation.navigate('Report')}
                style={[styles.quickAction, { backgroundColor: palette.surface, borderColor: palette.border }]}
              >
                <MaterialIcons color={palette.primary} name="add-circle-outline" size={14} />
                <Text style={[styles.quickActionText, { color: palette.textPrimary }]}>Report</Text>
              </Pressable>

              <Pressable
                onPress={() => navigation.navigate('History')}
                style={[styles.quickAction, { backgroundColor: palette.surface, borderColor: palette.border }]}
              >
                <MaterialIcons color={palette.primary} name="history" size={14} />
                <Text style={[styles.quickActionText, { color: palette.textPrimary }]}>History</Text>
              </Pressable>

              <Pressable
                onPress={() => navigation.navigate('Settings')}
                style={[styles.quickAction, { backgroundColor: palette.surface, borderColor: palette.border }]}
              >
                <MaterialIcons color={palette.primary} name="settings" size={14} />
                <Text style={[styles.quickActionText, { color: palette.textPrimary }]}>Settings</Text>
              </Pressable>
            </View>
          </LinearGradient>

          <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Workspace</Text>
              <Pressable
                onPress={() => setIsWidgetPanelOpen((previous) => !previous)}
                style={[styles.widgetPanelToggle, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}
              >
                <MaterialIcons
                  color={palette.primary}
                  name={isWidgetPanelOpen ? 'tune' : 'widgets'}
                  size={14}
                />
                <Text style={[styles.widgetPanelToggleText, { color: palette.textPrimary }]}> 
                  {isWidgetPanelOpen ? 'Hide widgets' : 'Customize widgets'}
                </Text>
              </Pressable>
            </View>

            <View style={[styles.searchInputWrap, { backgroundColor: palette.inputBackground, borderColor: palette.border }]}> 
              <MaterialIcons color={palette.textMuted} name="search" size={18} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setGlobalSearch}
                placeholder="Global search across requests, items, users"
                placeholderTextColor={palette.textMuted}
                style={[styles.globalSearchInput, { color: palette.textPrimary }]}
                value={globalSearch}
              />
              {globalSearch ? (
                <Pressable onPress={() => setGlobalSearch('')}>
                  <MaterialIcons color={palette.textMuted} name="close" size={18} />
                </Pressable>
              ) : null}
            </View>

            <Text style={[styles.sectionHint, { color: palette.textSecondary }]}> 
              Optimized for quick triage with live updates, command actions, and widget-level customization.
            </Text>

            {isWidgetPanelOpen ? (
              <View style={styles.widgetGrid}>
                {WIDGET_LIBRARY.map((widget) => {
                  const active = widgetPreferences[widget.key];

                  return (
                    <Pressable
                      key={widget.key}
                      onPress={() => toggleWidget(widget.key)}
                      style={[
                        styles.widgetChip,
                        {
                          backgroundColor: active ? palette.primarySoft : palette.surfaceAlt,
                          borderColor: active ? palette.primary : palette.border,
                        },
                      ]}
                    >
                      <MaterialIcons
                        color={active ? palette.primary : palette.textMuted}
                        name={widget.icon}
                        size={14}
                      />
                      <Text
                        style={[
                          styles.widgetChipText,
                          {
                            color: active ? palette.primary : palette.textSecondary,
                          },
                        ]}
                      >
                        {widget.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {widgetPreferences.overview ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Overview</Text>
                <Text style={[styles.sectionCaption, { color: palette.textMuted }]}>real-time totals</Text>
              </View>

              <View style={styles.statsGrid}>
                {[
                  { label: 'Users', value: counts.users, icon: 'group' as keyof typeof MaterialIcons.glyphMap },
                  {
                    label: 'Found Items',
                    value: counts.foundItems,
                    icon: 'inventory-2' as keyof typeof MaterialIcons.glyphMap,
                  },
                  {
                    label: 'Claims',
                    value: counts.claims,
                    icon: 'fact-check' as keyof typeof MaterialIcons.glyphMap,
                  },
                  {
                    label: 'Submitted',
                    value: counts.submittedClaims,
                    icon: 'schedule' as keyof typeof MaterialIcons.glyphMap,
                  },
                  {
                    label: 'Approved',
                    value: counts.approvedClaims,
                    icon: 'verified' as keyof typeof MaterialIcons.glyphMap,
                  },
                  {
                    label: 'Picked Up',
                    value: counts.pickedUpClaims,
                    icon: 'task-alt' as keyof typeof MaterialIcons.glyphMap,
                  },
                  {
                    label: 'Rejected',
                    value: counts.rejectedClaims,
                    icon: 'cancel' as keyof typeof MaterialIcons.glyphMap,
                  },
                  {
                    label: 'Push Devices',
                    value: counts.activePushDevices,
                    icon: 'notifications-active' as keyof typeof MaterialIcons.glyphMap,
                  },
                ].map((item) => (
                  <View
                    key={item.label}
                    style={[
                      styles.statCard,
                      {
                        width: isTabletLayout ? '24%' : '48.5%',
                        backgroundColor: palette.surfaceAlt,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <MaterialIcons color={palette.primary} name={item.icon} size={18} />
                    <Text style={[styles.statValue, { color: palette.textPrimary }]}>{formatCompactNumber(item.value)}</Text>
                    <Text style={[styles.statLabel, { color: palette.textSecondary }]}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {widgetPreferences.analytics ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Analytics</Text>
                <View style={styles.rangeRow}>
                  {(['7d', '30d'] as const).map((range) => (
                    <Pressable
                      key={range}
                      onPress={() => setAnalyticsRange(range)}
                      style={[
                        styles.rangeChip,
                        {
                          backgroundColor: analyticsRange === range ? palette.primary : palette.surfaceAlt,
                          borderColor: analyticsRange === range ? palette.primary : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.rangeChipText,
                          {
                            color: analyticsRange === range ? palette.onPrimary : palette.textSecondary,
                          },
                        ]}
                      >
                        {range}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Text style={[styles.sectionHint, { color: palette.textSecondary }]}> 
                Tap any bar to instantly filter request moderation by status.
              </Text>

              {statusChartRows.map((row) => {
                const percentage = Math.round((row.value / maxStatusChartValue) * 100);
                const active = requestStatusFilter === row.key;

                return (
                  <Pressable
                    key={row.key}
                    onPress={() => {
                      const nextFilter = requestStatusFilter === row.key ? 'all' : row.key;
                      setRequestStatusFilter(nextFilter);
                      setNoticeText(
                        nextFilter === 'all'
                          ? 'Request filter reset to all statuses.'
                          : `Request filter set to ${formatStatusLabel(nextFilter)}.`,
                      );
                    }}
                    style={[
                      styles.analyticsRow,
                      {
                        backgroundColor: active ? palette.primarySoft : palette.surfaceAlt,
                        borderColor: active ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.analyticsLabelWrap}>
                      <MaterialIcons color={row.color} name={row.icon} size={16} />
                      <Text style={[styles.analyticsLabel, { color: palette.textPrimary }]}>{row.label}</Text>
                    </View>
                    <View style={styles.analyticsTrackWrap}>
                      <View style={[styles.analyticsTrack, { backgroundColor: palette.inputBackground }]}> 
                        <View style={[styles.analyticsFill, { width: `${percentage}%`, backgroundColor: row.color }]} />
                      </View>
                    </View>
                    <Text style={[styles.analyticsValue, { color: palette.textSecondary }]}>{row.value}</Text>
                  </Pressable>
                );
              })}

              <View style={[styles.trendCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}> 
                <Text style={[styles.trendTitle, { color: palette.textPrimary }]}>Request Trend ({analyticsRange})</Text>
                <View style={styles.trendChartRow}>
                  {trendSeries.map((point) => {
                    const barHeight = Math.max(6, Math.round((point.value / maxTrendValue) * 62));

                    return (
                      <Pressable
                        key={point.key}
                        onPress={() => {
                          setNoticeText(`${point.label}: ${point.value} request(s).`);
                        }}
                        style={styles.trendBarPressable}
                      >
                        <View style={[styles.trendBarTrack, { backgroundColor: palette.inputBackground }]}> 
                          <View
                            style={[
                              styles.trendBarFill,
                              {
                                height: barHeight,
                                backgroundColor: palette.primary,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.trendBarLabel, { color: palette.textMuted }]}>{point.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}

          {widgetPreferences.insights ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Personalized Insights</Text>
              <View style={styles.insightGrid}>
                {personalizedInsights.map((insight) => (
                  <View
                    key={insight.id}
                    style={[
                      styles.insightCard,
                      {
                        width: isTabletLayout ? '48.8%' : '100%',
                        backgroundColor: palette.surfaceAlt,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <View style={styles.insightHeader}>
                      <MaterialIcons color={palette.primary} name={insight.icon} size={16} />
                      <Text style={[styles.insightTitle, { color: palette.textPrimary }]}>{insight.title}</Text>
                    </View>
                    <Text style={[styles.insightValue, { color: palette.textPrimary }]}>{insight.value}</Text>
                    <Text style={[styles.insightDetail, { color: palette.textSecondary }]}>{insight.detail}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {widgetPreferences.alerts ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Smart Notifications</Text>
              {smartAlerts.map((alert) => (
                <View
                  key={alert.id}
                  style={[
                    styles.alertRow,
                    {
                      backgroundColor: palette.surfaceAlt,
                      borderColor: palette.border,
                      borderLeftColor: toneColors[alert.tone],
                    },
                  ]}
                >
                  <MaterialIcons color={toneColors[alert.tone]} name={alert.icon} size={18} />
                  <View style={styles.alertBody}>
                    <Text style={[styles.alertTitle, { color: palette.textPrimary }]}>{alert.title}</Text>
                    <Text style={[styles.alertDetail, { color: palette.textSecondary }]}>{alert.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {widgetPreferences.activity ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Activity Tracker</Text>
                <Text style={[styles.sectionCaption, { color: palette.textMuted }]}>{activityFeed.length} events</Text>
              </View>

              {activityFeed.length ? (
                activityFeed.map((event) => (
                  <View
                    key={event.id}
                    style={[
                      styles.activityRow,
                      {
                        backgroundColor: palette.surfaceAlt,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <View style={[styles.activityIconWrap, { backgroundColor: `${toneColors[event.tone]}1E` }]}> 
                      <MaterialIcons color={toneColors[event.tone]} name={event.icon} size={15} />
                    </View>
                    <View style={styles.activityBody}>
                      <Text style={[styles.activityTitle, { color: palette.textPrimary }]}>{event.title}</Text>
                      <Text style={[styles.activityDetail, { color: palette.textSecondary }]}>{event.detail}</Text>
                    </View>
                    <Text style={[styles.activityTime, { color: palette.textMuted }]}>{formatRelativeTime(event.createdAt)}</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyText, { color: palette.textSecondary }]}> 
                  Activity feed will appear here as the dashboard updates.
                </Text>
              )}
            </View>
          ) : null}

          {widgetPreferences.broadcast ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Broadcast Console</Text>

              <TextInput
                onChangeText={setBroadcastTitle}
                placeholder="Notification title"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.inputBackground,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
                value={broadcastTitle}
              />

              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setBroadcastTargetUserId}
                placeholder="Target user ID (optional)"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.inputBackground,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
                value={broadcastTargetUserId}
              />

              <Text style={[styles.sectionHint, { color: palette.textSecondary }]}> 
                Leave target blank to notify all active devices. Use target for direct interventions.
              </Text>

              <TextInput
                multiline
                onChangeText={setBroadcastMessage}
                placeholder="Write a concise and actionable notification"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  styles.inputMultiline,
                  {
                    backgroundColor: palette.inputBackground,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
                textAlignVertical="top"
                value={broadcastMessage}
              />

              <Pressable
                disabled={isBroadcasting || isLoading}
                onPress={() => void handleBroadcast()}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: palette.primary,
                  },
                  isBroadcasting || isLoading ? styles.primaryButtonDisabled : undefined,
                ]}
              >
                {isBroadcasting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <>
                    <MaterialIcons color={palette.onPrimary} name="send" size={16} />
                    <Text style={[styles.primaryButtonText, { color: palette.onPrimary }]}>Send Notification</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {widgetPreferences.foundModeration ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Found Item Moderation</Text>

              <View style={[styles.searchInputWrap, { backgroundColor: palette.inputBackground, borderColor: palette.border }]}> 
                <MaterialIcons color={palette.textMuted} name="search" size={16} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setFoundItemQuery}
                  placeholder="Search by title, location, category, owner"
                  placeholderTextColor={palette.textMuted}
                  style={[styles.searchInput, { color: palette.textPrimary }]}
                  value={foundItemQuery}
                />
              </View>

              <View style={styles.filterRow}>
                <Pressable
                  onPress={() => setShowStaleFoundItemsOnly((previous) => !previous)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: showStaleFoundItemsOnly ? palette.primary : palette.surfaceAlt,
                      borderColor: showStaleFoundItemsOnly ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      {
                        color: showStaleFoundItemsOnly ? palette.onPrimary : palette.textSecondary,
                      },
                    ]}
                  >
                    older than 24h ({staleFoundItemsCount})
                  </Text>
                </Pressable>
              </View>

              <Text style={[styles.sectionHint, { color: palette.textSecondary }]}> 
                Showing {visibleFoundItems.length} of {recentFoundItems.length} item(s).
              </Text>

              {visibleFoundItems.length ? (
                visibleFoundItems.map((item) => (
                  <View key={item.id} style={[styles.rowCard, { borderBottomColor: palette.border }]}> 
                    <View style={styles.rowBody}>
                      <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.textPrimary }]}>{item.title}</Text>
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textSecondary }]}>
                        {item.location} | {item.category}
                      </Text>
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textSecondary }]}> 
                        Owner: {item.createdBy || 'unknown'}
                      </Text>
                      <Text style={[styles.rowTime, { color: palette.textMuted }]}>{formatRelativeTime(item.createdAt)}</Text>
                    </View>

                    <View style={styles.rowActionColumn}>
                      <Pressable
                        disabled={Boolean(removingItemId) || isLoading}
                        onPress={() => handlePresetDirectNotification(item.createdBy, item.title || 'your found item')}
                        style={[styles.rowSmallAction, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}
                      >
                        <MaterialIcons color={palette.primary} name="notifications" size={14} />
                      </Pressable>

                      <Pressable
                        disabled={Boolean(removingItemId) || isLoading}
                        onPress={() => handleRemoveFoundItem(item)}
                        style={[styles.rowDangerButton, { backgroundColor: `${palette.error}20`, borderColor: `${palette.error}55` }]}
                      >
                        <MaterialIcons color={palette.error} name="delete-outline" size={16} />
                      </Pressable>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyText, { color: palette.textSecondary }]}> 
                  {recentFoundItems.length ? 'No found items match current filters.' : 'No found items to moderate.'}
                </Text>
              )}
            </View>
          ) : null}

          {widgetPreferences.requestModeration ? (
            <View style={[styles.sectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Request Moderation</Text>

              <View style={[styles.searchInputWrap, { backgroundColor: palette.inputBackground, borderColor: palette.border }]}> 
                <MaterialIcons color={palette.textMuted} name="search" size={16} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setRequestQuery}
                  placeholder="Search by item, request, claimant, location"
                  placeholderTextColor={palette.textMuted}
                  style={[styles.searchInput, { color: palette.textPrimary }]}
                  value={requestQuery}
                />
              </View>

              <ScrollView
                contentContainerStyle={styles.filterRow}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {requestFilterOptions.map((option) => (
                  <Pressable
                    key={option.key}
                    onPress={() => setRequestStatusFilter(option.key)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: requestStatusFilter === option.key ? palette.primary : palette.surfaceAlt,
                        borderColor: requestStatusFilter === option.key ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        {
                          color: requestStatusFilter === option.key ? palette.onPrimary : palette.textSecondary,
                        },
                      ]}
                    >
                      {option.label} ({option.count})
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={[styles.sectionHint, { color: palette.textSecondary }]}> 
                Showing {visibleRequests.length} of {recentRequests.length} request(s).
              </Text>

              {visibleRequests.length ? (
                visibleRequests.map((request) => (
                  <View key={request.id} style={[styles.rowCardTall, { borderBottomColor: palette.border }]}> 
                    <View style={styles.rowBody}>
                      <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.textPrimary }]}> 
                        {request.foundItemTitle}
                      </Text>
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textSecondary }]}> 
                        Status: {formatStatusLabel(request.status)} | {formatRelativeTime(request.createdAt)}
                      </Text>
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textSecondary }]}> 
                        {request.foundItemLocation}
                      </Text>
                    </View>

                    <View style={styles.actionRow}>
                      <Pressable
                        disabled={isLoading}
                        onPress={() => handleOpenRequestInHistory(request.id)}
                        style={[styles.actionChipGhost, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}
                      >
                        <MaterialIcons color={palette.primary} name="forum" size={12} />
                        <Text style={[styles.actionChipGhostText, { color: palette.primary }]}>open chat</Text>
                      </Pressable>

                      <Pressable
                        disabled={isLoading}
                        onPress={() =>
                          handlePresetDirectNotification(request.claimantUserId, request.foundItemTitle || 'your claim request')
                        }
                        style={[styles.actionChipGhost, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}
                      >
                        <MaterialIcons color={palette.primary} name="notifications" size={12} />
                        <Text style={[styles.actionChipGhostText, { color: palette.primary }]}>notify</Text>
                      </Pressable>

                      {REQUEST_STATUSES.map((nextStatus) => (
                        <Pressable
                          key={`${request.id}-${nextStatus}`}
                          disabled={Boolean(updatingRequestId) || request.status === nextStatus}
                          onPress={() => handleUpdateRequestStatus(request, nextStatus)}
                          style={[
                            styles.actionChip,
                            {
                              backgroundColor: request.status === nextStatus ? palette.primary : palette.surfaceAlt,
                              borderColor: request.status === nextStatus ? palette.primary : palette.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.actionChipText,
                              {
                                color: request.status === nextStatus ? palette.onPrimary : palette.textSecondary,
                              },
                            ]}
                          >
                            {formatStatusLabel(nextStatus)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyText, { color: palette.textSecondary }]}> 
                  {recentRequests.length ? 'No requests match selected filters.' : 'No requests to moderate.'}
                </Text>
              )}
            </View>
          ) : null}

          {isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={palette.primary} size="small" />
              <Text style={[styles.loadingText, { color: palette.textSecondary }]}>Loading admin dashboard...</Text>
            </View>
          ) : null}

          {errorText ? <Text style={[styles.errorText, { color: palette.error }]}>{errorText}</Text> : null}
          {noticeText ? <Text style={[styles.noticeText, { color: palette.success }]}>{noticeText}</Text> : null}
        </Animated.View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingTop: 12,
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
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    width: '100%',
  },
  deniedTitle: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
    marginTop: 8,
  },
  deniedSubtitle: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  heroCard: {
    ...shadows.soft,
    borderRadius: radii.xl,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  heroHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroTitleWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  heroTitle: {
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 25,
    letterSpacing: -0.4,
  },
  heroSubtitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginTop: 4,
  },
  heroMeta: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 4,
  },
  heroControlColumn: {
    alignItems: 'flex-end',
  },
  heroToggle: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroToggleText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
    textTransform: 'capitalize',
  },
  liveDot: {
    borderRadius: radii.pill,
    height: 8,
    width: 8,
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  quickAction: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  quickActionText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  sectionCard: {
    ...shadows.soft,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 17,
  },
  sectionCaption: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  sectionHint: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  widgetPanelToggle: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  widgetPanelToggleText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  searchInputWrap: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  globalSearchInput: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginLeft: 6,
    minHeight: 38,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginLeft: 6,
    minHeight: 36,
    paddingVertical: 8,
  },
  widgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  widgetChip: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  widgetChipText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 8,
    minHeight: 84,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  statValue: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 25,
    marginTop: 4,
  },
  statLabel: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  rangeRow: {
    flexDirection: 'row',
  },
  rangeChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    marginLeft: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rangeChipText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
  },
  analyticsRow: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  analyticsLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 110,
    width: 110,
  },
  analyticsLabel: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  analyticsTrackWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  analyticsTrack: {
    borderRadius: radii.pill,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  analyticsFill: {
    borderRadius: radii.pill,
    height: 8,
  },
  analyticsValue: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    minWidth: 35,
    textAlign: 'right',
  },
  trendCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  trendTitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginBottom: 8,
  },
  trendChartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendBarPressable: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 2,
  },
  trendBarTrack: {
    borderRadius: radii.pill,
    height: 70,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  trendBarFill: {
    borderRadius: radii.pill,
    width: '100%',
  },
  trendBarLabel: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 10,
    marginTop: 4,
    textTransform: 'capitalize',
  },
  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  insightCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 8,
    minHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  insightHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  insightTitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 5,
  },
  insightValue: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 26,
    marginTop: 8,
  },
  insightDetail: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  alertRow: {
    alignItems: 'center',
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  alertBody: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
  },
  alertTitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  alertDetail: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  activityRow: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  activityIconWrap: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  activityBody: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
  },
  activityTitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  activityDetail: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  activityTime: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 10,
    marginLeft: 6,
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inputMultiline: {
    minHeight: 90,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  rowCard: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 8,
  },
  rowCardTall: {
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
  },
  rowMeta: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 2,
  },
  rowTime: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 4,
  },
  rowActionColumn: {
    justifyContent: 'center',
    marginLeft: 8,
  },
  rowSmallAction: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    marginBottom: 6,
    width: 34,
  },
  rowDangerButton: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  actionChip: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionChipText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  actionChipGhost: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionChipGhostText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
    textTransform: 'capitalize',
  },
  emptyText: {
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
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 6,
  },
  errorText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  noticeText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
});
