import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { CampusActionStudio } from '../components/CampusActionStudio';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { backendEnv } from '../config/env';
import { markTutorialCompleted, shouldShowTutorial } from '../lib/tutorialSeen';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const HISTORY_TUTORIAL_STORAGE_KEY = 'history-onboarding-tour-seen-v1';

type HistoryTutorialTarget = 'hero' | 'flow' | 'quick-nav' | 'timeline';

type HistoryTutorialStep = {
  target: HistoryTutorialTarget;
  title: string;
  description: string;
  tip: string;
};

const HISTORY_TUTORIAL_STEPS: HistoryTutorialStep[] = [
  {
    target: 'hero',
    title: 'History Command Center',
    description:
      'Use this page to track every claim request and quickly continue where each request left off.',
    tip: 'The highlighted claim opens directly when coming from notifications.',
  },
  {
    target: 'flow',
    title: 'Follow The Action Flow',
    description:
      'This checklist mirrors the ideal lifecycle: filter, review messages, then confirm final pickup steps.',
    tip: 'Treat this flow as your safety sequence before handing over any item.',
  },
  {
    target: 'quick-nav',
    title: 'Filter Fast With Quick Nav',
    description:
      'Switch between All, Needs Action, Active, and Completed to reduce clutter and find urgent work faster.',
    tip: 'Needs Action is best when you want pending decisions first.',
  },
  {
    target: 'timeline',
    title: 'Use The Claim Timeline',
    description:
      'Open each claim card to chat, approve or reject requests, and confirm pickup completion in one place.',
    tip: 'Use focused chat before final handover to avoid ownership mistakes.',
  },
];

type HistoryRouteParams = {
  focusRequestId?: string;
  focusFoundItemId?: string;
  focusNonce?: number;
  autoOpenMessages?: boolean;
};

type HistoryRoute = RouteProp<{ History: HistoryRouteParams | undefined }, 'History'>;

type HistoryTabParamList = {
  Home: undefined;
  Map: undefined;
  Report: undefined;
  History: HistoryRouteParams | undefined;
  Profile: undefined;
  Settings: undefined;
};

type HistoryQuickView = 'all' | 'needs-action' | 'active' | 'completed';

function readText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
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

export function HistoryScreen() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const route = useRoute<HistoryRoute>();
  const navigation = useNavigation<BottomTabNavigationProp<HistoryTabParamList, 'History'>>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const getTokenRef = useRef(getToken);
  const tutorialCardOpacity = useRef(new Animated.Value(0)).current;
  const tutorialCardOffset = useRef(new Animated.Value(18)).current;
  const currentUserId = readText(user?.id);
  const userCreatedAtMs = useMemo(() => resolveTimestampMs(user?.createdAt), [user?.createdAt]);
  const tutorialSyncOptions = useMemo(
    () => ({
      tutorialKey: HISTORY_TUTORIAL_STORAGE_KEY,
      userId: currentUserId,
      backendBaseUrl: backendEnv.backendUrl,
      getToken: async () => await getTokenRef.current().catch(() => null),
      userCreatedAtMs,
    }),
    [currentUserId, userCreatedAtMs],
  );
  const hasFocusedClaim = Boolean(route.params?.focusRequestId);
  const [historyQuickView, setHistoryQuickView] = useState<HistoryQuickView>('all');
  const [isTutorialVisible, setIsTutorialVisible] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [tutorialLayouts, setTutorialLayouts] = useState<
    Partial<Record<HistoryTutorialTarget, { y: number; height: number }>>
  >({});
  const [tutorialPlacement, setTutorialPlacement] = useState<'top' | 'bottom'>('bottom');
  const [tutorialCardHeight, setTutorialCardHeight] = useState(0);
  const [hasTutorialBeenSeen, setHasTutorialBeenSeen] = useState(true);

  const activeTutorialStep = HISTORY_TUTORIAL_STEPS[tutorialStepIndex] ?? HISTORY_TUTORIAL_STEPS[0];
  const showTutorialEntry = Boolean(currentUserId) && !hasTutorialBeenSeen;

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const historyQuickNavItems = useMemo(
    () => [
      { key: 'all', label: 'All Claims', icon: 'view-list' },
      { key: 'needs-action', label: 'Needs Action', icon: 'bolt' },
      { key: 'active', label: 'Active', icon: 'autorenew' },
      { key: 'completed', label: 'Completed', icon: 'task-alt' },
    ] as const,
    [],
  );

  const recordTutorialLayout = useCallback(
    (target: HistoryTutorialTarget) => (event: LayoutChangeEvent) => {
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
    if (tutorialStepIndex >= HISTORY_TUTORIAL_STEPS.length - 1) {
      closeTutorial(true);
      return;
    }

    setTutorialStepIndex((previous) => Math.min(previous + 1, HISTORY_TUTORIAL_STEPS.length - 1));
  }, [closeTutorial, tutorialStepIndex]);

  const resolveTutorialSectionStyle = useCallback(
    (target: HistoryTutorialTarget) => {
      if (!isTutorialVisible || !activeTutorialStep) {
        return undefined;
      }

      if (activeTutorialStep.target === target) {
        return styles.tutorialSectionActive;
      }

      return styles.tutorialSectionMuted;
    },
    [activeTutorialStep, isTutorialVisible],
  );

  useEffect(() => {
    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const maybeShowTutorial = async () => {
      if (!tutorialSyncOptions.userId) {
        setHasTutorialBeenSeen(true);
        setIsTutorialVisible(false);
        setTutorialStepIndex(0);
        return;
      }

      const shouldShow = await shouldShowTutorial(tutorialSyncOptions);

      if (!isMounted) {
        return;
      }

      if (!shouldShow) {
        setHasTutorialBeenSeen(true);
        return;
      }

      setHasTutorialBeenSeen(false);

      timer = setTimeout(() => {
        if (!isMounted) {
          return;
        }

        setTutorialStepIndex(0);
        setIsTutorialVisible(true);
      }, 520);
    };

    void maybeShowTutorial();

    return () => {
      isMounted = false;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [tutorialSyncOptions]);

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
      nextPlacement === 'top' ? Math.max(tutorialCardHeight + 102, 300) : 102;

    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(targetLayout.y - scrollOffset, 0),
        animated: true,
      });
    }, 90);

    return () => {
      clearTimeout(timer);
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
    if (!isTutorialVisible) {
      tutorialCardOpacity.setValue(0);
      tutorialCardOffset.setValue(18);
      return;
    }

    Animated.parallel([
      Animated.timing(tutorialCardOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(tutorialCardOffset, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isTutorialVisible, tutorialCardOffset, tutorialCardOpacity]);

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
        ref={scrollViewRef}
        contentContainerStyle={[styles.content, isTutorialVisible ? styles.contentTutorialActive : undefined]}
        showsVerticalScrollIndicator={false}
      >
        <View onLayout={recordTutorialLayout('hero')} style={resolveTutorialSectionStyle('hero')}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <Text style={styles.headerTitle}>Claim History Center</Text>

              <View style={styles.heroActionsWrap}>
                {showTutorialEntry ? (
                  <Pressable onPress={startTutorial} style={styles.tutorialReplayButton}>
                    <MaterialIcons color={colors.primary} name="tips-and-updates" size={12} />
                    <Text style={styles.tutorialReplayButtonText}>Tutorial</Text>
                  </Pressable>
                ) : null}

                <View style={styles.heroBadge}>
                  <MaterialIcons color={colors.onPrimary} name="history" size={14} />
                  <Text style={styles.heroBadgeText}>Live</Text>
                </View>
              </View>
            </View>

            <Text style={styles.headerSubtitle}>
              Track every request, review approvals, chat with claimants, and close pickups from one place.
            </Text>

            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaChip}>
                <MaterialIcons color={colors.primary} name="bolt" size={14} />
                <Text style={styles.heroMetaChipText}>Action-first timeline</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <MaterialIcons color={colors.primary} name="chat-bubble-outline" size={14} />
                <Text style={styles.heroMetaChipText}>Chat before handover</Text>
              </View>
            </View>
          </View>
        </View>

        {hasFocusedClaim ? (
          <View style={styles.focusBanner}>
            <MaterialIcons color={colors.primary} name="stars" size={16} />
            <Text style={styles.focusBannerText}>Opened from notification: your selected claim is highlighted below.</Text>
          </View>
        ) : null}

        <View onLayout={recordTutorialLayout('flow')} style={resolveTutorialSectionStyle('flow')}>
          <View style={styles.flowCard}>
            <View style={styles.flowStep}>
              <MaterialIcons color={colors.primary} name="filter-list" size={14} />
              <Text style={styles.flowStepText}>Filter by active, completed, or all</Text>
            </View>
            <View style={styles.flowStep}>
              <MaterialIcons color={colors.primary} name="rate-review" size={14} />
              <Text style={styles.flowStepText}>Review or confirm actions quickly</Text>
            </View>
            <View style={styles.flowStepLast}>
              <MaterialIcons color={colors.primary} name="task-alt" size={14} />
              <Text style={styles.flowStepText}>Finish pickup and keep history clean</Text>
            </View>
          </View>
        </View>

        <View onLayout={recordTutorialLayout('quick-nav')} style={resolveTutorialSectionStyle('quick-nav')}>
          <View style={styles.quickNavCard}>
            <Text style={styles.quickNavTitle}>History Quick Navigation</Text>
            <View style={styles.quickNavRow}>
              {historyQuickNavItems.map((item) => {
                const selected = historyQuickView === item.key;

                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setHistoryQuickView(item.key)}
                    style={[styles.quickNavButton, selected ? styles.quickNavButtonActive : undefined]}
                  >
                    <MaterialIcons
                      color={selected ? colors.onPrimary : colors.onSurfaceVariant}
                      name={item.icon}
                      size={14}
                    />
                    <Text style={[styles.quickNavButtonText, selected ? styles.quickNavButtonTextActive : undefined]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View onLayout={recordTutorialLayout('timeline')} style={resolveTutorialSectionStyle('timeline')}>
          <ErrorBoundary fallbackMessage="Claim history encountered an error">
            <CampusActionStudio
              autoOpenFocusedClaimMessages={Boolean(route.params?.autoOpenMessages)}
              focusClaimNonce={route.params?.focusNonce ?? 0}
              focusClaimRequestId={route.params?.focusRequestId}
              historyQuickView={historyQuickView}
              layout="history"
            />
          </ErrorBoundary>
        </View>
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
          <Animated.View
            onLayout={(event) => {
              const nextHeight = event.nativeEvent.layout.height;
              if (Math.abs(nextHeight - tutorialCardHeight) < 2) {
                return;
              }

              setTutorialCardHeight(nextHeight);
            }}
            style={[
              styles.tutorialFloatingCard,
              { maxHeight: windowHeight * 0.52 },
              {
                opacity: tutorialCardOpacity,
                transform: [{ translateY: tutorialCardOffset }],
              },
            ]}
          >
            <View style={styles.tutorialHeaderRow}>
              <Text style={styles.tutorialEyebrow}>
                Step {tutorialStepIndex + 1} of {HISTORY_TUTORIAL_STEPS.length}
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
              {HISTORY_TUTORIAL_STEPS.map((step, index) => (
                <View
                  key={`${step.target}-${index}`}
                  style={[styles.tutorialDot, index === tutorialStepIndex ? styles.tutorialDotActive : undefined]}
                />
              ))}
            </View>

            <View style={styles.tutorialActionsRow}>
              <Pressable
                disabled={tutorialStepIndex === 0}
                onPress={handleTutorialBack}
                style={[
                  styles.tutorialBackButton,
                  tutorialStepIndex === 0 ? styles.tutorialBackButtonDisabled : undefined,
                ]}
              >
                <Text style={styles.tutorialBackButtonText}>Back</Text>
              </Pressable>

              <Pressable onPress={handleTutorialNext} style={styles.tutorialNextButton}>
                <Text style={styles.tutorialNextButtonText}>
                  {tutorialStepIndex >= HISTORY_TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
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
    paddingBottom: 26,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  contentTutorialActive: {
    paddingBottom: 360,
  },
  heroCard: {
    ...shadows.soft,
    backgroundColor: '#EEF4FF',
    borderColor: '#CFDDFF',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  heroTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  heroActionsWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    marginLeft: 'auto',
    marginTop: 4,
  },
  tutorialReplayButton: {
    alignItems: 'center',
    backgroundColor: '#E6EEFF',
    borderColor: '#CEDBFF',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 4,
    marginRight: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tutorialReplayButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  heroBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  heroBadgeText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  heroMetaChip: {
    alignItems: 'center',
    backgroundColor: '#DFEAFF',
    borderColor: '#CBDBFA',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  heroMetaChipText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  focusBanner: {
    alignItems: 'center',
    backgroundColor: '#F1F6FF',
    borderColor: '#D6E3FA',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  focusBannerText: {
    color: colors.primary,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    lineHeight: 17,
    marginLeft: 6,
  },
  flowCard: {
    backgroundColor: '#FCFDFF',
    borderColor: '#DEE6F8',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  flowStep: {
    alignItems: 'center',
    borderBottomColor: '#E4EAF7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: 8,
    paddingTop: 5,
  },
  flowStepLast: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 4,
    paddingTop: 5,
  },
  flowStepText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 6,
  },
  quickNavCard: {
    backgroundColor: '#F8FAFF',
    borderColor: '#DEE7FA',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  quickNavTitle: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.3,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  quickNavRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginRight: -8,
  },
  quickNavButton: {
    alignItems: 'center',
    backgroundColor: '#EDF3FF',
    borderColor: '#D9E5FA',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  quickNavButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickNavButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  quickNavButtonTextActive: {
    color: colors.onPrimary,
  },
  headerTitle: {
    color: colors.primary,
    flexShrink: 1,
    fontFamily: fontFamily.headlineBold,
    fontSize: 24,
    letterSpacing: -0.5,
    paddingRight: 8,
  },
  headerSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  tutorialSectionActive: {
    borderColor: '#8BA2FF',
    borderRadius: radii.lg,
    borderWidth: 2,
    marginBottom: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  tutorialSectionMuted: {
    opacity: 0.34,
  },
  tutorialFloatingWrap: {
    left: 14,
    position: 'absolute',
    right: 14,
    zIndex: 50,
  },
  tutorialFloatingCard: {
    ...shadows.strong,
    backgroundColor: '#0F204C',
    borderColor: '#314A88',
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
});
