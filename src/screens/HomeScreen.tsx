import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '@clerk/clerk-expo';
import { useUser } from '@clerk/clerk-expo';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { CampusActionStudio } from '../components/CampusActionStudio';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { backendEnv } from '../config/env';
import { useNotificationBadge } from '../lib/notificationBadge';
import { buildSupabaseClient } from '../lib/supabase';
import { markTutorialCompleted, shouldShowTutorial } from '../lib/tutorialSeen';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVED_POPUP_STORAGE_PREFIX = 'approved-claim-popup-seen-v1';
const HOME_TUTORIAL_STORAGE_PREFIX = 'home-onboarding-tutorial-seen-v1';
const REQUEST_TIMEOUT_MS = 15000;

type CampusZone = 'Academic' | 'Residence' | 'Transit' | 'Commons' | 'General';
type SortMode = 'latest' | 'priority';

type FoundItem = {
  id: string;
  title: string;
  location: string;
  foundAgo: string;
  category: string;
  imageUri: string | null;
  createdAtMs: number;
  recoveryScore: number;
  campusZone: CampusZone;
};

type VisionDetection = {
  label: string;
  category: string;
};

type ApprovedClaimReminder = {
  requestId: string;
  foundItemId: string;
  title: string;
  location: string;
  approvedAt: string | null;
};

type AiPopupStatus = 'found' | 'not-found';

type AiPopupState = {
  visible: boolean;
  status: AiPopupStatus;
  matchedItem: FoundItem | null;
  scannedImageUri: string | null;
  detection: VisionDetection | null;
};

type HomeTabNavigationParams = {
  History: {
    focusRequestId?: string;
    focusFoundItemId?: string;
    focusNonce?: number;
    autoOpenMessages?: boolean;
  } | undefined;
  Profile: undefined;
  Notifications: undefined;
  Settings: undefined;
};

type TutorialTarget = 'hero' | 'search' | 'filters' | 'items' | 'actions';

type TutorialStep = {
  target: TutorialTarget;
  title: string;
  description: string;
  tip: string;
};

const HOME_TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: 'hero',
    title: 'Welcome To UniSync',
    description:
      'This home dashboard is your command center for finding lost items and starting claim flows.',
    tip: 'Start with search or category filters before opening a claim.',
  },
  {
    target: 'search',
    title: 'Search And Camera Match',
    description:
      'Use the search bar for quick text lookup, or tap the camera icon to let AI match your item image.',
    tip: 'Clear, close-up images improve AI match quality and confidence.',
  },
  {
    target: 'filters',
    title: 'Narrow Results Fast',
    description:
      'Switch categories, sorting mode, and 24-hour filter to focus only on the most relevant found items.',
    tip: 'Priority mode pushes high-confidence and urgent matches to the top.',
  },
  {
    target: 'items',
    title: 'Review And Claim Items',
    description:
      'Open the item list, verify details, then tap Claim Product to submit proof and contact the finder.',
    tip: 'Check location and time first so you only claim the correct item.',
  },
  {
    target: 'actions',
    title: 'Quick Actions Studio',
    description:
      'Use quick actions to report new lost/found items and continue claim workflows without leaving home.',
    tip: 'Use the History tab to track claim status updates and pickup steps.',
  },
];

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function readIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return readText(value);
}

function resolveTimestampMs(value: unknown): number {
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

function inferCampusZone(location: string): CampusZone {
  const lowered = location.toLowerCase();

  if (
    /(library|lab|lecture|class|department|auditorium|faculty|block|hall|studio|academic)/.test(
      lowered,
    )
  ) {
    return 'Academic';
  }

  if (/(hostel|dorm|residence|residential|room|wing|tower)/.test(lowered)) {
    return 'Residence';
  }

  if (/(gate|parking|bus|stop|station|shuttle|bike|road|metro)/.test(lowered)) {
    return 'Transit';
  }

  if (/(canteen|cafe|cafeteria|food|court|sports|gym|center|centre|plaza|lawn)/.test(lowered)) {
    return 'Commons';
  }

  return 'General';
}

function resolveCategoryWeight(category: string): number {
  const lowered = category.toLowerCase();

  if (/(id|identity|wallet|card|passport)/.test(lowered)) {
    return 34;
  }

  if (/(key|keys)/.test(lowered)) {
    return 30;
  }

  if (/(laptop|phone|tablet|electronic|device|charger|earbuds|headphone)/.test(lowered)) {
    return 28;
  }

  if (/(bag|backpack|pouch)/.test(lowered)) {
    return 22;
  }

  return 16;
}

function resolveZoneWeight(zone: CampusZone): number {
  if (zone === 'Academic') {
    return 20;
  }

  if (zone === 'Transit') {
    return 18;
  }

  if (zone === 'Commons') {
    return 15;
  }

  if (zone === 'Residence') {
    return 12;
  }

  return 10;
}

function resolveRecencyWeight(createdAtMs: number): number {
  if (!createdAtMs) {
    return 12;
  }

  const ageHours = Math.max(Date.now() - createdAtMs, 0) / (1000 * 60 * 60);

  if (ageHours < 6) {
    return 34;
  }

  if (ageHours < 24) {
    return 28;
  }

  if (ageHours < 72) {
    return 20;
  }

  if (ageHours < 168) {
    return 16;
  }

  return 10;
}

function computeRecoveryScore(category: string, location: string, createdAtMs: number): number {
  const zone = inferCampusZone(location);
  const score =
    resolveCategoryWeight(category) + resolveZoneWeight(zone) + resolveRecencyWeight(createdAtMs);

  return Math.max(35, Math.min(99, score));
}

function formatFoundAgo(input: string | null): string {
  if (!input) {
    return 'Recently found';
  }

  const timestamp = new Date(input).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Recently found';
  }

  const diffMs = Math.max(Date.now() - timestamp, 0);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    const diffMinutes = Math.max(Math.floor(diffMs / (1000 * 60)), 1);
    return `${diffMinutes}m ago`;
  }

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
}

function categoryPillStyle(category: string): { backgroundColor: string; color: string } {
  const lowered = category.toLowerCase();

  if (/(electronic|device|laptop|phone)/.test(lowered)) {
    return {
      backgroundColor: '#DCE7FF',
      color: '#224086',
    };
  }

  if (/(wallet|key|identity|card)/.test(lowered)) {
    return {
      backgroundColor: '#FFE4DA',
      color: '#8A3518',
    };
  }

  return {
    backgroundColor: colors.surfaceLow,
    color: colors.onSurfaceVariant,
  };
}

function mapRowToItem(row: Record<string, unknown>): FoundItem {
  const title = readText(row.title) ?? readText(row.name) ?? 'Unnamed item';
  const location =
    readText(row.location) ??
    readText(row.location_name) ??
    readText(row.found_location) ??
    'Campus location';
  const category = readText(row.category) ?? readText(row.category_name) ?? 'General';
  const imageUri =
    readText(row.image_url) ?? readText(row.photo_url) ?? readText(row.image) ?? null;
  const createdAtRaw =
    readText(row.created_at) ?? readText(row.found_at) ?? readText(row.inserted_at) ?? null;

  const createdAtMs = createdAtRaw ? new Date(createdAtRaw).getTime() : 0;
  const safeCreatedAtMs = Number.isNaN(createdAtMs) ? 0 : createdAtMs;

  return {
    id:
      readIdentifier(row.id) ??
      `${title}-${location}-${createdAtRaw ?? Math.random().toString(36).slice(2)}`,
    title,
    location,
    foundAgo: formatFoundAgo(createdAtRaw),
    category,
    imageUri,
    createdAtMs: safeCreatedAtMs,
    campusZone: inferCampusZone(location),
    recoveryScore: computeRecoveryScore(category, location, safeCreatedAtMs),
  };
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

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function findBestClaimMatch(items: FoundItem[], detection: VisionDetection): FoundItem | null {
  const labelTokens = tokenize(detection.label);
  const categoryTokens = tokenize(detection.category);

  let bestItem: FoundItem | null = null;
  let bestScore = 0;

  items.forEach((item) => {
    const title = item.title.toLowerCase();
    const category = item.category.toLowerCase();
    const titleTokens = tokenize(item.title);

    let score = 0;

    if (detection.category && category === detection.category.toLowerCase()) {
      score += 55;
    } else if (categoryTokens.some((token) => category.includes(token))) {
      score += 30;
    }

    if (detection.label && title.includes(detection.label.toLowerCase())) {
      score += 45;
    }

    const overlap = labelTokens.filter((token) => titleTokens.includes(token)).length;
    score += overlap * 11;

    score += Math.round(item.recoveryScore / 16);

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  });

  return bestScore >= 42 ? bestItem : null;
}

function FoundItemCard({
  item,
  onClaimPress,
  highlighted = false,
}: {
  item: FoundItem;
  onClaimPress: (item: FoundItem) => void;
  highlighted?: boolean;
}) {
  const categoryPill = categoryPillStyle(item.category);

  return (
    <View style={[styles.itemCard, highlighted ? styles.itemCardHighlighted : undefined]}>
      {item.imageUri ? (
        <Image source={{ uri: item.imageUri }} style={styles.itemImage} />
      ) : (
        <View style={styles.itemImageFallback}>
          <MaterialIcons color={colors.outline} name="photo" size={22} />
        </View>
      )}

      <View style={styles.itemContent}>
        <View style={styles.itemTopRow}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <View style={[styles.itemCategoryPill, { backgroundColor: categoryPill.backgroundColor }]}> 
            <Text style={[styles.itemCategoryText, { color: categoryPill.color }]}>{item.category}</Text>
          </View>
        </View>

        <View style={styles.itemMetaRow}>
          <MaterialIcons color={colors.onSurfaceVariant} name="location-on" size={14} />
          <Text numberOfLines={1} style={styles.itemMetaText}>
            {item.location}
          </Text>
        </View>

        <View style={styles.itemBottomRow}>
          <Text style={styles.itemAgo}>{item.foundAgo}</Text>
          <Text style={styles.itemScore}>{item.recoveryScore}% match</Text>
        </View>

        <Pressable onPress={() => onClaimPress(item)} style={styles.itemClaimButton}>
          <MaterialIcons color={colors.onPrimary} name="verified-user" size={14} />
          <Text style={styles.itemClaimButtonText}>Claim Product</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function HomeScreen() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { unreadCount, requestSync } = useNotificationBadge();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp<HomeTabNavigationParams>>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const getTokenRef = useRef(getToken);
  const approvedPopupScale = useRef(new Animated.Value(0.86)).current;
  const approvedPopupOpacity = useRef(new Animated.Value(0)).current;
  const tutorialPulse = useRef(new Animated.Value(0)).current;
  const currentUserId = readText(user?.id) ?? '';

  const [allItems, setAllItems] = useState<FoundItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [recentOnly, setRecentOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [aiNotice, setAiNotice] = useState('');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [claimIntentItemId, setClaimIntentItemId] = useState('');
  const [claimIntentNonce, setClaimIntentNonce] = useState(0);
  const [focusedItemId, setFocusedItemId] = useState('');
  const [approvedClaimReminders, setApprovedClaimReminders] = useState<ApprovedClaimReminder[]>([]);
  const [approvedPopupSeenRequestIds, setApprovedPopupSeenRequestIds] = useState<string[]>([]);
  const [approvedPopupReminder, setApprovedPopupReminder] = useState<ApprovedClaimReminder | null>(null);
  const [isApprovedPopupVisible, setIsApprovedPopupVisible] = useState(false);
  const [isTutorialVisible, setIsTutorialVisible] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [tutorialLayouts, setTutorialLayouts] = useState<
    Partial<Record<TutorialTarget, { y: number; height: number }>>
  >({});
  const [tutorialPlacement, setTutorialPlacement] = useState<'top' | 'bottom'>('bottom');
  const [tutorialCardHeight, setTutorialCardHeight] = useState(0);
  const [hasTutorialBeenSeen, setHasTutorialBeenSeen] = useState(true);
  const [aiPopup, setAiPopup] = useState<AiPopupState>({
    visible: false,
    status: 'not-found',
    matchedItem: null,
    scannedImageUri: null,
    detection: null,
  });

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const approvedPopupStorageKey = currentUserId
    ? `${APPROVED_POPUP_STORAGE_PREFIX}:${currentUserId}`
    : '';
  const userCreatedAtMs = useMemo(() => resolveTimestampMs(user?.createdAt), [user?.createdAt]);
  const showTutorialEntry = Boolean(currentUserId) && !hasTutorialBeenSeen;
  const tutorialSyncOptions = useMemo(
    () => ({
      tutorialKey: HOME_TUTORIAL_STORAGE_PREFIX,
      userId: currentUserId,
      backendBaseUrl: backendEnv.backendUrl,
      getToken: async () => await getTokenRef.current().catch(() => null),
      userCreatedAtMs,
    }),
    [currentUserId, userCreatedAtMs],
  );
  const activeTutorialStep = HOME_TUTORIAL_STEPS[tutorialStepIndex] ?? HOME_TUTORIAL_STEPS[0];
  const tutorialPulseShadowOpacity = tutorialPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.42],
  });

  const recordTutorialSectionLayout = useCallback(
    (target: TutorialTarget) => (event: LayoutChangeEvent) => {
      const nextY = event.nativeEvent.layout.y;
      const nextHeight = event.nativeEvent.layout.height;

      setTutorialLayouts((previous) => {
        const current = previous[target];
        if (
          current &&
          Math.abs(current.y - nextY) < 2 &&
          Math.abs(current.height - nextHeight) < 2
        ) {
          return previous;
        }

        return {
          ...previous,
          [target]: {
            y: nextY,
            height: nextHeight,
          },
        };
      });
    },
    [],
  );

  const markTutorialSeen = useCallback(async () => {
    if (!tutorialSyncOptions.userId) {
      return false;
    }

    setHasTutorialBeenSeen(true);

    return await markTutorialCompleted(tutorialSyncOptions);
  }, [tutorialSyncOptions]);

  const startTutorial = useCallback(() => {
    setTutorialStepIndex(0);
    setIsTutorialVisible(true);
  }, []);

  const closeTutorial = useCallback(
    (markSeen: boolean) => {
      setIsTutorialVisible(false);

      if (markSeen) {
        void markTutorialSeen();
      }
    },
    [markTutorialSeen],
  );

  const handleTutorialBack = useCallback(() => {
    setTutorialStepIndex((previous) => Math.max(0, previous - 1));
  }, []);

  const handleTutorialNext = useCallback(() => {
    if (tutorialStepIndex >= HOME_TUTORIAL_STEPS.length - 1) {
      closeTutorial(true);
      setAiNotice('Tutorial completed. Tip: use camera search for faster claim matching.');
      return;
    }

    setTutorialStepIndex((previous) => Math.min(previous + 1, HOME_TUTORIAL_STEPS.length - 1));
  }, [closeTutorial, tutorialStepIndex]);

  const resolveTutorialSectionStyle = useCallback(
    (target: TutorialTarget) => {
      if (!isTutorialVisible || !activeTutorialStep) {
        return undefined;
      }

      if (activeTutorialStep.target === target) {
        return [
          styles.tutorialSectionActive,
          {
            shadowOpacity: tutorialPulseShadowOpacity,
          },
        ];
      }

      return styles.tutorialSectionMuted;
    },
    [activeTutorialStep, isTutorialVisible, tutorialPulseShadowOpacity],
  );

  useEffect(() => {
    let isActive = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const maybeShowTutorial = async () => {
      if (!tutorialSyncOptions.userId) {
        setHasTutorialBeenSeen(true);
        setIsTutorialVisible(false);
        setTutorialStepIndex(0);
        return;
      }

      const shouldShow = await shouldShowTutorial(tutorialSyncOptions);

      if (!isActive) {
        return;
      }

      if (!shouldShow) {
        setHasTutorialBeenSeen(true);
        return;
      }

      setHasTutorialBeenSeen(false);

      timerId = setTimeout(() => {
        if (!isActive) {
          return;
        }

        setTutorialStepIndex(0);
        setIsTutorialVisible(true);
      }, 540);
    };

    void maybeShowTutorial();

    return () => {
      isActive = false;

      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [tutorialSyncOptions]);

  useEffect(() => {
    if (!isTutorialVisible) {
      tutorialPulse.stopAnimation();
      tutorialPulse.setValue(0);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(tutorialPulse, {
          toValue: 1,
          duration: 620,
          useNativeDriver: false,
        }),
        Animated.timing(tutorialPulse, {
          toValue: 0,
          duration: 620,
          useNativeDriver: false,
        }),
      ]),
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
      tutorialPulse.stopAnimation();
      tutorialPulse.setValue(0);
    };
  }, [isTutorialVisible, tutorialPulse]);

  useEffect(() => {
    if (!isTutorialVisible || !activeTutorialStep) {
      return;
    }

    const targetLayout = tutorialLayouts[activeTutorialStep.target];
    if (!targetLayout) {
      return;
    }

    const targetMidpoint = targetLayout.y + targetLayout.height * 0.5;
    const nextPlacement = targetMidpoint > windowHeight * 0.56 ? 'top' : 'bottom';

    if (tutorialPlacement !== nextPlacement) {
      setTutorialPlacement(nextPlacement);
    }

    const scrollOffset =
      nextPlacement === 'top' ? Math.max(tutorialCardHeight + 102, 310) : 108;

    const scrollDelay = setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(targetLayout.y - scrollOffset, 0),
        animated: true,
      });
    }, 90);

    return () => {
      clearTimeout(scrollDelay);
    };
  }, [
    activeTutorialStep,
    isTutorialVisible,
    tutorialCardHeight,
    tutorialLayouts,
    tutorialPlacement,
    windowHeight,
  ]);

  useEffect(() => {
    let isActive = true;

    if (!approvedPopupStorageKey) {
      setApprovedPopupSeenRequestIds([]);
      return () => {
        isActive = false;
      };
    }

    const loadSeenPopupState = async () => {
      try {
        const serialized = await SecureStore.getItemAsync(approvedPopupStorageKey);
        const parsed = serialized ? (JSON.parse(serialized) as unknown) : [];

        if (!isActive) {
          return;
        }

        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => Boolean(value));

          setApprovedPopupSeenRequestIds(normalized);
          return;
        }

        setApprovedPopupSeenRequestIds([]);
      } catch {
        if (isActive) {
          setApprovedPopupSeenRequestIds([]);
        }
      }
    };

    void loadSeenPopupState();

    return () => {
      isActive = false;
    };
  }, [approvedPopupStorageKey]);

  const rememberApprovedPopupShown = useCallback(
    (requestId: string) => {
      if (!requestId) {
        return;
      }

      setApprovedPopupSeenRequestIds((previous) => {
        if (previous.includes(requestId)) {
          return previous;
        }

        const next = [...previous, requestId].slice(-40);

        if (approvedPopupStorageKey) {
          void SecureStore.setItemAsync(approvedPopupStorageKey, JSON.stringify(next)).catch(() => {
            return;
          });
        }

        return next;
      });
    },
    [approvedPopupStorageKey],
  );

  useEffect(() => {
    if (!approvedClaimReminders.length || isApprovedPopupVisible || isTutorialVisible) {
      return;
    }

    const unseenReminder = approvedClaimReminders.find(
      (entry) => !approvedPopupSeenRequestIds.includes(entry.requestId),
    );

    if (!unseenReminder) {
      return;
    }

    setApprovedPopupReminder(unseenReminder);
    setIsApprovedPopupVisible(true);
    rememberApprovedPopupShown(unseenReminder.requestId);
  }, [
    approvedClaimReminders,
    approvedPopupSeenRequestIds,
    isApprovedPopupVisible,
    isTutorialVisible,
    rememberApprovedPopupShown,
  ]);

  useEffect(() => {
    if (!isTutorialVisible || !isApprovedPopupVisible) {
      return;
    }

    setIsApprovedPopupVisible(false);
  }, [isApprovedPopupVisible, isTutorialVisible]);

  useEffect(() => {
    if (!isApprovedPopupVisible) {
      return;
    }

    approvedPopupOpacity.setValue(0);
    approvedPopupScale.setValue(0.86);

    Animated.parallel([
      Animated.timing(approvedPopupOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(approvedPopupScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [approvedPopupOpacity, approvedPopupScale, isApprovedPopupVisible]);

  const categories = useMemo(() => {
    const dynamic = Array.from(new Set(allItems.map((item) => item.category))).sort();
    return ['All', ...dynamic];
  }, [allItems]);

  const claimableItems = useMemo(
    () =>
      allItems.slice(0, 80).map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        location: item.location,
        image_url: item.imageUri,
      })),
    [allItems],
  );

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const now = Date.now();

    const filtered = allItems.filter((item) => {
      const passCategory = selectedCategory === 'All' || item.category === selectedCategory;
      const passSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.location.toLowerCase().includes(normalizedSearch) ||
        item.category.toLowerCase().includes(normalizedSearch);

      const passRecent = !recentOnly || (item.createdAtMs > 0 && now - item.createdAtMs <= DAY_MS);

      return passCategory && passSearch && passRecent;
    });

    filtered.sort((left, right) => {
      if (sortMode === 'priority') {
        if (right.recoveryScore !== left.recoveryScore) {
          return right.recoveryScore - left.recoveryScore;
        }
      }

      return right.createdAtMs - left.createdAtMs;
    });

    return filtered;
  }, [allItems, recentOnly, searchText, selectedCategory, sortMode]);

  const prioritizedVisibleItems = useMemo(() => {
    if (!focusedItemId) {
      return visibleItems;
    }

    const index = visibleItems.findIndex((item) => item.id === focusedItemId);
    if (index <= 0) {
      return visibleItems;
    }

    const ordered = [...visibleItems];
    const [focused] = ordered.splice(index, 1);
    if (focused) {
      ordered.unshift(focused);
    }

    return ordered;
  }, [focusedItemId, visibleItems]);

  const homeStats = useMemo(() => {
    const now = Date.now();

    const todayCount = allItems.filter(
      (item) => item.createdAtMs > 0 && now - item.createdAtMs <= DAY_MS,
    ).length;

    const urgentCount = allItems.filter((item) => item.recoveryScore >= 82).length;

    const zoneCount = new Map<CampusZone, number>();
    allItems.forEach((item) => {
      zoneCount.set(item.campusZone, (zoneCount.get(item.campusZone) ?? 0) + 1);
    });

    const topZone =
      Array.from(zoneCount.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ??
      'General';

    return {
      todayCount,
      urgentCount,
      topZone,
    };
  }, [allItems]);

  const loadItems = useCallback(async (options?: { soft?: boolean }) => {
    const soft = options?.soft ?? false;

    setErrorText('');

    if (!soft) {
      setIsLoading(true);
    }

    try {
      const backendBaseUrl = backendEnv.backendUrl.replace(/\/+$/, '');

      if (backendBaseUrl) {
        const token = await getTokenRef.current().catch(() => null);

        const [response, historyResponse] = await Promise.all([
          fetchWithTimeout(`${backendBaseUrl}/api/found-items`, {
            headers: token
              ? {
                  Authorization: `Bearer ${token}`,
                }
              : undefined,
          }),
          token
            ? fetchWithTimeout(`${backendBaseUrl}/api/match-requests/history/me`, {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              })
            : Promise.resolve(null),
        ]);

        if (!response.ok) {
          throw new Error(`Backend request failed (${response.status}).`);
        }

        const payload = (await response.json()) as { items?: Record<string, unknown>[] };
        const mapped = (payload.items ?? []).map((row) => mapRowToItem(row));
        setAllItems(mapped);

        if (historyResponse && historyResponse.ok && currentUserId) {
          const historyPayload = (await historyResponse.json()) as {
            items?: Record<string, unknown>[];
          };

          const reminders = Array.isArray(historyPayload.items)
            ? historyPayload.items
                .map((row) => {
                  const foundItemRaw =
                    row.found_item && typeof row.found_item === 'object'
                      ? (row.found_item as Record<string, unknown>)
                      : null;

                  if (!foundItemRaw) {
                    return null;
                  }

                  const status = readText(row.status);
                  const claimantUserId = readText(row.claimant_user_id);
                  const foundItemId = readText(foundItemRaw.id);

                  if (
                    status !== 'approved' ||
                    !foundItemId ||
                    !claimantUserId ||
                    claimantUserId !== currentUserId
                  ) {
                    return null;
                  }

                  return {
                    requestId: readText(row.id) ?? `${foundItemId}-approved`,
                    foundItemId,
                    title: readText(foundItemRaw.title) ?? 'Approved claim',
                    location: readText(foundItemRaw.location) ?? 'Campus location',
                    approvedAt: readText(row.reviewed_at) ?? readText(row.created_at) ?? null,
                  };
                })
                .filter((item): item is ApprovedClaimReminder => Boolean(item))
                .slice(0, 4)
            : [];

          setApprovedClaimReminders(reminders);
        } else {
          setApprovedClaimReminders([]);
        }

        return;
      }

      const accessToken = await getTokenRef.current({ template: 'supabase' }).catch(() => null);
      const client = buildSupabaseClient(accessToken ?? undefined);

      if (!client) {
        setErrorText('Supabase is not configured yet. Add keys in your .env file.');
        setApprovedClaimReminders([]);

        if (!soft) {
          setAllItems([]);
        }

        return;
      }

      const { data, error } = await client
        .from('found_items')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(80);

      if (error) {
        throw error;
      }

      setAllItems((data ?? []).map((row) => mapRowToItem(row as Record<string, unknown>)));
      setApprovedClaimReminders([]);
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to load found items.';

      setErrorText(message);

      if (!soft) {
        setAllItems([]);
      }

      setApprovedClaimReminders([]);
    } finally {
      if (!soft) {
        setIsLoading(false);
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadItems({ soft: true });
    setIsRefreshing(false);
  }, [loadItems]);

  const handleStudioActionsFinished = useCallback(async () => {
    await loadItems({ soft: true });
    requestSync();
  }, [loadItems, requestSync]);

  const readResponseError = useCallback(async (response: Response): Promise<string> => {
    try {
      const payload = (await response.json()) as { error?: unknown; details?: unknown };
      const errorMessage = readText(payload.error) ?? '';
      const detailsMessage = readText(payload.details) ?? '';

      if (errorMessage && detailsMessage) {
        return `${errorMessage}: ${detailsMessage}`;
      }

      return errorMessage || detailsMessage || `Request failed (${response.status}).`;
    } catch {
      return `Request failed (${response.status}).`;
    }
  }, []);

  const openClaimForItem = useCallback((item: FoundItem, source: 'manual' | 'ai') => {
    if (!item.id) {
      return;
    }

    setFocusedItemId(item.id);
    setClaimIntentItemId(item.id);
    setClaimIntentNonce((previous) => previous + 1);

    if (source === 'manual') {
      setAiNotice(`Claim ready for ${item.title}. Add proof in the next step.`);
    }
  }, []);

  const openApprovedClaimReminder = useCallback(
    (entry: ApprovedClaimReminder) => {
      navigation.navigate('History', {
        focusRequestId: entry.requestId,
        focusFoundItemId: entry.foundItemId,
        focusNonce: Date.now(),
        autoOpenMessages: false,
      });

      setAiNotice(`Opened ${entry.title} in History. Continue with message or pickup status there.`);
    },
    [navigation],
  );

  const closeApprovedPopup = useCallback(() => {
    setIsApprovedPopupVisible(false);
  }, []);

  const scanAndOpenClaim = useCallback(async () => {
    const backendBaseUrl = backendEnv.backendUrl.replace(/\/+$/, '');

    if (!backendBaseUrl) {
      setAiNotice('Set backend URL first, then try image claim again.');
      return;
    }

    const token = await getTokenRef.current().catch(() => null);

    if (!token) {
      setAiNotice('Sign in first to use AI image claim.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAiNotice('Gallery permission is required to upload image for AI match.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.72,
      base64: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    if (!asset?.base64) {
      setAiNotice('Could not read this image. Try again with another image.');
      return;
    }

    setIsAiSearching(true);
    setAiNotice('AI is checking your image...');

    try {
      const response = await fetchWithTimeout(`${backendBaseUrl}/api/vision/classify-item`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_base64: asset.base64,
          mime_type: asset.mimeType || 'image/jpeg',
          width: asset.width,
          height: asset.height,
          file_name: asset.fileName || `scan-${Date.now()}.jpg`,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as { detection?: unknown };
      const detectionRecord =
        payload.detection && typeof payload.detection === 'object'
          ? (payload.detection as Record<string, unknown>)
          : {};

      const detection: VisionDetection = {
        label: readText(detectionRecord.label) ?? '',
        category: readText(detectionRecord.category) ?? '',
      };

      const matchedItem = findBestClaimMatch(allItems, detection);

      if (!matchedItem) {
        setAiNotice('Product not found. Try again with a clearer image.');
        setAiPopup({
          visible: true,
          status: 'not-found',
          matchedItem: null,
          scannedImageUri: asset.uri,
          detection,
        });
        return;
      }

      setAiNotice(`AI found ${matchedItem.title}.`);
      setAiPopup({
        visible: true,
        status: 'found',
        matchedItem,
        scannedImageUri: asset.uri,
        detection,
      });
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'AI match failed. Please try again.';

      setAiNotice(message);
    } finally {
      setIsAiSearching(false);
    }
  }, [allItems, readResponseError]);

  const closeAiPopup = useCallback(() => {
    setAiPopup((previous) => ({ ...previous, visible: false }));
  }, []);

  const handleGoToPopupProduct = useCallback(() => {
    if (!aiPopup.matchedItem) {
      closeAiPopup();
      return;
    }

    setFocusedItemId(aiPopup.matchedItem.id);
    setSelectedCategory('All');
    setSearchText(aiPopup.matchedItem.title);
    setSortMode('priority');
    setRecentOnly(false);
    setAiNotice(`Showing ${aiPopup.matchedItem.title}.`);
    closeAiPopup();
  }, [aiPopup.matchedItem, closeAiPopup]);

  const handleClaimFromPopup = useCallback(() => {
    if (!aiPopup.matchedItem) {
      closeAiPopup();
      return;
    }

    openClaimForItem(aiPopup.matchedItem, 'ai');
    setAiNotice(`Claim flow opened for ${aiPopup.matchedItem.title}.`);
    closeAiPopup();
  }, [aiPopup.matchedItem, closeAiPopup, openClaimForItem]);

  const resetFilters = useCallback(() => {
    setSelectedCategory('All');
    setSearchText('');
    setSortMode('latest');
    setRecentOnly(false);
  }, []);

  const showInlineError = !isLoading && visibleItems.length > 0 && Boolean(errorText);
  const showBlockingError = !isLoading && !visibleItems.length && Boolean(errorText);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar
        leftIcon="person"
        onLeftPress={() => navigation.navigate('Profile')}
        onRightPress={() => navigation.navigate('Notifications')}
        rightBadgeCount={unreadCount}
        rightIcon={unreadCount > 0 ? 'notifications' : 'notifications-none'}
        title="UniSync"
      />

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.content,
          isTutorialVisible ? styles.contentTutorialActive : undefined,
        ]}
        refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          onLayout={recordTutorialSectionLayout('hero')}
          style={resolveTutorialSectionStyle('hero')}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroHeaderRow}>
              <View style={styles.heroHeaderBody}>
                <Text style={styles.heroTitle}>Lost & Found</Text>
                <Text style={styles.heroSubtitle}>
                  Find items faster, submit claims safely, and help items return to the right owner.
                </Text>
              </View>

              {showTutorialEntry ? (
                <Pressable
                  onPress={startTutorial}
                  style={({ pressed }) => [
                    styles.heroTutorialButton,
                    pressed ? styles.heroTutorialButtonPressed : undefined,
                  ]}
                >
                  <MaterialIcons color={colors.primary} name="tips-and-updates" size={13} />
                  <Text style={styles.heroTutorialButtonText}>Tutorial</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.heroStepsRow}>
              <View style={styles.heroStepChip}>
                <MaterialIcons color={colors.primary} name="search" size={14} />
                <Text style={styles.heroStepText}>Find</Text>
              </View>

              <View style={styles.heroStepChip}>
                <MaterialIcons color={colors.primary} name="photo-camera" size={14} />
                <Text style={styles.heroStepText}>Scan</Text>
              </View>

              <View style={styles.heroStepChip}>
                <MaterialIcons color={colors.primary} name="verified-user" size={14} />
                <Text style={styles.heroStepText}>Claim</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {approvedClaimReminders.length ? (
          <View style={styles.approvedClaimSection}>
            <View style={styles.approvedClaimHeader}>
              <MaterialIcons color={colors.primary} name="verified-user" size={16} />
              <Text style={styles.approvedClaimTitle}>You Can Claim Your Product</Text>
            </View>

            {approvedClaimReminders.map((entry) => (
              <View key={`${entry.requestId}-${entry.foundItemId}`} style={styles.approvedClaimCard}>
                <View style={styles.approvedClaimTopRow}>
                  <Text numberOfLines={1} style={styles.approvedClaimItemTitle}>
                    {entry.title}
                  </Text>
                  <Text style={styles.approvedClaimAgo}>{formatFoundAgo(entry.approvedAt)}</Text>
                </View>

                <Text numberOfLines={1} style={styles.approvedClaimLocation}>
                  {entry.location}
                </Text>

                <Pressable
                  onPress={() => openApprovedClaimReminder(entry)}
                  style={styles.approvedClaimButton}
                >
                  <Text style={styles.approvedClaimButtonText}>Claim Your Product</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <Modal
          animationType="none"
          onRequestClose={closeApprovedPopup}
          transparent
          visible={isApprovedPopupVisible && Boolean(approvedPopupReminder)}
        >
          <View style={styles.approvedPopupBackdrop}>
            <Animated.View
              style={[
                styles.approvedPopupCard,
                {
                  opacity: approvedPopupOpacity,
                  transform: [{ scale: approvedPopupScale }],
                },
              ]}
            >
              <View style={styles.approvedPopupHeader}>
                <View style={styles.approvedPopupIconBubble}>
                  <MaterialIcons color={colors.success} name="verified" size={22} />
                </View>
                <Text style={styles.approvedPopupTitle}>Claim Approved</Text>
              </View>

              <Text style={styles.approvedPopupSubtitle}>
                Your ownership is validated. Coordinate pickup from History.
              </Text>

              {approvedPopupReminder ? (
                <View style={styles.approvedPopupInfoCard}>
                  <Text numberOfLines={1} style={styles.approvedPopupInfoTitle}>
                    {approvedPopupReminder.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.approvedPopupInfoMeta}>
                    {approvedPopupReminder.location}
                  </Text>
                </View>
              ) : null}

              <View style={styles.approvedPopupActionRow}>
                <Pressable onPress={closeApprovedPopup} style={styles.approvedPopupSecondaryButton}>
                  <Text style={styles.approvedPopupSecondaryButtonText}>Later</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (approvedPopupReminder) {
                      openApprovedClaimReminder(approvedPopupReminder);
                    }
                    closeApprovedPopup();
                  }}
                  style={styles.approvedPopupPrimaryButton}
                >
                  <Text style={styles.approvedPopupPrimaryButtonText}>Open History</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        </Modal>

        <Animated.View
          onLayout={recordTutorialSectionLayout('search')}
          style={resolveTutorialSectionStyle('search')}
        >
          <View style={styles.searchShell}>
            <MaterialIcons color={colors.outline} name="search" size={20} style={styles.searchIcon} />
            <TextInput
              onChangeText={setSearchText}
              placeholder="Search item, category, or location"
              placeholderTextColor={colors.outline}
              style={styles.searchInput}
              value={searchText}
            />

            <View style={styles.searchCameraDivider} />

            <Pressable disabled={isAiSearching} onPress={() => void scanAndOpenClaim()} style={styles.searchCameraButton}>
              {isAiSearching ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <MaterialIcons color={colors.primary} name="photo-camera" size={18} />
              )}
            </Pressable>
          </View>

          {aiNotice ? (
            <View style={styles.aiNoticeWrap}>
              <MaterialIcons color={colors.primary} name="auto-awesome" size={14} />
              <Text numberOfLines={2} style={styles.aiNoticeText}>
                {aiNotice}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        <Modal animationType="fade" onRequestClose={closeAiPopup} transparent visible={aiPopup.visible}>
          <View style={styles.aiModalBackdrop}>
            <View style={styles.aiModalCard}>
              <View style={styles.aiModalBadgeRow}>
                <View
                  style={[
                    styles.aiModalBadge,
                    aiPopup.status === 'found' ? styles.aiModalBadgeFound : styles.aiModalBadgeMiss,
                  ]}
                >
                  <MaterialIcons
                    color={aiPopup.status === 'found' ? '#1A663A' : colors.error}
                    name={aiPopup.status === 'found' ? 'check-circle' : 'error-outline'}
                    size={14}
                  />
                  <Text
                    style={[
                      styles.aiModalBadgeText,
                      aiPopup.status === 'found' ? styles.aiModalBadgeTextFound : styles.aiModalBadgeTextMiss,
                    ]}
                  >
                    {aiPopup.status === 'found' ? 'Match Found' : 'Not Found'}
                  </Text>
                </View>
              </View>

              <Text style={styles.aiModalTitle}>
                {aiPopup.status === 'found' ? 'Yeah, we found your item!' : 'Item not found'}
              </Text>

              <Text style={styles.aiModalSubtitle}>
                {aiPopup.status === 'found'
                  ? 'Check this product image and continue if it is yours.'
                  : 'Try again with a clearer image or a different angle.'}
              </Text>

              <View style={styles.aiModalPreviewWrap}>
                {aiPopup.status === 'found' && aiPopup.matchedItem?.imageUri ? (
                  <Image source={{ uri: aiPopup.matchedItem.imageUri }} style={styles.aiModalPreviewImage} />
                ) : aiPopup.scannedImageUri ? (
                  <Image source={{ uri: aiPopup.scannedImageUri }} style={styles.aiModalPreviewImage} />
                ) : (
                  <View style={styles.aiModalPreviewFallback}>
                    <MaterialIcons color={colors.outline} name="photo" size={22} />
                  </View>
                )}
              </View>

              {aiPopup.status === 'found' && aiPopup.matchedItem ? (
                <View style={styles.aiModalItemMeta}>
                  <Text numberOfLines={1} style={styles.aiModalItemTitle}>
                    {aiPopup.matchedItem.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.aiModalItemSubtext}>
                    {aiPopup.matchedItem.location}
                  </Text>
                </View>
              ) : (
                <Text numberOfLines={1} style={styles.aiModalItemSubtextCenter}>
                  {aiPopup.detection
                    ? `AI saw: ${aiPopup.detection.label || 'Item'} / ${aiPopup.detection.category || 'General'}`
                    : 'No confident product match yet.'}
                </Text>
              )}

              <View style={styles.aiModalActionRow}>
                {aiPopup.status === 'found' ? (
                  <>
                    <Pressable onPress={handleGoToPopupProduct} style={styles.aiModalSecondaryButton}>
                      <Text style={styles.aiModalSecondaryButtonText}>Go To Product</Text>
                    </Pressable>

                    <Pressable onPress={handleClaimFromPopup} style={styles.aiModalPrimaryButton}>
                      <Text style={styles.aiModalPrimaryButtonText}>Claim Now</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable onPress={closeAiPopup} style={styles.aiModalSecondaryButton}>
                      <Text style={styles.aiModalSecondaryButtonText}>Close</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        closeAiPopup();
                        void scanAndOpenClaim();
                      }}
                      style={styles.aiModalPrimaryButton}
                    >
                      <Text style={styles.aiModalPrimaryButtonText}>Try Again</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          </View>
        </Modal>

        <Animated.View
          onLayout={recordTutorialSectionLayout('filters')}
          style={resolveTutorialSectionStyle('filters')}
        >
          <ScrollView
            contentContainerStyle={styles.chipsContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsWrap}
          >
            {categories.map((category) => {
              const active = selectedCategory === category;

              return (
                <Pressable
                  key={category}
                  onPress={() => setSelectedCategory(category)}
                  style={[styles.filterChip, active ? styles.filterChipActive : styles.filterChipIdle]}
                >
                  <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : undefined]}>
                    {category}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.sortRow}>
            <Pressable
              onPress={() => setSortMode('latest')}
              style={[styles.sortButton, sortMode === 'latest' ? styles.sortButtonActive : undefined]}
            >
              <Text style={[styles.sortButtonText, sortMode === 'latest' ? styles.sortButtonTextActive : undefined]}>
                Latest
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSortMode('priority')}
              style={[styles.sortButton, sortMode === 'priority' ? styles.sortButtonActive : undefined]}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortMode === 'priority' ? styles.sortButtonTextActive : undefined,
                ]}
              >
                Priority
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setRecentOnly((prev) => !prev)}
              style={[styles.sortButton, recentOnly ? styles.sortButtonActive : undefined]}
            >
              <Text style={[styles.sortButtonText, recentOnly ? styles.sortButtonTextActive : undefined]}>
                24h
              </Text>
            </Pressable>

            <Pressable onPress={resetFilters} style={styles.resetButton}>
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Today</Text>
              <Text style={styles.statValue}>{homeStats.todayCount}</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Urgent</Text>
              <Text style={styles.statValue}>{homeStats.urgentCount}</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Top Zone</Text>
              <Text numberOfLines={1} style={styles.statValueCompact}>
                {homeStats.topZone}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          onLayout={recordTutorialSectionLayout('items')}
          style={resolveTutorialSectionStyle('items')}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Found Items</Text>
            <View style={styles.sectionHeaderActions}>
              {focusedItemId ? (
                <Pressable onPress={() => setFocusedItemId('')} style={styles.clearFocusButton}>
                  <Text style={styles.clearFocusText}>Clear Focus</Text>
                </Pressable>
              ) : null}
              <Text style={styles.sectionMeta}>{visibleItems.length} visible</Text>
            </View>
          </View>

          {showInlineError ? (
            <View style={styles.inlineErrorWrap}>
              <MaterialIcons color={colors.error} name="error-outline" size={16} />
              <Text numberOfLines={2} style={styles.inlineErrorText}>
                {errorText}
              </Text>
            </View>
          ) : null}

          {isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.loadingText}>Loading items...</Text>
            </View>
          ) : showBlockingError ? (
            <View style={styles.emptyStateCard}>
              <MaterialIcons color={colors.error} name="error-outline" size={24} />
              <Text style={styles.emptyTitle}>Unable to load items</Text>
              <Text style={styles.emptySubtitle}>{errorText}</Text>
              <Pressable onPress={() => void loadItems()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : visibleItems.length === 0 ? (
            <View style={styles.emptyStateCard}>
              <MaterialIcons color={colors.outline} name="inventory-2" size={24} />
              <Text style={styles.emptyTitle}>No results</Text>
              <Text style={styles.emptySubtitle}>
                Try changing search text or filters to see more items.
              </Text>
              <Pressable onPress={resetFilters} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Reset filters</Text>
              </Pressable>
            </View>
          ) : (
            prioritizedVisibleItems.slice(0, 40).map((item) => (
              <FoundItemCard
                key={item.id}
                highlighted={item.id === focusedItemId}
                item={item}
                onClaimPress={(target) => openClaimForItem(target, 'manual')}
              />
            ))
          )}
        </Animated.View>

        <Animated.View
          onLayout={recordTutorialSectionLayout('actions')}
          style={resolveTutorialSectionStyle('actions')}
        >
          <View style={styles.toolsWrap}>
            <Text style={styles.toolsTitle}>Quick Actions</Text>
            <Text style={styles.toolsSubtitle}>
              Report lost items or start a new claim proof flow. Claim history is now in the History tab.
            </Text>
            <ErrorBoundary fallbackMessage="Quick actions encountered an error">
              <CampusActionStudio
                claimableItems={claimableItems}
                claimIntentItemId={claimIntentItemId || undefined}
                claimIntentNonce={claimIntentNonce}
                compact
                layout="quick"
                onActionsFinished={handleStudioActionsFinished}
              />
            </ErrorBoundary>
          </View>
        </Animated.View>
      </ScrollView>

      {isTutorialVisible && activeTutorialStep ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.tutorialFloatingWrap,
            tutorialPlacement === 'top'
              ? { top: Math.max(insets.top + 72, 72) }
              : { bottom: insets.bottom + 84 },
          ]}
        >
          <View
            onLayout={(event) => {
              const nextHeight = event.nativeEvent.layout.height;
              if (Math.abs(nextHeight - tutorialCardHeight) < 2) {
                return;
              }

              setTutorialCardHeight(nextHeight);
            }}
            style={[styles.tutorialFloatingCard, { maxHeight: windowHeight * 0.52 }]}
          >
            <View style={styles.tutorialHeaderRow}>
              <Text style={styles.tutorialEyebrow}>
                Step {tutorialStepIndex + 1} of {HOME_TUTORIAL_STEPS.length}
              </Text>

              <Pressable onPress={() => closeTutorial(true)} style={styles.tutorialSkipButton}>
                <Text style={styles.tutorialSkipButtonText}>Skip</Text>
              </Pressable>
            </View>

            <Text style={styles.tutorialTitle}>{activeTutorialStep.title}</Text>
            <Text style={styles.tutorialDescription}>{activeTutorialStep.description}</Text>

            <View style={styles.tutorialTipRow}>
              <MaterialIcons color={colors.primary} name="lightbulb-outline" size={14} />
              <Text style={styles.tutorialTipText}>{activeTutorialStep.tip}</Text>
            </View>

            <View style={styles.tutorialDotsRow}>
              {HOME_TUTORIAL_STEPS.map((step, index) => {
                const isActiveDot = index === tutorialStepIndex;

                return (
                  <View
                    key={`${step.target}-${index}`}
                    style={[styles.tutorialDot, isActiveDot ? styles.tutorialDotActive : undefined]}
                  />
                );
              })}
            </View>

            <View style={styles.tutorialActionsRow}>
              <Pressable
                disabled={tutorialStepIndex === 0}
                onPress={handleTutorialBack}
                style={({ pressed }) => [
                  styles.tutorialBackButton,
                  tutorialStepIndex === 0 ? styles.tutorialBackButtonDisabled : undefined,
                  pressed && tutorialStepIndex !== 0 ? styles.tutorialButtonPressed : undefined,
                ]}
              >
                <Text style={styles.tutorialBackButtonText}>Back</Text>
              </Pressable>

              <Pressable
                onPress={handleTutorialNext}
                style={({ pressed }) => [
                  styles.tutorialNextButton,
                  pressed ? styles.tutorialButtonPressed : undefined,
                ]}
              >
                <Text style={styles.tutorialNextButtonText}>
                  {tutorialStepIndex >= HOME_TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
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
  contentTutorialActive: {
    paddingBottom: 360,
  },
  heroCard: {
    ...shadows.soft,
    backgroundColor: '#F0F4FF',
    borderColor: '#D7DFFF',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  heroHeaderRow: {
    flexDirection: 'row',
  },
  heroHeaderBody: {
    flex: 1,
  },
  heroTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 30,
    letterSpacing: -0.8,
  },
  heroSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  heroTutorialButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E6EDFF',
    borderColor: '#C8D5FF',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroTutorialButtonPressed: {
    opacity: 0.84,
  },
  heroTutorialButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  heroStepsRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  heroStepChip: {
    alignItems: 'center',
    backgroundColor: '#E2EAFF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroStepText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  approvedClaimSection: {
    marginBottom: 12,
  },
  approvedClaimHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8,
  },
  approvedClaimTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 15,
    marginLeft: 6,
  },
  approvedClaimCard: {
    backgroundColor: '#EAF3FF',
    borderColor: '#CFE1FA',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 8,
    padding: 10,
  },
  approvedClaimTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  approvedClaimItemTitle: {
    color: colors.primary,
    flex: 1,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 13,
    marginRight: 8,
  },
  approvedClaimAgo: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  approvedClaimLocation: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 4,
  },
  approvedClaimButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  approvedClaimButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  approvedPopupBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  approvedPopupCard: {
    ...shadows.strong,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    width: '100%',
  },
  approvedPopupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  approvedPopupIconBubble: {
    alignItems: 'center',
    backgroundColor: '#EAF8F0',
    borderRadius: radii.pill,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  approvedPopupTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 22,
    marginLeft: 8,
  },
  approvedPopupSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  approvedPopupInfoCard: {
    backgroundColor: '#EDF4FF',
    borderColor: '#D4E1FF',
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 12,
    padding: 10,
  },
  approvedPopupInfoTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 14,
  },
  approvedPopupInfoMeta: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 3,
  },
  approvedPopupActionRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  approvedPopupPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  approvedPopupPrimaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  approvedPopupSecondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 38,
  },
  approvedPopupSecondaryButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    height: 52,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
  },
  searchCameraDivider: {
    backgroundColor: 'rgba(118, 118, 131, 0.22)',
    height: 18,
    marginHorizontal: 8,
    width: 1,
  },
  searchCameraButton: {
    alignItems: 'center',
    backgroundColor: '#E8EEFF',
    borderRadius: radii.pill,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  aiNoticeWrap: {
    alignItems: 'center',
    backgroundColor: '#EDF4FF',
    borderColor: '#D1E2FF',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  aiNoticeText: {
    color: colors.primary,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  aiModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  aiModalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    width: '100%',
  },
  aiModalBadgeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  aiModalBadge: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  aiModalBadgeFound: {
    backgroundColor: '#E7F7ED',
  },
  aiModalBadgeMiss: {
    backgroundColor: '#FFEAEA',
  },
  aiModalBadgeText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  aiModalBadgeTextFound: {
    color: '#1A663A',
  },
  aiModalBadgeTextMiss: {
    color: colors.error,
  },
  aiModalTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  aiModalSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  aiModalPreviewWrap: {
    marginTop: 12,
  },
  aiModalPreviewImage: {
    borderRadius: 12,
    height: 150,
    width: '100%',
  },
  aiModalPreviewFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: 12,
    height: 150,
    justifyContent: 'center',
  },
  aiModalItemMeta: {
    marginTop: 10,
  },
  aiModalItemTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 15,
  },
  aiModalItemSubtext: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 3,
  },
  aiModalItemSubtextCenter: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  aiModalActionRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  aiModalPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  aiModalPrimaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  aiModalSecondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  aiModalSecondaryButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  chipsWrap: {
    marginBottom: 10,
  },
  chipsContent: {
    paddingRight: 8,
  },
  filterChip: {
    borderRadius: radii.pill,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipIdle: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.2)',
    borderWidth: 1,
  },
  filterChipText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  filterChipTextActive: {
    color: colors.onPrimary,
  },
  sortRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  sortButton: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.2)',
    borderRadius: radii.pill,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sortButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  sortButtonTextActive: {
    color: colors.onPrimary,
  },
  resetButton: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  resetText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    width: '31.5%',
  },
  statLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statValue: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
    marginTop: 4,
  },
  statValueCompact: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 13,
    marginTop: 5,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  sectionTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 21,
  },
  sectionMeta: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  clearFocusButton: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    marginRight: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  clearFocusText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inlineErrorWrap: {
    alignItems: 'center',
    backgroundColor: '#FFE8E8',
    borderColor: '#F2C6C6',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineErrorText: {
    color: colors.error,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    marginTop: 10,
  },
  emptyStateCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 10,
    padding: 20,
  },
  emptyTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 18,
    marginTop: 8,
  },
  emptySubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  itemCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.16)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    overflow: 'hidden',
  },
  itemCardHighlighted: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  itemImage: {
    height: 108,
    width: 94,
  },
  itemImageFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    height: 108,
    justifyContent: 'center',
    width: 94,
  },
  itemContent: {
    flex: 1,
    padding: 10,
  },
  itemTopRow: {
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  itemTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 16,
    marginBottom: 6,
    paddingRight: 4,
  },
  itemCategoryPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  itemCategoryText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  itemMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  itemMetaText: {
    color: colors.onSurfaceVariant,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 3,
  },
  itemBottomRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  itemAgo: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  itemScore: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
  },
  itemClaimButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  itemClaimButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 5,
    textTransform: 'uppercase',
  },
  toolsWrap: {
    marginTop: 8,
  },
  toolsTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
    marginBottom: 4,
  },
  toolsSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  tutorialSectionActive: {
    backgroundColor: 'rgba(248, 250, 255, 0.95)',
    borderColor: '#7C96FF',
    borderRadius: radii.lg,
    borderWidth: 2,
    marginBottom: 12,
    paddingHorizontal: 6,
    paddingTop: 6,
    shadowColor: '#2D3E73',
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowRadius: 14,
  },
  tutorialSectionMuted: {
    opacity: 0.36,
  },
  tutorialFloatingWrap: {
    left: 14,
    position: 'absolute',
    right: 14,
    zIndex: 50,
  },
  tutorialFloatingCard: {
    ...shadows.strong,
    backgroundColor: '#101F46',
    borderColor: '#324B8E',
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tutorialHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tutorialEyebrow: {
    color: '#AFC2FF',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  tutorialSkipButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  tutorialSkipButtonText: {
    color: '#D6DEFF',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  tutorialTitle: {
    color: '#FFFFFF',
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
    marginTop: 8,
  },
  tutorialDescription: {
    color: '#D6DEFF',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  tutorialTipRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radii.md,
    flexDirection: 'row',
    marginTop: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  tutorialTipText: {
    color: '#F2F6FF',
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  tutorialDotsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 10,
  },
  tutorialDot: {
    backgroundColor: 'rgba(210, 220, 255, 0.35)',
    borderRadius: radii.pill,
    height: 6,
    marginRight: 6,
    width: 6,
  },
  tutorialDotActive: {
    backgroundColor: '#FFFFFF',
    width: 18,
  },
  tutorialActionsRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  tutorialBackButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 40,
  },
  tutorialBackButtonDisabled: {
    opacity: 0.45,
  },
  tutorialBackButtonText: {
    color: '#E8EEFF',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tutorialNextButton: {
    alignItems: 'center',
    backgroundColor: '#7E98FF',
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  tutorialNextButtonText: {
    color: '#0D1E4A',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tutorialButtonPressed: {
    opacity: 0.82,
  },
});