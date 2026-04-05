import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useUser } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { backendEnv } from '../config/env';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

type StudioMode = 'lost' | 'claim' | 'found';
type AiAssistPhase = 'analyzing' | 'review';

type AiAssistDraft = {
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedLocation: string;
  detectedLabel: string;
  detectedCategory: string;
  confidencePercent: number;
  tags: string[];
};

type PickedImage = {
  uri: string;
  base64: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
};

type ScanDetection = {
  label: string;
  category: string;
  confidence: number;
  tags: string[];
};

type ScanResult = {
  detection: ScanDetection;
  imageUrl: string | null;
};

type LostBoardItem = {
  id: string;
  title: string;
  category: string;
  expected_location: string | null;
  image_url: string | null;
  created_at: string | null;
  ai_detected_label: string | null;
};

type IncomingClaim = {
  id: string;
  match_score: number;
  status: string;
  created_at: string | null;
  proof_image_url: string | null;
  ai_detected_label: string | null;
  claimant_user_id: string;
  reviewer_user_id: string | null;
  reviewed_at: string | null;
  pickup_confirmed_at: string | null;
  pickup_confirmed_by: string | null;
  pickup_editable_until: string | null;
  pickup_is_editable: boolean;
  pickup_edit_seconds_remaining: number;
  found_item: {
    id: string;
    title: string;
    location: string;
    category: string;
    image_url: string | null;
    created_by?: string;
  };
  lost_item: {
    id: string;
    title: string;
    category: string;
    expected_location: string | null;
  } | null;
};

type ClaimableItemOption = {
  id: string;
  title: string;
  category: string;
  location: string;
  image_url: string | null;
};

type ClaimMessage = {
  id: string;
  sender_user_id: string;
  message_text: string;
  created_at: string | null;
};

type HistoryFilter = 'all' | 'active' | 'completed';
type StudioLayout = 'full' | 'quick' | 'history';

type PointsActivity = {
  id: number;
  points: number;
  reason: string;
  created_at: string;
};

type PointsSummary = {
  totalPoints: number;
  level: string;
  recentActivity: PointsActivity[];
};

type CampusActionStudioProps = {
  onActionsFinished?: () => Promise<void> | void;
  compact?: boolean;
  layout?: StudioLayout;
  claimableItems?: ClaimableItemOption[];
  claimIntentItemId?: string;
  claimIntentNonce?: number;
  focusClaimRequestId?: string;
  focusClaimNonce?: number;
  autoOpenFocusedClaimMessages?: boolean;
};

const LEVEL_STEPS = [
  { level: 'Seed', min: 0, max: 49, next: 'Scout', nextTarget: 50 },
  { level: 'Scout', min: 50, max: 149, next: 'Tracker', nextTarget: 150 },
  { level: 'Tracker', min: 150, max: 349, next: 'Guardian', nextTarget: 350 },
  { level: 'Guardian', min: 350, max: 699, next: 'Champion', nextTarget: 700 },
  { level: 'Champion', min: 700, max: 1199, next: 'Legend', nextTarget: 1200 },
  { level: 'Legend', min: 1200, max: Number.MAX_SAFE_INTEGER, next: null, nextTarget: null },
] as const;

const AI_ANALYSIS_STEPS = [
  'Reading image details',
  'Detecting item category',
  'Drafting title and description',
  'Checking confidence level',
  'Preparing autofill suggestion',
] as const;

function safeString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function safeNumber(value: unknown): number {
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

function isMissingMessagesTableIssue(message: string): boolean {
  const normalized = safeString(message).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('match_request_messages') &&
    (normalized.includes('schema cache') ||
      normalized.includes('could not find the table') ||
      normalized.includes('does not exist'))
  );
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return 'recently';
  }

  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return 'recently';
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

function formatReason(reason: string): string {
  const normalized = reason
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return 'activity';
  }

  return normalized[0].toUpperCase() + normalized.slice(1);
}

function formatStatusLabel(status: string): string {
  const normalized = safeString(status).replace(/_/g, ' ');
  if (!normalized) {
    return 'unknown';
  }

  return normalized[0].toUpperCase() + normalized.slice(1);
}

function resolveStatusTone(status: string): { bg: string; fg: string } {
  if (status === 'submitted') {
    return {
      bg: '#FFF4E5',
      fg: '#8A5318',
    };
  }

  if (status === 'approved') {
    return {
      bg: '#E8F7ED',
      fg: '#1C6E44',
    };
  }

  if (status === 'rejected') {
    return {
      bg: '#FFE8E8',
      fg: '#A13232',
    };
  }

  if (status === 'picked_up') {
    return {
      bg: '#E8EEFF',
      fg: '#2B4D9E',
    };
  }

  return {
    bg: colors.surfaceLow,
    fg: colors.onSurfaceVariant,
  };
}

function minutesLeft(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }

  return Math.ceil(seconds / 60);
}

function normalizeScanDetection(value: unknown): ScanDetection {
  if (!value || typeof value !== 'object') {
    return {
      label: 'Personal Item',
      category: 'General',
      confidence: 0.35,
      tags: ['campus'],
    };
  }

  const record = value as Record<string, unknown>;

  const tagsValue = Array.isArray(record.tags)
    ? record.tags
        .map((entry) => safeString(entry))
        .filter((entry) => Boolean(entry))
        .slice(0, 6)
    : [];

  return {
    label: safeString(record.label) || 'Personal Item',
    category: safeString(record.category) || 'General',
    confidence: Math.max(0, Math.min(1, safeNumber(record.confidence) || 0.35)),
    tags: tagsValue.length ? tagsValue : ['campus'],
  };
}

function createAiAssistDraft(
  mode: StudioMode,
  detection: ScanDetection,
  suggestedLocation: string,
): AiAssistDraft {
  const rawLabel = safeString(detection.label) || 'Item';
  const normalizedLabel = rawLabel
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (value) => value.toUpperCase());

  const confidencePercent = Math.round(
    Math.max(0, Math.min(1, safeNumber(detection.confidence) || 0)) * 100,
  );

  const normalizedTags = detection.tags.filter((tag) => Boolean(safeString(tag))).slice(0, 4);
  const tagsText = normalizedTags.length ? normalizedTags.join(', ') : 'No extra tags';

  const suggestedTitle = mode === 'lost' ? `Lost ${normalizedLabel}` : `Found ${normalizedLabel}`;

  const suggestedDescription =
    mode === 'lost'
      ? `I lost this item near campus. AI detected "${normalizedLabel}" in category "${detection.category}" with ${confidencePercent}% confidence. Distinguishing signs: ${tagsText}.`
      : `Found this item near ${suggestedLocation || 'campus area'}. AI detected "${normalizedLabel}" in category "${detection.category}" with ${confidencePercent}% confidence. Distinguishing signs: ${tagsText}.`;

  return {
    suggestedTitle,
    suggestedDescription,
    suggestedLocation,
    detectedLabel: normalizedLabel,
    detectedCategory: detection.category,
    confidencePercent,
    tags: normalizedTags,
  };
}

function normalizeIncomingClaim(value: unknown): IncomingClaim | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  const foundItemRaw =
    row.found_item && typeof row.found_item === 'object'
      ? (row.found_item as Record<string, unknown>)
      : null;

  if (!foundItemRaw) {
    return null;
  }

  const foundItemId = safeString(foundItemRaw.id);
  if (!foundItemId) {
    return null;
  }

  const lostItemRaw =
    row.lost_item && typeof row.lost_item === 'object'
      ? (row.lost_item as Record<string, unknown>)
      : null;

  return {
    id: safeString(row.id),
    match_score: Math.max(0, safeNumber(row.match_score)),
    status: safeString(row.status) || 'submitted',
    created_at: safeString(row.created_at) || null,
    proof_image_url: safeString(row.proof_image_url) || null,
    ai_detected_label: safeString(row.ai_detected_label) || null,
    claimant_user_id: safeString(row.claimant_user_id),
    reviewer_user_id: safeString(row.reviewer_user_id) || null,
    reviewed_at: safeString(row.reviewed_at) || null,
    pickup_confirmed_at: safeString(row.pickup_confirmed_at) || null,
    pickup_confirmed_by: safeString(row.pickup_confirmed_by) || null,
    pickup_editable_until: safeString(row.pickup_editable_until) || null,
    pickup_is_editable: Boolean(row.pickup_is_editable),
    pickup_edit_seconds_remaining: Math.max(0, safeNumber(row.pickup_edit_seconds_remaining)),
    found_item: {
      id: foundItemId,
      title: safeString(foundItemRaw.title) || 'Found item',
      location: safeString(foundItemRaw.location) || 'Campus location',
      category: safeString(foundItemRaw.category) || 'General',
      image_url: safeString(foundItemRaw.image_url) || null,
      created_by: safeString(foundItemRaw.created_by) || undefined,
    },
    lost_item: lostItemRaw
      ? {
          id: safeString(lostItemRaw.id),
          title: safeString(lostItemRaw.title) || 'Lost item',
          category: safeString(lostItemRaw.category) || 'General',
          expected_location: safeString(lostItemRaw.expected_location) || null,
        }
      : null,
  };
}

function nextLevelProgress(points: number): { nextLabel: string; remaining: number; ratio: number } {
  const step =
    LEVEL_STEPS.find((entry) => points >= entry.min && points <= entry.max) || LEVEL_STEPS[0];

  if (!step.next || !step.nextTarget) {
    return {
      nextLabel: 'Legend maxed',
      remaining: 0,
      ratio: 1,
    };
  }

  const span = step.nextTarget - step.min;
  const progressed = Math.max(points - step.min, 0);

  return {
    nextLabel: step.next,
    remaining: Math.max(step.nextTarget - points, 0),
    ratio: span > 0 ? Math.max(0, Math.min(1, progressed / span)) : 0,
  };
}

export function CampusActionStudio({
  onActionsFinished,
  compact = false,
  layout = 'full',
  claimableItems = [],
  claimIntentItemId,
  claimIntentNonce = 0,
  focusClaimRequestId,
  focusClaimNonce = 0,
  autoOpenFocusedClaimMessages = false,
}: CampusActionStudioProps) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  const lastHandledClaimIntentNonceRef = useRef(0);
  const localMessagesByClaimRef = useRef<Record<string, ClaimMessage[]>>({});
  const currentUserId = safeString(user?.id);

  const backendBaseUrl = useMemo(() => backendEnv.backendUrl.replace(/\/+$/, ''), []);

  const [points, setPoints] = useState<PointsSummary>({
    totalPoints: 0,
    level: 'Seed',
    recentActivity: [],
  });
  const [lostBoard, setLostBoard] = useState<LostBoardItem[]>([]);
  const [incomingClaims, setIncomingClaims] = useState<IncomingClaim[]>([]);
  const [claimHistory, setClaimHistory] = useState<IncomingClaim[]>([]);
  const [panelError, setPanelError] = useState('');
  const [panelNotice, setPanelNotice] = useState('');
  const [isPanelLoading, setIsPanelLoading] = useState(true);
  const [isResolvingClaimId, setIsResolvingClaimId] = useState('');
  const [isConfirmingPickupId, setIsConfirmingPickupId] = useState('');
  const [isRevertingPickupId, setIsRevertingPickupId] = useState('');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [focusedHistoryClaimId, setFocusedHistoryClaimId] = useState('');

  const [pickupNotice, setPickupNotice] = useState<{
    visible: boolean;
    claimId: string;
    secondsRemaining: number;
  }>({
    visible: false,
    claimId: '',
    secondsRemaining: 0,
  });

  const [isMessagesModalVisible, setIsMessagesModalVisible] = useState(false);
  const [messagesClaim, setMessagesClaim] = useState<IncomingClaim | null>(null);
  const [messages, setMessages] = useState<ClaimMessage[]>([]);
  const [messagesInput, setMessagesInput] = useState('');
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [isMessagingActive, setIsMessagingActive] = useState(true);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [mode, setMode] = useState<StudioMode>('lost');

  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationHint, setLocationHint] = useState('');
  const [selectedClaimItemId, setSelectedClaimItemId] = useState('');
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [isAiAssistModalVisible, setIsAiAssistModalVisible] = useState(false);
  const [aiAssistPhase, setAiAssistPhase] = useState<AiAssistPhase>('analyzing');
  const [aiAssistStepIndex, setAiAssistStepIndex] = useState(0);
  const [aiAssistDraft, setAiAssistDraft] = useState<AiAssistDraft | null>(null);

  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const levelProgress = useMemo(
    () => nextLevelProgress(points.totalPoints),
    [points.totalPoints],
  );

  const quickWidgetMetrics = useMemo(
    () => ({
      openLostCount: lostBoard.length,
      pendingClaimsCount: incomingClaims.length,
      recentRewards: points.recentActivity.filter((entry) => entry.points > 0).length,
      historyCount: claimHistory.length,
    }),
    [claimHistory.length, incomingClaims.length, lostBoard.length, points.recentActivity],
  );

  const showComposerSections = layout !== 'history';
  const showClaimOperations = layout !== 'quick';
  const showLostBoard = layout !== 'history';

  const pickupQueue = useMemo(
    () =>
      claimHistory
        .filter(
          (entry) =>
            entry.status === 'approved' &&
            safeString(entry.found_item.created_by) === currentUserId,
        )
        .slice(0, compact ? 1 : 4),
    [claimHistory, compact, currentUserId],
  );

  const filteredHistory = useMemo(() => {
    const filtered = claimHistory.filter((entry) => {
      if (historyFilter === 'active') {
        return entry.status === 'submitted' || entry.status === 'approved';
      }

      if (historyFilter === 'completed') {
        return entry.status !== 'submitted' && entry.status !== 'approved';
      }

      return true;
    });

    return filtered.slice(0, compact ? 3 : 8);
  }, [claimHistory, compact, historyFilter]);

  const historyOverview = useMemo(() => {
    const active = claimHistory.filter(
      (entry) => entry.status === 'submitted' || entry.status === 'approved',
    ).length;
    const completed = claimHistory.filter(
      (entry) => entry.status !== 'submitted' && entry.status !== 'approved',
    ).length;

    return {
      all: claimHistory.length,
      active,
      completed,
    };
  }, [claimHistory]);

  const historyEmptySubtitle = useMemo(() => {
    if (historyFilter === 'active') {
      return 'No active approved claims right now.';
    }

    if (historyFilter === 'completed') {
      return 'No completed or closed claims yet.';
    }

    return 'No claim activity recorded yet.';
  }, [historyFilter]);

  const selectedClaimItem = useMemo(
    () => claimableItems.find((item) => item.id === selectedClaimItemId) ?? null,
    [claimableItems, selectedClaimItemId],
  );

  const readResponseError = useCallback(async (response: Response): Promise<string> => {
    if (response.status === 404) {
      return 'This feature route is not available on the backend yet.';
    }

    try {
      const payload = (await response.json()) as { error?: unknown; details?: unknown };

      const errorMessage = safeString(payload.error);
      const detailsMessage = safeString(payload.details);

      if (errorMessage && detailsMessage) {
        return `${errorMessage}: ${detailsMessage}`;
      }

      return errorMessage || detailsMessage || `Request failed (${response.status})`;
    } catch {
      return `Request failed (${response.status})`;
    }
  }, []);

  const authedJsonRequest = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const token = await getTokenRef.current();

      if (!token) {
        throw new Error('You need to be signed in to continue.');
      }

      const response = await fetch(`${backendBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      return (await response.json()) as Record<string, unknown>;
    },
    [backendBaseUrl, readResponseError],
  );

  const authedGetRequest = useCallback(
    async (path: string) => {
      const token = await getTokenRef.current();

      if (!token) {
        throw new Error('You need to be signed in to continue.');
      }

      const response = await fetch(`${backendBaseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      return (await response.json()) as Record<string, unknown>;
    },
    [backendBaseUrl, readResponseError],
  );

  const loadPanelData = useCallback(async () => {
    if (!backendBaseUrl) {
      setPanelError('Set EXPO_PUBLIC_BACKEND_URL to enable points and camera matching.');
      setIsPanelLoading(false);
      return;
    }

    setPanelError('');
    setIsPanelLoading(true);

    try {
      const token = await getTokenRef.current().catch(() => null);

      let nextPanelError = '';
      let nextPanelNotice = '';

      let normalizedPoints: PointsSummary = {
        totalPoints: 0,
        level: 'Seed',
        recentActivity: [],
      };

      let normalizedLostItems: LostBoardItem[] = [];
      let normalizedIncomingClaims: IncomingClaim[] = [];
      let normalizedClaimHistory: IncomingClaim[] = [];

      const lostResponse = await fetch(`${backendBaseUrl}/api/lost-items`);

      if (lostResponse.ok) {
        const lostPayload = (await lostResponse.json()) as { items?: unknown };

        normalizedLostItems = Array.isArray(lostPayload.items)
          ? lostPayload.items
              .map((row) => {
                const item = row as Record<string, unknown>;

                return {
                  id: safeString(item.id),
                  title: safeString(item.title) || 'Untitled item',
                  category: safeString(item.category) || 'General',
                  expected_location: safeString(item.expected_location) || null,
                  image_url: safeString(item.image_url) || null,
                  created_at: safeString(item.created_at) || null,
                  ai_detected_label: safeString(item.ai_detected_label) || null,
                };
              })
              .filter((item) => Boolean(item.id))
              .slice(0, 12)
          : [];
      } else {
        nextPanelError = await readResponseError(lostResponse);
      }

      if (!token) {
        nextPanelNotice = nextPanelNotice || 'Sign in to load points and claim inbox.';
      } else {
        const [pointsResponse, inboxResponse, historyResponse] = await Promise.all([
          fetch(`${backendBaseUrl}/api/points/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
          fetch(`${backendBaseUrl}/api/match-requests/inbox`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
          fetch(`${backendBaseUrl}/api/match-requests/history/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
        ]);

        if (pointsResponse.ok) {
          const pointsPayload = (await pointsResponse.json()) as {
            totalPoints?: unknown;
            level?: unknown;
            recentActivity?: unknown;
          };

          normalizedPoints = {
            totalPoints: Math.max(0, safeNumber(pointsPayload.totalPoints)),
            level: safeString(pointsPayload.level) || 'Seed',
            recentActivity: Array.isArray(pointsPayload.recentActivity)
              ? pointsPayload.recentActivity
                  .map((row, index) => {
                    const item = row as Record<string, unknown>;

                    return {
                      id: safeNumber(item.id) || index + 1,
                      points: safeNumber(item.points),
                      reason: safeString(item.reason) || 'activity',
                      created_at: safeString(item.created_at) || new Date().toISOString(),
                    };
                  })
                  .slice(0, 5)
              : [],
          };
        } else {
          nextPanelNotice =
            nextPanelNotice ||
            (pointsResponse.status === 404
              ? 'Points service not deployed yet on backend.'
              : 'Points are temporarily unavailable.');
        }

        if (inboxResponse.ok) {
          const inboxPayload = (await inboxResponse.json()) as { items?: unknown };

          normalizedIncomingClaims = Array.isArray(inboxPayload.items)
            ? inboxPayload.items
                .map((item) => normalizeIncomingClaim(item))
                .filter((item): item is IncomingClaim => Boolean(item))
                .slice(0, 12)
            : [];
        } else {
          nextPanelNotice =
            nextPanelNotice ||
            (inboxResponse.status === 404
              ? 'Claim inbox is not deployed on backend yet.'
              : 'Claim inbox is temporarily unavailable.');
        }

        if (historyResponse.ok) {
          const historyPayload = (await historyResponse.json()) as { items?: unknown };

          normalizedClaimHistory = Array.isArray(historyPayload.items)
            ? historyPayload.items
                .map((item) => normalizeIncomingClaim(item))
                .filter((item): item is IncomingClaim => Boolean(item))
                .slice(0, 20)
            : [];
        } else {
          nextPanelNotice =
            nextPanelNotice ||
            (historyResponse.status === 404
              ? 'History service is not deployed on backend yet.'
              : 'History is temporarily unavailable.');
        }
      }

      setPoints(normalizedPoints);
      setLostBoard(normalizedLostItems);
      setIncomingClaims(normalizedIncomingClaims);
      setClaimHistory(normalizedClaimHistory);
      setPanelNotice(nextPanelNotice);
      setPanelError(nextPanelError);
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Unable to load points and home widgets.';

      setPanelError(message);
    } finally {
      setIsPanelLoading(false);
    }
  }, [backendBaseUrl, readResponseError]);

  useEffect(() => {
    void loadPanelData();
  }, [loadPanelData]);

  const resetComposer = useCallback(() => {
    setPickedImage(null);
    setScanResult(null);
    setTitle('');
    setDescription('');
    setLocationHint('');
    setSelectedClaimItemId('');
    setIsResolvingLocation(false);
    setIsAiAssistModalVisible(false);
    setAiAssistPhase('analyzing');
    setAiAssistStepIndex(0);
    setAiAssistDraft(null);
    setActionError('');
    setActionNotice('');
  }, []);

  const openComposer = useCallback(
    (nextMode: StudioMode) => {
      setMode(nextMode);
      resetComposer();

      if (nextMode === 'claim' && claimableItems.length) {
        setSelectedClaimItemId(claimableItems[0].id);
      }

      setIsModalVisible(true);
    },
    [claimableItems, resetComposer],
  );

  useEffect(() => {
    if (!claimIntentNonce || !claimIntentItemId) {
      return;
    }

    if (claimIntentNonce <= lastHandledClaimIntentNonceRef.current) {
      return;
    }

    lastHandledClaimIntentNonceRef.current = claimIntentNonce;

    setMode('claim');
    resetComposer();

    const matched = claimableItems.find((item) => item.id === claimIntentItemId);
    const fallback = claimableItems[0];

    setSelectedClaimItemId(matched?.id || fallback?.id || claimIntentItemId);
    setIsModalVisible(true);
  }, [claimIntentItemId, claimIntentNonce, claimableItems, resetComposer]);

  const closeComposer = useCallback(() => {
    setIsModalVisible(false);
    setActionError('');
    setActionNotice('');
  }, []);

  const applyPickedAsset = useCallback((asset: ImagePicker.ImagePickerAsset) => {
    if (!asset.base64) {
      setActionError('Could not read image data. Please select another image.');
      return;
    }

    setPickedImage({
      uri: asset.uri,
      base64: asset.base64,
      width: asset.width,
      height: asset.height,
      mimeType: safeString(asset.mimeType) || 'image/jpeg',
      fileName: safeString(asset.fileName) || `item-${Date.now()}.jpg`,
    });

    setScanResult(null);
    setActionError('');
  }, []);

  const pickFromGallery = useCallback(async () => {
    setActionError('');

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActionError('Gallery permission is required to upload an image.');
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
    if (asset) {
      applyPickedAsset(asset);
    }
  }, [applyPickedAsset]);

  const pickFromCamera = useCallback(async () => {
    setActionError('');

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setActionError('Camera permission is required to scan with camera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.72,
      base64: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    if (asset) {
      applyPickedAsset(asset);
    }
  }, [applyPickedAsset]);

  const resolveCurrentLocation = useCallback(
    async (options?: { silentSuccess?: boolean }): Promise<string> => {
      setIsResolvingLocation(true);
      setActionError('');

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== 'granted') {
          setActionError('Location permission is required to auto-fill found location.');
          return '';
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const geocoded = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        const first = geocoded[0] as Record<string, unknown> | undefined;
        const parts = [
          safeString(first?.name),
          safeString(first?.street),
          safeString(first?.district),
          safeString(first?.city),
          safeString(first?.region),
        ].filter(Boolean);

        const fallback = `Lat ${position.coords.latitude.toFixed(5)}, Lon ${position.coords.longitude.toFixed(5)}`;
        const nextLocation = parts.length ? parts.slice(0, 4).join(', ') : fallback;

        setLocationHint(nextLocation);

        if (!options?.silentSuccess) {
          setActionNotice('Live location added for found item.');
        }

        return nextLocation;
      } catch {
        setActionError('Could not fetch live location. Check GPS and try again.');
        return '';
      } finally {
        setIsResolvingLocation(false);
      }
    },
    [],
  );

  const closeAiAssistModal = useCallback(() => {
    setIsAiAssistModalVisible(false);
    setAiAssistPhase('analyzing');
    setAiAssistStepIndex(0);
    setAiAssistDraft(null);
  }, []);

  const applyAiAssistDraft = useCallback(() => {
    if (!aiAssistDraft) {
      closeAiAssistModal();
      return;
    }

    setTitle(aiAssistDraft.suggestedTitle);
    setDescription(aiAssistDraft.suggestedDescription);

    if (mode === 'found' && aiAssistDraft.suggestedLocation) {
      setLocationHint(aiAssistDraft.suggestedLocation);
    }

    setActionNotice('AI suggestions inserted. Review once and submit.');
    closeAiAssistModal();
  }, [aiAssistDraft, closeAiAssistModal, mode]);

  const runScan = useCallback(async (): Promise<ScanResult | null> => {
    if (!backendBaseUrl) {
      setActionError('Set EXPO_PUBLIC_BACKEND_URL to use image scan.');
      return null;
    }

    if (!pickedImage) {
      setActionError('Upload or capture an image first.');
      return null;
    }

    setIsWorking(true);
    setActionError('');
    setActionNotice('');

    try {
      const payload = await authedJsonRequest('/api/vision/classify-item', {
        image_base64: pickedImage.base64,
        mime_type: pickedImage.mimeType,
        width: pickedImage.width,
        height: pickedImage.height,
        file_name: pickedImage.fileName,
        hint_text: `${title} ${description}`,
        location_hint: locationHint,
      });

      const nextResult: ScanResult = {
        detection: normalizeScanDetection(payload.detection),
        imageUrl: safeString(payload.imageUrl) || null,
      };

      setScanResult(nextResult);
      setActionNotice(
        `Detected ${nextResult.detection.label} (${Math.round(nextResult.detection.confidence * 100)}% confidence).`,
      );

      return nextResult;
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Image scan failed.';

      setActionError(message);
      return null;
    } finally {
      setIsWorking(false);
    }
  }, [authedJsonRequest, backendBaseUrl, description, locationHint, pickedImage, title]);

  const triggerAiAssist = useCallback(async () => {
    if (!pickedImage) {
      setActionError('Upload an image first to use AI autofill.');
      return;
    }

    setActionError('');
    setIsAiAssistModalVisible(true);
    setAiAssistPhase('analyzing');
    setAiAssistStepIndex(0);
    setAiAssistDraft(null);

    const maxStepIndex = AI_ANALYSIS_STEPS.length - 1;

    const stepTimer = setInterval(() => {
      setAiAssistStepIndex((previous) => (previous < maxStepIndex ? previous + 1 : previous));
    }, 520);

    try {
      const ensuredScan = scanResult ?? (await runScan());

      if (!ensuredScan) {
        closeAiAssistModal();
        return;
      }

      const liveLocation =
        mode === 'found' ? await resolveCurrentLocation({ silentSuccess: true }) : '';

      const nextDraft = createAiAssistDraft(
        mode,
        ensuredScan.detection,
        liveLocation || locationHint.trim(),
      );

      setAiAssistDraft(nextDraft);
      setAiAssistStepIndex(maxStepIndex);
      setAiAssistPhase('review');
    } finally {
      clearInterval(stepTimer);
    }
  }, [closeAiAssistModal, locationHint, mode, pickedImage, resolveCurrentLocation, runScan, scanResult]);

  const submitLostReport = useCallback(async () => {
    if (!pickedImage) {
      setActionError('Please upload an image first.');
      return;
    }

    if (!locationHint.trim()) {
      setActionError('Enter where it got lost before submitting.');
      return;
    }

    setIsWorking(true);
    setActionError('');
    setActionNotice('');

    try {
      const ensuredScan = scanResult ?? (await runScan());

      if (!ensuredScan) {
        return;
      }

      const payload = await authedJsonRequest('/api/lost-items', {
        title: title.trim() || `Lost ${ensuredScan.detection.label}`,
        description: description.trim(),
        category: ensuredScan.detection.category,
        expected_location: locationHint.trim(),
        ai_detected_label: ensuredScan.detection.label,
        image_base64: pickedImage.base64,
        image_url: ensuredScan.imageUrl,
        mime_type: pickedImage.mimeType,
        width: pickedImage.width,
        height: pickedImage.height,
        file_name: pickedImage.fileName,
      });

      const pointsAwarded = Math.max(0, safeNumber(payload.pointsAwarded));

      setActionNotice(
        pointsAwarded
          ? `Lost item posted successfully. +${pointsAwarded} points added.`
          : 'Lost item posted successfully.',
      );

      await loadPanelData();
      await Promise.resolve(onActionsFinished?.());

      setTimeout(() => {
        closeComposer();
      }, 700);
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to submit lost report.';

      setActionError(message);
    } finally {
      setIsWorking(false);
    }
  }, [
    authedJsonRequest,
    closeComposer,
    description,
    loadPanelData,
    locationHint,
    onActionsFinished,
    pickedImage,
    runScan,
    scanResult,
    title,
  ]);

  const submitFoundItem = useCallback(async () => {
    if (!pickedImage) {
      setActionError('Please upload an image first.');
      return;
    }

    if (!locationHint.trim()) {
      setActionError('Use live location icon or enter found location before submitting.');
      return;
    }

    setIsWorking(true);
    setActionError('');
    setActionNotice('');

    try {
      const ensuredScan = scanResult ?? (await runScan());

      if (!ensuredScan) {
        return;
      }

      const payload = await authedJsonRequest('/api/found-items', {
        title: title.trim() || `Found ${ensuredScan.detection.label}`,
        category: ensuredScan.detection.category,
        location: locationHint.trim() || 'Campus location',
        image_base64: pickedImage.base64,
        image_url: ensuredScan.imageUrl,
        mime_type: pickedImage.mimeType,
        width: pickedImage.width,
        height: pickedImage.height,
        file_name: pickedImage.fileName,
        description: description.trim(),
      });

      const pointsAwarded = Math.max(0, safeNumber(payload.pointsAwarded));

      setActionNotice(
        pointsAwarded
          ? `Found item posted successfully. +${pointsAwarded} points added.`
          : 'Found item posted successfully.',
      );

      await loadPanelData();
      await Promise.resolve(onActionsFinished?.());

      setTimeout(() => {
        closeComposer();
      }, 700);
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to submit found item.';

      setActionError(message);
    } finally {
      setIsWorking(false);
    }
  }, [
    authedJsonRequest,
    closeComposer,
    description,
    loadPanelData,
    locationHint,
    onActionsFinished,
    pickedImage,
    runScan,
    scanResult,
    title,
  ]);

  const submitAutoClaim = useCallback(async () => {
    if (!selectedClaimItemId) {
      setActionError(
        claimableItems.length
          ? 'Select the product you want to claim first.'
          : 'No claimable products are visible right now.',
      );
      return;
    }

    if (!pickedImage) {
      setActionError('Please upload proof image first.');
      return;
    }

    setIsWorking(true);
    setActionError('');
    setActionNotice('');

    try {
      const ensuredScan = scanResult ?? (await runScan());

      if (!ensuredScan) {
        return;
      }

      const commonPayload = {
        proof_image_base64: pickedImage.base64,
        mime_type: pickedImage.mimeType,
        width: pickedImage.width,
        height: pickedImage.height,
        file_name: pickedImage.fileName,
        hint_text: description.trim() || title.trim(),
        location_hint: locationHint.trim(),
        lost_title: title.trim(),
        lost_description: description.trim(),
        detected_label: ensuredScan.detection.label,
        detected_category: ensuredScan.detection.category,
      };

      const payload = await authedJsonRequest('/api/match-requests', {
        ...commonPayload,
        found_item_id: selectedClaimItemId,
      });

      const matchScore =
        payload.request && typeof payload.request === 'object'
          ? safeNumber((payload.request as Record<string, unknown>).match_score)
          : 0;
      const pointsAwarded = Math.max(0, safeNumber(payload.pointsAwarded));
      const targetTitle = selectedClaimItem?.title || 'selected item';

      setActionNotice(
        `Claim request sent for ${targetTitle} (${matchScore}% score). Uploader can now review your proof.${
          pointsAwarded ? ` +${pointsAwarded} points added.` : ''
        }`,
      );

      await loadPanelData();
      await Promise.resolve(onActionsFinished?.());
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to submit claim request.';

      setActionError(message);
    } finally {
      setIsWorking(false);
    }
  }, [
    authedJsonRequest,
    description,
    loadPanelData,
    locationHint,
    onActionsFinished,
    claimableItems.length,
    pickedImage,
    runScan,
    selectedClaimItem,
    selectedClaimItemId,
    scanResult,
    title,
  ]);

  const resolveIncomingClaim = useCallback(
    async (claimId: string, action: 'approve' | 'reject') => {
      if (!claimId) {
        return;
      }

      setIsResolvingClaimId(claimId);
      setPanelError('');
      setPanelNotice('');

      try {
        const payload = await authedJsonRequest(`/api/match-requests/${claimId}/resolve`, {
          action,
        });

        let noticeMessage = '';

        if (action === 'approve') {
          const finderPoints = Math.max(0, safeNumber(payload.finderPointsAwarded));
          const claimantPoints = Math.max(0, safeNumber(payload.claimantPointsAwarded));

          noticeMessage =
            `Claim approved. Finder +${finderPoints} points${
              claimantPoints ? `, owner +${claimantPoints} points` : ''
            }.`;
        } else {
          noticeMessage = 'Claim request rejected.';
        }

        await loadPanelData();
        await Promise.resolve(onActionsFinished?.());
        setPanelNotice(noticeMessage);
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to resolve claim request.';

        setPanelError(message);
      } finally {
        setIsResolvingClaimId('');
      }
    },
    [authedJsonRequest, loadPanelData, onActionsFinished],
  );

  const confirmPickup = useCallback(
    async (claimId: string) => {
      if (!claimId) {
        return;
      }

      setIsConfirmingPickupId(claimId);
      setPanelError('');
      setPanelNotice('');

      try {
        const payload = await authedJsonRequest(`/api/match-requests/${claimId}/confirm-pickup`, {});

        const finderPoints = Math.max(0, safeNumber(payload.finderPickupPoints));
        const claimantPoints = Math.max(0, safeNumber(payload.claimantPickupPoints));
        const editWindowSeconds = Math.max(0, safeNumber(payload.pickupEditSecondsRemaining));

        await loadPanelData();
        await Promise.resolve(onActionsFinished?.());

        setPanelNotice(
          `Pickup confirmed. Finder +${finderPoints} points${
            claimantPoints ? `, owner +${claimantPoints} points` : ''
          }. History updated for both users.`,
        );

        setPickupNotice({
          visible: true,
          claimId,
          secondsRemaining: editWindowSeconds,
        });
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to confirm pickup.';

        setPanelError(message);
      } finally {
        setIsConfirmingPickupId('');
      }
    },
    [authedJsonRequest, loadPanelData, onActionsFinished],
  );

  const revertPickup = useCallback(
    async (claimId: string) => {
      if (!claimId) {
        return;
      }

      setIsRevertingPickupId(claimId);
      setPanelError('');
      setPanelNotice('');

      try {
        await authedJsonRequest(`/api/match-requests/${claimId}/revert-pickup`, {});

        setPickupNotice({
          visible: false,
          claimId: '',
          secondsRemaining: 0,
        });

        await loadPanelData();
        await Promise.resolve(onActionsFinished?.());
        setPanelNotice('Pickup reverted. Status moved back to approved.');
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to revert pickup status.';

        setPanelError(message);
      } finally {
        setIsRevertingPickupId('');
      }
    },
    [authedJsonRequest, loadPanelData, onActionsFinished],
  );

  const openMessages = useCallback(
    async (claim: IncomingClaim) => {
      if (!claim.id) {
        return;
      }

      setIsMessagesModalVisible(true);
      setMessagesClaim(claim);
      setMessages([]);
      setMessagesInput('');
      setMessagesError('');
      setIsMessagesLoading(true);

      try {
        const payload = await authedGetRequest(`/api/match-requests/${claim.id}/messages`);
        const rows = Array.isArray(payload.items)
          ? payload.items
              .map((entry) => {
                const item = entry as Record<string, unknown>;

                return {
                  id: safeString(item.id) || `${Date.now()}-${Math.random()}`,
                  sender_user_id: safeString(item.sender_user_id),
                  message_text: safeString(item.message_text),
                  created_at: safeString(item.created_at) || null,
                };
              })
              .filter((entry) => Boolean(entry.message_text))
          : [];

        setMessages(rows);
        setIsMessagingActive(Boolean(payload.messagingActive));

        const warningMessage = safeString(payload.warning);
        setMessagesError(warningMessage);
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Failed to load messages.';

        if (isMissingMessagesTableIssue(message)) {
          const localRows = localMessagesByClaimRef.current[claim.id] ?? [];
          setMessages(localRows);
          setIsMessagingActive(claim.status !== 'picked_up');
          setMessagesError(
            'Chat database migration is pending. Messages are being kept temporarily on this device.',
          );
          return;
        }

        setMessagesError(message);
      } finally {
        setIsMessagesLoading(false);
      }
    },
    [authedGetRequest],
  );

  const sendMessage = useCallback(async () => {
    if (!messagesClaim?.id) {
      return;
    }

    const message = messagesInput.trim();
    if (!message) {
      return;
    }

    setIsSendingMessage(true);
    setMessagesError('');

    try {
      const payload = await authedJsonRequest(`/api/match-requests/${messagesClaim.id}/messages`, {
        message,
      });

      const row =
        payload.message && typeof payload.message === 'object'
          ? (payload.message as Record<string, unknown>)
          : null;

      if (row) {
        setMessages((previous) => [
          ...previous,
          {
            id: safeString(row.id) || `${Date.now()}-${Math.random()}`,
            sender_user_id: safeString(row.sender_user_id),
            message_text: safeString(row.message_text),
            created_at: safeString(row.created_at) || new Date().toISOString(),
          },
        ]);
      }

      setMessagesInput('');
      setIsMessagingActive(Boolean(payload.messagingActive));
      setMessagesError(safeString(payload.warning));
    } catch (error) {
      const messageText =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to send message.';

      if (isMissingMessagesTableIssue(messageText)) {
        const fallbackMessage: ClaimMessage = {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          sender_user_id: currentUserId,
          message_text: message,
          created_at: new Date().toISOString(),
        };

        const localRows = [...(localMessagesByClaimRef.current[messagesClaim.id] ?? []), fallbackMessage]
          .slice(-200);

        localMessagesByClaimRef.current[messagesClaim.id] = localRows;
        setMessages(localRows);
        setMessagesInput('');
        setIsMessagingActive(messagesClaim.status !== 'picked_up');
        setMessagesError(
          'Chat database migration is pending. Message sent in temporary mode on this device.',
        );
        return;
      }

      setMessagesError(messageText);
    } finally {
      setIsSendingMessage(false);
    }
  }, [authedJsonRequest, currentUserId, messagesClaim, messagesInput]);

  useEffect(() => {
    if (!focusClaimRequestId || !focusClaimNonce) {
      return;
    }

    setHistoryFilter('all');
    setFocusedHistoryClaimId(focusClaimRequestId);

    const targetClaim =
      claimHistory.find((entry) => entry.id === focusClaimRequestId) ||
      incomingClaims.find((entry) => entry.id === focusClaimRequestId);

    if (!targetClaim) {
      return;
    }

    setPanelNotice(`Opened claim for ${targetClaim.found_item.title}. Continue below.`);

    if (autoOpenFocusedClaimMessages && targetClaim.status !== 'picked_up') {
      void openMessages(targetClaim);
    }
  }, [
    autoOpenFocusedClaimMessages,
    claimHistory,
    focusClaimNonce,
    focusClaimRequestId,
    incomingClaims,
    openMessages,
  ]);

  const isClaimSubmitBlocked = mode === 'claim' && !selectedClaimItem;

  return (
    <View style={styles.root}>
      <View style={styles.pointsCard}>
        <View style={styles.pointsRow}>
          <View>
            <Text style={styles.pointsLabel}>Campus Points</Text>
            <Text style={styles.pointsValue}>{points.totalPoints}</Text>
          </View>
          <View style={styles.levelChip}>
            <MaterialIcons color={colors.primary} name="military-tech" size={15} />
            <Text style={styles.levelChipText}>{points.level}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(levelProgress.ratio * 100)}%` }]} />
        </View>

        <Text style={styles.progressText}>
          {levelProgress.remaining > 0
            ? `${levelProgress.remaining} pts to ${levelProgress.nextLabel}`
            : 'Top level reached'}
        </Text>

        {points.recentActivity.length ? (
          <View style={styles.activityWrap}>
            {points.recentActivity.slice(0, 2).map((entry) => {
              const positive = entry.points >= 0;
              return (
                <View key={`${entry.id}-${entry.created_at}`} style={styles.activityRow}>
                  <Text style={styles.activityReason}>{formatReason(entry.reason)}</Text>
                  <Text style={[styles.activityPoints, positive ? styles.activityPointsGain : undefined]}>
                    {positive ? '+' : ''}
                    {entry.points}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      {showComposerSections ? (
        <>
          <View style={compact ? styles.quickWidgetsRowCompact : styles.quickWidgetsRow}>
            <View style={styles.quickWidgetCard}>
              <Text style={styles.quickWidgetLabel}>Open Lost</Text>
              <Text style={styles.quickWidgetValue}>{quickWidgetMetrics.openLostCount}</Text>
            </View>

            <View style={styles.quickWidgetCard}>
              <Text style={styles.quickWidgetLabel}>Pending Claims</Text>
              <Text style={styles.quickWidgetValue}>{quickWidgetMetrics.pendingClaimsCount}</Text>
            </View>

            {!compact ? (
              <View style={styles.quickWidgetCard}>
                <Text style={styles.quickWidgetLabel}>Recent Rewards</Text>
                <Text style={styles.quickWidgetValue}>{quickWidgetMetrics.recentRewards}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.studioCard}>
            <Text style={styles.studioTitle}>Campus AI Studio</Text>
            <Text style={styles.studioSubtitle}>
              Upload from camera/gallery, detect item type, and submit found item, lost report, or claim request instantly.
            </Text>

            <View style={styles.studioActionRow}>
              <Pressable onPress={() => openComposer('lost')} style={styles.primaryAction}>
                <MaterialIcons color={colors.onPrimary} name="add-photo-alternate" size={16} />
                <Text style={styles.primaryActionText}>Report Lost Item</Text>
              </Pressable>

              <Pressable onPress={() => openComposer('claim')} style={styles.secondaryAction}>
                <MaterialIcons color={colors.primary} name="fact-check" size={16} />
                <Text style={styles.secondaryActionText}>Start New Claim</Text>
              </Pressable>
            </View>

            <Pressable onPress={() => openComposer('found')} style={styles.foundActionButton}>
              <MaterialIcons color={colors.onPrimary} name="inventory-2" size={16} />
              <Text style={styles.foundActionButtonText}>Add Found Item</Text>
            </Pressable>

            {panelError ? (
              <View style={styles.errorWrap}>
                <MaterialIcons color={colors.error} name="error-outline" size={15} />
                <Text style={styles.errorText}>{panelError}</Text>
              </View>
            ) : null}

            {panelNotice ? (
              <View style={styles.noticeWrap}>
                <MaterialIcons color={colors.success} name="check-circle" size={15} />
                <Text style={styles.noticeText}>{panelNotice}</Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {!showComposerSections && panelError ? (
        <View style={styles.errorWrap}>
          <MaterialIcons color={colors.error} name="error-outline" size={15} />
          <Text style={styles.errorText}>{panelError}</Text>
        </View>
      ) : null}

      {!showComposerSections && panelNotice ? (
        <View style={styles.noticeWrap}>
          <MaterialIcons color={colors.success} name="check-circle" size={15} />
          <Text style={styles.noticeText}>{panelNotice}</Text>
        </View>
      ) : null}

      {showClaimOperations ? (
        <>
          <View style={styles.claimSectionHeaderCard}>
            <View>
              <Text style={styles.boardTitle}>Claim Inbox</Text>
              <Text style={styles.sectionSupportText}>Owner requests waiting for your review.</Text>
            </View>
            <View style={styles.sectionCountBadge}>
              <MaterialIcons color={colors.onPrimary} name="inbox" size={13} />
              <Text style={styles.sectionCountBadgeText}>{incomingClaims.length}</Text>
            </View>
          </View>

          {incomingClaims.length ? (
            incomingClaims.slice(0, compact ? 1 : 3).map((claim) => (
              <View key={claim.id} style={styles.claimCard}>
                <View style={styles.claimHeaderRow}>
                  <Text numberOfLines={1} style={styles.claimTitle}>
                    {claim.found_item.title}
                  </Text>
                  <Text style={styles.claimScore}>{claim.match_score}% match</Text>
                </View>

                <Text numberOfLines={1} style={styles.claimMetaText}>
                  Requested by owner {formatRelativeTime(claim.created_at)}
                </Text>

                {claim.proof_image_url ? (
                  <Image
                    resizeMode="contain"
                    source={{ uri: claim.proof_image_url }}
                    style={styles.claimProofImage}
                  />
                ) : null}

                <Text numberOfLines={1} style={styles.claimMetaSubText}>
                  Proof label: {claim.ai_detected_label || 'Manual proof'}
                </Text>

                <View style={styles.claimActionRow}>
                  <Pressable onPress={() => void openMessages(claim)} style={styles.messageButton}>
                    <MaterialIcons color={colors.onSurfaceVariant} name="chat-bubble-outline" size={14} />
                    <Text style={styles.messageButtonText}>Message</Text>
                  </Pressable>

                  <Pressable
                    disabled={Boolean(isResolvingClaimId)}
                    onPress={() => void resolveIncomingClaim(claim.id, 'reject')}
                    style={styles.rejectButton}
                  >
                    <MaterialIcons color={colors.onSurfaceVariant} name="close" size={14} />
                    <Text style={styles.rejectButtonText}>Reject</Text>
                  </Pressable>

                  <Pressable
                    disabled={Boolean(isResolvingClaimId)}
                    onPress={() => void resolveIncomingClaim(claim.id, 'approve')}
                    style={styles.approveButton}
                  >
                    {isResolvingClaimId === claim.id ? (
                      <ActivityIndicator color={colors.onPrimary} size="small" />
                    ) : (
                      <View style={styles.actionButtonInnerRow}>
                        <MaterialIcons color={colors.onPrimary} name="verified" size={14} />
                        <Text style={styles.approveButtonText}>Approve + Points</Text>
                      </View>
                    )}
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyBoardCardLarge}>
              <View style={styles.emptyStateIconWrap}>
                <MaterialIcons color={colors.primary} name="inbox" size={22} />
              </View>
              <Text style={styles.emptyBoardTitle}>No incoming claims to review</Text>
              <Text style={styles.emptyBoardSubtitle}>
                New claim requests will appear here for approve or reject actions.
              </Text>
              <Pressable onPress={() => void loadPanelData()} style={styles.emptyBoardActionButton}>
                <MaterialIcons color={colors.primary} name="refresh" size={14} />
                <Text style={styles.emptyBoardActionButtonText}>Refresh Inbox</Text>
              </Pressable>
            </View>
          )}

          {pickupQueue.length ? (
            <>
              <View style={styles.claimSectionHeaderCardCompact}>
                <View>
                  <Text style={styles.boardTitle}>Pickup Confirmation</Text>
                  <Text style={styles.sectionSupportText}>Finalize handover after owner verification.</Text>
                </View>
                <View style={styles.sectionCountBadgeMuted}>
                  <MaterialIcons color={colors.primary} name="task-alt" size={13} />
                  <Text style={styles.sectionCountBadgeMutedText}>{pickupQueue.length}</Text>
                </View>
              </View>

              {pickupQueue.map((claim) => (
                <View key={`pickup-${claim.id}`} style={styles.claimCard}>
                  <View style={styles.claimHeaderRow}>
                    <Text numberOfLines={1} style={styles.claimTitle}>
                      {claim.found_item.title}
                    </Text>
                    <Text style={styles.claimScore}>Approved</Text>
                  </View>

                  <Text numberOfLines={1} style={styles.claimMetaText}>
                    Owner verified. Mark picked up after handover.
                  </Text>

                  <View style={styles.claimActionRow}>
                    <Pressable onPress={() => void openMessages(claim)} style={styles.messageButton}>
                      <MaterialIcons color={colors.onSurfaceVariant} name="chat-bubble-outline" size={14} />
                      <Text style={styles.messageButtonText}>Message</Text>
                    </Pressable>

                    <Pressable
                      disabled={Boolean(isConfirmingPickupId)}
                      onPress={() => void confirmPickup(claim.id)}
                      style={styles.pickupButtonCompact}
                    >
                      {isConfirmingPickupId === claim.id ? (
                        <ActivityIndicator color={colors.onPrimary} size="small" />
                      ) : (
                        <View style={styles.actionButtonInnerRow}>
                          <MaterialIcons color={colors.onPrimary} name="task-alt" size={14} />
                          <Text style={styles.pickupButtonText}>Mark Picked Up</Text>
                        </View>
                      )}
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          <View style={styles.claimSectionHeaderCard}>
            <View>
              <Text style={styles.boardTitle}>Claim History</Text>
              <Text style={styles.sectionSupportText}>Track approvals, pickup status, and claim chat.</Text>
            </View>
            <View style={styles.sectionCountBadge}>
              <MaterialIcons color={colors.onPrimary} name="history" size={13} />
              <Text style={styles.sectionCountBadgeText}>{historyOverview.all}</Text>
            </View>
          </View>

          <View style={styles.historyOverviewRow}>
            <View style={styles.historyOverviewCard}>
              <Text style={styles.historyOverviewValue}>{historyOverview.all}</Text>
              <Text style={styles.historyOverviewLabel}>Total</Text>
            </View>
            <View style={styles.historyOverviewCard}>
              <Text style={styles.historyOverviewValue}>{historyOverview.active}</Text>
              <Text style={styles.historyOverviewLabel}>Active</Text>
            </View>
            <View style={[styles.historyOverviewCard, { marginRight: 0 }]}>
              <Text style={styles.historyOverviewValue}>{historyOverview.completed}</Text>
              <Text style={styles.historyOverviewLabel}>Completed</Text>
            </View>
          </View>

          <View style={styles.historyFilterRow}>
            <Pressable
              onPress={() => setHistoryFilter('all')}
              style={[
                styles.historyFilterChip,
                historyFilter === 'all' ? styles.historyFilterChipActive : undefined,
              ]}
            >
              <MaterialIcons
                color={historyFilter === 'all' ? colors.onPrimary : colors.onSurfaceVariant}
                name="view-list"
                size={14}
              />
              <Text
                style={[
                  styles.historyFilterText,
                  historyFilter === 'all' ? styles.historyFilterTextActive : undefined,
                ]}
              >
                All
              </Text>
              <Text
                style={[
                  styles.historyFilterCount,
                  historyFilter === 'all' ? styles.historyFilterCountActive : undefined,
                ]}
              >
                {historyOverview.all}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setHistoryFilter('active')}
              style={[
                styles.historyFilterChip,
                historyFilter === 'active' ? styles.historyFilterChipActive : undefined,
              ]}
            >
              <MaterialIcons
                color={historyFilter === 'active' ? colors.onPrimary : colors.onSurfaceVariant}
                name="autorenew"
                size={14}
              />
              <Text
                style={[
                  styles.historyFilterText,
                  historyFilter === 'active' ? styles.historyFilterTextActive : undefined,
                ]}
              >
                Active
              </Text>
              <Text
                style={[
                  styles.historyFilterCount,
                  historyFilter === 'active' ? styles.historyFilterCountActive : undefined,
                ]}
              >
                {historyOverview.active}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setHistoryFilter('completed')}
              style={[
                styles.historyFilterChip,
                { marginRight: 0 },
                historyFilter === 'completed' ? styles.historyFilterChipActive : undefined,
              ]}
            >
              <MaterialIcons
                color={historyFilter === 'completed' ? colors.onPrimary : colors.onSurfaceVariant}
                name="task-alt"
                size={14}
              />
              <Text
                style={[
                  styles.historyFilterText,
                  historyFilter === 'completed' ? styles.historyFilterTextActive : undefined,
                ]}
              >
                Completed
              </Text>
              <Text
                style={[
                  styles.historyFilterCount,
                  historyFilter === 'completed' ? styles.historyFilterCountActive : undefined,
                ]}
              >
                {historyOverview.completed}
              </Text>
            </Pressable>
          </View>

          {filteredHistory.length ? (
            filteredHistory.map((entry) => {
              const statusTone = resolveStatusTone(entry.status);
              const isOwner = safeString(entry.found_item.created_by) === currentUserId;
              const isClaimant = safeString(entry.claimant_user_id) === currentUserId;
              const roleLabel = isOwner ? 'Uploader' : isClaimant ? 'Claimant' : 'Participant';
              const canMessage = entry.status !== 'picked_up';
              const canUndoPickup =
                isOwner &&
                entry.status === 'picked_up' &&
                (entry.pickup_is_editable || entry.pickup_edit_seconds_remaining > 0);
              const isFocusedHistoryEntry =
                Boolean(focusedHistoryClaimId) && entry.id === focusedHistoryClaimId;

              return (
                <View
                  key={`history-${entry.id}`}
                  style={[styles.historyCard, isFocusedHistoryEntry ? styles.historyCardFocused : undefined]}
                >
                  {isFocusedHistoryEntry ? (
                    <View style={styles.focusedClaimTag}>
                      <MaterialIcons color={colors.primary} name="stars" size={13} />
                      <Text style={styles.focusedClaimTagText}>CURRENT APPROVED CLAIM</Text>
                    </View>
                  ) : null}

                  <View style={styles.historyTopRow}>
                    <View style={styles.historyTitleWrap}>
                      <Text numberOfLines={1} style={styles.historyTitle}>
                        {entry.found_item.title}
                      </Text>
                      <View style={styles.historyRoleTag}>
                        <MaterialIcons color={colors.onSurfaceVariant} name="person-outline" size={12} />
                        <Text style={styles.historyRoleTagText}>{roleLabel}</Text>
                      </View>
                    </View>
                    <Text style={[styles.historyStatus, { backgroundColor: statusTone.bg, color: statusTone.fg }]}>
                      {formatStatusLabel(entry.status)}
                    </Text>
                  </View>

                  <View style={styles.historyMetaWrap}>
                    <View style={styles.historyMetaPill}>
                      <MaterialIcons color={colors.primary} name="percent" size={13} />
                      <Text style={styles.historyMetaPillText}>{entry.match_score}% match</Text>
                    </View>
                    <View style={styles.historyMetaPill}>
                      <MaterialIcons color={colors.onSurfaceVariant} name="schedule" size={13} />
                      <Text style={styles.historyMetaPillText}>Submitted {formatRelativeTime(entry.created_at)}</Text>
                    </View>
                    {entry.reviewed_at ? (
                      <View style={styles.historyMetaPill}>
                        <MaterialIcons color={colors.success} name="verified" size={13} />
                        <Text style={styles.historyMetaPillText}>Reviewed {formatRelativeTime(entry.reviewed_at)}</Text>
                      </View>
                    ) : (
                      <View style={styles.historyMetaPill}>
                        <MaterialIcons color={colors.onSurfaceVariant} name="hourglass-empty" size={13} />
                        <Text style={styles.historyMetaPillText}>Awaiting review</Text>
                      </View>
                    )}
                    {entry.status === 'picked_up' && entry.pickup_confirmed_at ? (
                      <View style={styles.historyMetaPill}>
                        <MaterialIcons color={colors.success} name="task-alt" size={13} />
                        <Text style={styles.historyMetaPillText}>
                          Picked up {formatRelativeTime(entry.pickup_confirmed_at)}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {entry.proof_image_url ? (
                    <View style={styles.historyProofWrap}>
                      <Text style={styles.historyProofLabel}>Proof Image</Text>
                      <Image
                        resizeMode="contain"
                        source={{ uri: entry.proof_image_url }}
                        style={styles.historyProofImage}
                      />
                    </View>
                  ) : null}

                  {(canMessage || canUndoPickup || (isOwner && entry.status === 'approved')) ? (
                    <View style={styles.historyActionsRow}>
                      {canMessage ? (
                        <Pressable onPress={() => void openMessages(entry)} style={styles.historyMessageButton}>
                          <MaterialIcons color={colors.onSurfaceVariant} name="chat-bubble-outline" size={14} />
                          <Text style={styles.historyMessageButtonText}>Message</Text>
                        </Pressable>
                      ) : null}

                      {isOwner && entry.status === 'approved' ? (
                        <Pressable
                          disabled={Boolean(isConfirmingPickupId)}
                          onPress={() => void confirmPickup(entry.id)}
                          style={[styles.pickupButtonCompact, styles.historyPrimaryActionButton]}
                        >
                          {isConfirmingPickupId === entry.id ? (
                            <ActivityIndicator color={colors.onPrimary} size="small" />
                          ) : (
                            <View style={styles.actionButtonInnerRow}>
                              <MaterialIcons color={colors.onPrimary} name="task-alt" size={14} />
                              <Text style={styles.pickupButtonText}>Mark Picked Up</Text>
                            </View>
                          )}
                        </Pressable>
                      ) : null}

                      {canUndoPickup ? (
                        <Pressable
                          disabled={Boolean(isRevertingPickupId)}
                          onPress={() => void revertPickup(entry.id)}
                          style={styles.undoPickupButton}
                        >
                          {isRevertingPickupId === entry.id ? (
                            <ActivityIndicator color={colors.primary} size="small" />
                          ) : (
                            <View style={styles.actionButtonInnerRow}>
                              <MaterialIcons color={colors.primary} name="undo" size={14} />
                              <Text style={styles.undoPickupButtonText}>
                                Undo ({minutesLeft(entry.pickup_edit_seconds_remaining)}m)
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <View style={styles.emptyBoardCardLarge}>
              <View style={styles.emptyStateIconWrap}>
                <MaterialIcons color={colors.primary} name="history" size={22} />
              </View>
              <Text style={styles.emptyBoardTitle}>Claim history is empty</Text>
              <Text style={styles.emptyBoardSubtitle}>{historyEmptySubtitle}</Text>
              <Pressable
                onPress={() => {
                  setHistoryFilter('all');
                  void loadPanelData();
                }}
                style={styles.emptyBoardActionButton}
              >
                <MaterialIcons color={colors.primary} name="refresh" size={14} />
                <Text style={styles.emptyBoardActionButtonText}>Refresh History</Text>
              </Pressable>
            </View>
          )}
        </>
      ) : null}

      {showLostBoard ? (
        <>
          <View style={styles.boardHeader}>
            <Text style={styles.boardTitle}>{compact ? 'Recent Lost Reports' : 'Lost Board'}</Text>
            {isPanelLoading ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Pressable onPress={() => void loadPanelData()}>
                <Text style={styles.boardRefresh}>Refresh</Text>
              </Pressable>
            )}
          </View>

          {lostBoard.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {lostBoard.slice(0, compact ? 4 : 12).map((item) => (
                <View key={item.id} style={styles.boardCard}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.boardImage} />
                  ) : (
                    <View style={styles.boardImageFallback}>
                      <MaterialIcons color={colors.outline} name="photo" size={22} />
                    </View>
                  )}

                  <Text numberOfLines={1} style={styles.boardItemTitle}>
                    {item.title}
                  </Text>

                  <Text numberOfLines={1} style={styles.boardItemLocation}>
                    {item.expected_location || 'Campus area'}
                  </Text>

                  <View style={styles.boardMetaRow}>
                    <Text style={styles.boardChip}>{item.category}</Text>
                    <Text style={styles.boardAgo}>{formatRelativeTime(item.created_at)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyBoardCard}>
              <MaterialIcons color={colors.outline} name="search" size={18} />
              <Text style={styles.emptyBoardText}>No open lost reports yet.</Text>
            </View>
          )}
        </>
      ) : null}

      <Modal animationType="fade" transparent visible={pickupNotice.visible}>
        <View style={styles.modalBackdropCenter}>
          <View style={styles.infoModalCard}>
            <Text style={styles.infoModalTitle}>Pickup Marked</Text>
            <Text style={styles.infoModalText}>
              You can change this status for the next 5 minutes.
            </Text>
            <Text style={styles.infoModalTextMuted}>
              Time left: {minutesLeft(pickupNotice.secondsRemaining)} minute(s)
            </Text>

            <View style={styles.infoModalActionsRow}>
              <Pressable
                onPress={() =>
                  setPickupNotice({
                    visible: false,
                    claimId: '',
                    secondsRemaining: 0,
                  })
                }
                style={styles.infoModalSecondaryAction}
              >
                <Text style={styles.infoModalSecondaryActionText}>Keep</Text>
              </Pressable>

              <Pressable
                disabled={Boolean(isRevertingPickupId)}
                onPress={() => void revertPickup(pickupNotice.claimId)}
                style={styles.infoModalPrimaryAction}
              >
                {isRevertingPickupId === pickupNotice.claimId ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.infoModalPrimaryActionText}>Undo Pickup</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={isMessagesModalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.messagesSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Claim Messages</Text>
              <Pressable
                onPress={() => {
                  setIsMessagesModalVisible(false);
                  setMessagesClaim(null);
                  setMessagesError('');
                }}
              >
                <MaterialIcons color={colors.onSurfaceVariant} name="close" size={24} />
              </Pressable>
            </View>

            <Text numberOfLines={1} style={styles.messagesItemTitle}>
              {messagesClaim?.found_item.title || 'Claim thread'}
            </Text>

            {isMessagesLoading ? (
              <View style={styles.messagesLoadingWrap}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.messagesLoadingText}>Loading messages...</Text>
              </View>
            ) : (
              <ScrollView style={styles.messagesScroll}>
                {messages.length ? (
                  messages.map((entry) => {
                    const mine = safeString(entry.sender_user_id) === currentUserId;

                    return (
                      <View
                        key={`${entry.id}-${entry.created_at || 'now'}`}
                        style={[styles.messageBubble, mine ? styles.messageBubbleMine : styles.messageBubbleOther]}
                      >
                        <Text style={styles.messageBubbleText}>{entry.message_text}</Text>
                        <Text style={styles.messageBubbleMeta}>{formatRelativeTime(entry.created_at)}</Text>
                      </View>
                    );
                  })
                ) : (
                  <View style={styles.emptyBoardCard}>
                    <MaterialIcons color={colors.outline} name="chat-bubble-outline" size={18} />
                    <Text style={styles.emptyBoardText}>No messages yet.</Text>
                  </View>
                )}
              </ScrollView>
            )}

            {messagesError ? (
              <View style={styles.errorWrap}>
                <MaterialIcons color={colors.error} name="error-outline" size={15} />
                <Text style={styles.errorText}>{messagesError}</Text>
              </View>
            ) : null}

            {isMessagingActive ? (
              <View style={styles.messagesComposerRow}>
                <TextInput
                  onChangeText={setMessagesInput}
                  placeholder="Type a message"
                  placeholderTextColor={colors.outline}
                  style={styles.messagesInput}
                  value={messagesInput}
                />

                <Pressable
                  disabled={isSendingMessage || !messagesInput.trim().length}
                  onPress={() => void sendMessage()}
                  style={styles.messagesSendButton}
                >
                  {isSendingMessage ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.messagesSendButtonText}>Send</Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <View style={styles.noticeWrap}>
                <MaterialIcons color={colors.success} name="lock" size={15} />
                <Text style={styles.noticeText}>Messaging is closed after pickup is marked.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={isModalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {mode === 'lost'
                  ? 'Report Lost Item'
                  : mode === 'found'
                    ? 'Add Found Item'
                    : 'Start New Claim'}
              </Text>
              <Pressable onPress={closeComposer}>
                <MaterialIcons color={colors.onSurfaceVariant} name="close" size={24} />
              </Pressable>
            </View>

            <Text style={styles.modalSubtitle}>
              {mode === 'claim'
                ? 'Select the found item and attach proof so owner verification is fast and secure.'
                : mode === 'found'
                  ? 'Capture key details and location so the owner can identify this item quickly.'
                  : 'Share clear details, proof notes, and where you lost it to get better matches.'}
            </Text>

            {mode === 'claim' ? (
              <View style={styles.claimModeBadgeRow}>
                <MaterialIcons color={colors.primary} name="verified-user" size={14} />
                <Text style={styles.claimModeBadgeText}>Claim Proof Mode</Text>
              </View>
            ) : null}

            <ScrollView contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
              {mode === 'claim' ? (
                <View style={styles.claimSelectionCard}>
                  <View style={styles.claimFlowHintCard}>
                    <MaterialIcons color={colors.primary} name="info-outline" size={15} />
                    <Text style={styles.claimFlowHintText}>
                      Use this for new claims only. If your claim is already approved, continue in the History tab.
                    </Text>
                  </View>

                  <Text style={styles.inputLabel}>Select Found Product</Text>

                  {claimableItems.length ? (
                    <ScrollView
                      contentContainerStyle={styles.claimTargetList}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {claimableItems.slice(0, 30).map((item) => {
                        const active = item.id === selectedClaimItemId;

                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => setSelectedClaimItemId(item.id)}
                            style={[
                              styles.claimTargetChip,
                              active ? styles.claimTargetChipActive : undefined,
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.claimTargetTitle,
                                active ? styles.claimTargetTitleActive : undefined,
                              ]}
                            >
                              {item.title}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.claimTargetMeta,
                                active ? styles.claimTargetMetaActive : undefined,
                              ]}
                            >
                              {item.location}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <View style={styles.emptySelectionCard}>
                      <MaterialIcons color={colors.outline} name="inventory" size={17} />
                      <Text style={styles.emptySelectionText}>
                        No public found products are available to claim.
                      </Text>
                    </View>
                  )}

                  {selectedClaimItem ? (
                    <Text numberOfLines={2} style={styles.selectedTargetHint}>
                      Selected item: {selectedClaimItem.title} • {selectedClaimItem.location}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={[styles.mediaSectionCard, mode === 'claim' ? styles.claimModeCard : undefined]}>
                <View style={styles.imagePickerWrap}>
                  {pickedImage ? (
                    <Image source={{ uri: pickedImage.uri }} style={styles.previewImage} />
                  ) : (
                    <View style={styles.previewPlaceholder}>
                      <MaterialIcons color={colors.outline} name="add-a-photo" size={28} />
                      <Text style={styles.previewPlaceholderText}>Capture or upload image</Text>
                    </View>
                  )}
                </View>

                <View style={styles.modalActionRow}>
                  <Pressable onPress={() => void pickFromCamera()} style={styles.modalActionChip}>
                    <MaterialIcons color={colors.primary} name="photo-camera" size={15} />
                    <Text style={styles.modalActionChipText}>Camera</Text>
                  </Pressable>

                  <Pressable onPress={() => void pickFromGallery()} style={styles.modalActionChip}>
                    <MaterialIcons color={colors.primary} name="photo-library" size={15} />
                    <Text style={styles.modalActionChipText}>Gallery</Text>
                  </Pressable>

                  <Pressable onPress={() => void runScan()} style={styles.modalActionChipPrimary}>
                    <MaterialIcons color={colors.onPrimary} name="psychology" size={15} />
                    <Text style={styles.modalActionChipPrimaryText}>Scan Image</Text>
                  </Pressable>

                  <Pressable
                    disabled={Boolean(isWorking) || !pickedImage}
                    onPress={() => void triggerAiAssist()}
                    style={[
                      styles.modalActionIconButton,
                      Boolean(isWorking) || !pickedImage ? styles.modalActionIconButtonDisabled : undefined,
                    ]}
                  >
                    <MaterialIcons color={colors.primary} name="auto-awesome" size={15} />
                    <Text style={styles.modalActionIconButtonText}>AI Assist</Text>
                  </Pressable>
                </View>

                {scanResult ? (
                  <View style={styles.scanCard}>
                    <Text style={styles.scanTitle}>Detected: {scanResult.detection.label}</Text>
                    <Text style={styles.scanMeta}>
                      Category: {scanResult.detection.category} • Confidence {Math.round(scanResult.detection.confidence * 100)}%
                    </Text>
                    <Text style={styles.scanTags}>Tags: {scanResult.detection.tags.join(', ')}</Text>
                  </View>
                ) : null}
              </View>

              <View style={[styles.detailsSectionCard, mode === 'claim' ? styles.claimModeCard : undefined]}>
                {mode === 'claim' ? (
                  <View style={styles.claimChecklistCard}>
                    <View style={styles.claimChecklistRow}>
                      <MaterialIcons color={colors.primary} name="check-circle" size={14} />
                      <Text style={styles.claimChecklistText}>Upload clear item proof photo</Text>
                    </View>
                    <View style={styles.claimChecklistRow}>
                      <MaterialIcons color={colors.primary} name="check-circle" size={14} />
                      <Text style={styles.claimChecklistText}>Mention unique ownership details</Text>
                    </View>
                    <View style={styles.claimChecklistRow}>
                      <MaterialIcons color={colors.primary} name="check-circle" size={14} />
                      <Text style={styles.claimChecklistText}>Add last seen location for better matching</Text>
                    </View>
                  </View>
                ) : null}

                <Text style={styles.inputLabel}>
                  {mode === 'claim' ? 'Your Item Name (Optional)' : 'Item Title'}
                </Text>
                <TextInput
                  onChangeText={setTitle}
                  placeholder={
                    mode === 'claim'
                      ? 'e.g., Black Lenovo Laptop with sticker'
                      : 'e.g., Black Lenovo Laptop'
                  }
                  placeholderTextColor={colors.outline}
                  style={styles.input}
                  value={title}
                />

                <Text style={styles.inputLabel}>
                  {mode === 'claim' ? 'Ownership Proof Details (Required)' : 'Description / Proof Notes'}
                </Text>
                <TextInput
                  multiline
                  onChangeText={setDescription}
                  placeholder={
                    mode === 'lost'
                      ? 'Add unique details so owner can identify...'
                      : mode === 'found'
                        ? 'Add details that help owner verify this item...'
                        : 'Add ownership proof details...'
                  }
                  placeholderTextColor={colors.outline}
                  style={styles.inputMultiline}
                  value={description}
                />

                <Text style={styles.inputLabel}>
                  {mode === 'found'
                    ? 'Found Location (Required)'
                    : mode === 'lost'
                      ? 'Lost At Location (Required)'
                      : 'Last Seen Location'}
                </Text>

                <View style={styles.locationInputRow}>
                  <TextInput
                    onChangeText={setLocationHint}
                    placeholder={
                      mode === 'lost'
                        ? 'Required: where item got lost'
                        : mode === 'found'
                          ? 'Required: live or manual found location'
                          : 'e.g., Main Library near Block B'
                    }
                    placeholderTextColor={colors.outline}
                    style={styles.locationInputField}
                    value={locationHint}
                  />

                  {mode === 'found' ? (
                    <Pressable
                      disabled={Boolean(isWorking) || isResolvingLocation}
                      onPress={() => void resolveCurrentLocation()}
                      style={[
                        styles.locationPinButton,
                        Boolean(isWorking) || isResolvingLocation
                          ? styles.locationPinButtonDisabled
                          : undefined,
                      ]}
                    >
                      {isResolvingLocation ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <MaterialIcons color={colors.primary} name="my-location" size={17} />
                      )}
                    </Pressable>
                  ) : null}
                </View>

                {actionError ? (
                  <View style={styles.errorWrap}>
                    <MaterialIcons color={colors.error} name="error-outline" size={15} />
                    <Text style={styles.errorText}>{actionError}</Text>
                  </View>
                ) : null}

                {actionNotice ? (
                  <View style={styles.noticeWrap}>
                    <MaterialIcons color={colors.success} name="check-circle" size={15} />
                    <Text style={styles.noticeText}>{actionNotice}</Text>
                  </View>
                ) : null}
              </View>

              <Pressable
                disabled={isWorking || isClaimSubmitBlocked}
                onPress={() =>
                  void (
                    mode === 'lost'
                      ? submitLostReport()
                      : mode === 'found'
                        ? submitFoundItem()
                        : submitAutoClaim()
                  )
                }
                style={[
                  styles.submitButton,
                  isWorking || isClaimSubmitBlocked ? styles.submitButtonDisabled : undefined,
                ]}
              >
                {isWorking ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <>
                    <MaterialIcons
                      color={colors.onPrimary}
                      name={mode === 'claim' ? 'verified-user' : mode === 'found' ? 'inventory-2' : 'upload'}
                      size={17}
                    />
                    <Text style={styles.submitButtonText}>
                      {mode === 'lost'
                        ? 'Submit Lost Product'
                        : mode === 'found'
                          ? 'Submit Found Product'
                          : 'Submit Claim Request'}
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={isAiAssistModalVisible}>
        <View style={styles.modalBackdropCenter}>
          <View style={styles.aiAssistCard}>
            <View style={styles.aiAssistHeaderRow}>
              <MaterialIcons color={colors.primary} name="auto-awesome" size={18} />
              <Text style={styles.aiAssistTitle}>AI Autofill Assistant</Text>
            </View>

            {aiAssistPhase === 'analyzing' ? (
              <>
                <Text style={styles.aiAssistSubtitle}>Analyzing your image and preparing a draft...</Text>

                {AI_ANALYSIS_STEPS.map((step, index) => {
                  const isDone = index < aiAssistStepIndex;
                  const isCurrent = index === aiAssistStepIndex;

                  return (
                    <View key={`${step}-${index}`} style={styles.aiAssistStepRow}>
                      {isDone ? (
                        <MaterialIcons color={colors.success} name="check-circle" size={16} />
                      ) : isCurrent ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <MaterialIcons color={colors.outline} name="radio-button-unchecked" size={16} />
                      )}
                      <Text
                        style={[
                          styles.aiAssistStepText,
                          isDone ? styles.aiAssistStepTextDone : undefined,
                        ]}
                      >
                        {step}
                      </Text>
                    </View>
                  );
                })}

                <Pressable onPress={closeAiAssistModal} style={styles.aiAssistSecondaryButtonSingle}>
                  <Text style={styles.aiAssistSecondaryButtonText}>Cancel</Text>
                </Pressable>
              </>
            ) : aiAssistDraft ? (
              <>
                <Text style={styles.aiAssistSubtitle}>AI results ready. Insert or keep your manual values.</Text>

                <View style={styles.aiDraftCard}>
                  <Text style={styles.aiDraftLabel}>Title</Text>
                  <Text style={styles.aiDraftValue}>{aiAssistDraft.suggestedTitle}</Text>

                  <Text style={styles.aiDraftLabel}>Description</Text>
                  <Text style={styles.aiDraftValue}>{aiAssistDraft.suggestedDescription}</Text>

                  {mode === 'found' ? (
                    <>
                      <Text style={styles.aiDraftLabel}>Location</Text>
                      <Text style={styles.aiDraftValue}>
                        {aiAssistDraft.suggestedLocation || 'Permission needed to auto-fill live location.'}
                      </Text>
                    </>
                  ) : null}

                  <Text style={styles.aiDraftMeta}>
                    {aiAssistDraft.detectedCategory} • {aiAssistDraft.confidencePercent}% confidence
                  </Text>
                </View>

                <View style={styles.aiAssistActionsRow}>
                  <Pressable onPress={closeAiAssistModal} style={styles.aiAssistSecondaryButton}>
                    <Text style={styles.aiAssistSecondaryButtonText}>Keep Manual</Text>
                  </Pressable>

                  <Pressable onPress={applyAiAssistDraft} style={styles.aiAssistPrimaryButton}>
                    <Text style={styles.aiAssistPrimaryButtonText}>Insert Details</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginBottom: 16,
  },
  pointsCard: {
    ...shadows.soft,
    backgroundColor: '#FFF4E9',
    borderColor: '#F4DFC8',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  pointsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pointsLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  pointsValue: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 34,
    marginTop: 3,
  },
  levelChip: {
    alignItems: 'center',
    backgroundColor: '#FFDEB6',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  levelChipText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  progressTrack: {
    backgroundColor: '#F0D9BD',
    borderRadius: radii.pill,
    height: 8,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: '100%',
  },
  progressText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 8,
  },
  activityWrap: {
    marginTop: 10,
  },
  activityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  activityReason: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  activityPoints: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  activityPointsGain: {
    color: '#145A36',
  },
  quickWidgetsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  quickWidgetsRowCompact: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  quickWidgetCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  quickWidgetLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  quickWidgetValue: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 22,
    marginTop: 4,
  },
  studioCard: {
    ...shadows.soft,
    backgroundColor: '#EDF6FF',
    borderColor: '#CFE4F8',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  studioTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  studioSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  studioActionRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    marginRight: 8,
    paddingVertical: 11,
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 5,
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: '#D9EAFA',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  secondaryActionText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 5,
  },
  foundActionButton: {
    alignItems: 'center',
    backgroundColor: '#274890',
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 10,
  },
  foundActionButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 5,
  },
  boardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  claimSectionHeaderCard: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: '#EEF4FF',
    borderColor: '#CBDCFF',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  claimSectionHeaderCardCompact: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: '#F4F8FF',
    borderColor: '#E0E8FF',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  boardTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 19,
  },
  sectionSupportText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  sectionCountBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    minWidth: 34,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  sectionCountBadgeText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  sectionCountBadgeMuted: {
    alignItems: 'center',
    backgroundColor: '#E2EBFF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    minWidth: 34,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  sectionCountBadgeMutedText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  boardRefresh: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  claimCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 10,
    padding: 11,
  },
  claimHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  claimTitle: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 14,
    marginRight: 6,
  },
  claimScore: {
    backgroundColor: '#E8EEFF',
    borderRadius: radii.pill,
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  claimMetaText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 12,
    marginTop: 5,
  },
  claimMetaSubText: {
    color: colors.outline,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 11,
    marginTop: 5,
  },
  claimProofImage: {
    backgroundColor: '#F4F6FA',
    borderColor: '#E2E5EB',
    borderWidth: 1,
    borderRadius: 10,
    height: 148,
    marginTop: 8,
    width: '100%',
  },
  claimActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 9,
  },
  actionButtonInnerRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  messageButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    marginRight: 8,
    minWidth: 84,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  messageButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  rejectButton: {
    alignItems: 'center',
    backgroundColor: '#F0F2F4',
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    marginRight: 8,
    minWidth: 84,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rejectButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  approveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: 'center',
    minWidth: 136,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  approveButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  pickupButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 36,
    paddingHorizontal: 10,
  },
  pickupButtonCompact: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 132,
    paddingHorizontal: 10,
  },
  pickupButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  historyOverviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  historyOverviewCard: {
    alignItems: 'center',
    backgroundColor: '#F6F9FF',
    borderColor: '#DCE6FA',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    marginRight: 8,
    paddingVertical: 10,
  },
  historyOverviewValue: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
  },
  historyOverviewLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  historyFilterRow: {
    alignItems: 'center',
    backgroundColor: '#F8FAFF',
    borderColor: '#DEE7FA',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
    padding: 6,
  },
  historyFilterChip: {
    alignItems: 'center',
    backgroundColor: '#EDF2FD',
    borderColor: '#D9E4F8',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 3,
    marginRight: '2%',
    minWidth: '31%',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  historyFilterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  historyFilterText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  historyFilterTextActive: {
    color: colors.onPrimary,
  },
  historyFilterCount: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 6,
    opacity: 0.72,
  },
  historyFilterCountActive: {
    color: colors.onPrimary,
    opacity: 1,
  },
  historyCard: {
    backgroundColor: '#FCFDFF',
    borderColor: '#DCE5F7',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  historyCardFocused: {
    backgroundColor: '#F1F6FF',
    borderColor: colors.primary,
    borderWidth: 2,
  },
  focusedClaimTag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#DDE8FF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  focusedClaimTagText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  historyTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  historyTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 14,
  },
  historyRoleTag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FA',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  historyRoleTagText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  historyStatus: {
    borderRadius: radii.pill,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  historyMeta: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 11,
    marginTop: 4,
  },
  historyMetaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  historyMetaPill: {
    alignItems: 'center',
    backgroundColor: '#F3F6FD',
    borderColor: '#E0E7F6',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 7,
    marginRight: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  historyMetaPillText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginLeft: 5,
  },
  historyProofWrap: {
    marginTop: 3,
  },
  historyProofLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  historyProofImage: {
    backgroundColor: '#F4F6FA',
    borderColor: '#E2E5EB',
    borderWidth: 1,
    borderRadius: 10,
    height: 144,
    width: '100%',
  },
  historyActionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  historyMessageButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
    marginRight: 8,
    minHeight: 36,
    minWidth: 96,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  historyMessageButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  historyPrimaryActionButton: {
    marginBottom: 8,
    marginRight: 8,
  },
  undoPickupButton: {
    alignItems: 'center',
    backgroundColor: '#EBF1FF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
    marginLeft: 0,
    minHeight: 36,
    paddingHorizontal: 10,
  },
  undoPickupButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  emptyBoardCardLarge: {
    alignItems: 'center',
    backgroundColor: '#F7FAFF',
    borderColor: '#DAE6FA',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  emptyStateIconWrap: {
    alignItems: 'center',
    backgroundColor: '#E4EEFF',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  emptyBoardTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 15,
    marginTop: 8,
  },
  emptyBoardSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyBoardActionButton: {
    alignItems: 'center',
    backgroundColor: '#E3ECFF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyBoardActionButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 5,
    textTransform: 'uppercase',
  },
  boardCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginRight: 9,
    padding: 10,
    width: 190,
  },
  boardImage: {
    borderRadius: 10,
    height: 108,
    marginBottom: 8,
    width: '100%',
  },
  boardImageFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: 10,
    height: 108,
    justifyContent: 'center',
    marginBottom: 8,
    width: '100%',
  },
  boardItemTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 14,
    marginBottom: 3,
  },
  boardItemLocation: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginBottom: 6,
  },
  boardMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  boardChip: {
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  boardAgo: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  emptyBoardCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.16)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  emptyBoardText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 7,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.44)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdropCenter: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.44)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  infoModalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    width: '100%',
  },
  infoModalTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  infoModalText: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    marginTop: 6,
  },
  infoModalTextMuted: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  infoModalActionsRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  infoModalSecondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 38,
  },
  infoModalSecondaryActionText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  infoModalPrimaryAction: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  infoModalPrimaryActionText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '94%',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 24,
  },
  modalSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  modalScrollContent: {
    paddingBottom: 20,
  },
  claimModeBadgeRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#EAF1FF',
    borderColor: '#C8D8FA',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  claimModeBadgeText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  claimSelectionCard: {
    backgroundColor: '#F4F7FF',
    borderColor: '#DCE5FB',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 10,
  },
  mediaSectionCard: {
    backgroundColor: '#FBFCFF',
    borderColor: '#DFE6F5',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 10,
  },
  detailsSectionCard: {
    backgroundColor: '#FBFCFF',
    borderColor: '#DFE6F5',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 10,
  },
  claimModeCard: {
    backgroundColor: '#F9FBFF',
    borderColor: '#C9D9F8',
  },
  claimChecklistCard: {
    backgroundColor: '#EEF4FF',
    borderColor: '#CBDCFA',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  claimChecklistRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 6,
  },
  claimChecklistText: {
    color: colors.primary,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  messagesSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    minHeight: '64%',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  messagesItemTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 13,
    marginBottom: 8,
  },
  messagesLoadingWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  messagesLoadingText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    marginLeft: 7,
  },
  messagesScroll: {
    marginBottom: 10,
    maxHeight: 300,
  },
  messageBubble: {
    borderRadius: 12,
    marginBottom: 8,
    maxWidth: '88%',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  messageBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#DCE7FF',
  },
  messageBubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceLow,
  },
  messageBubbleText: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
  },
  messageBubbleMeta: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  messagesComposerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 18,
  },
  messagesInput: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceHigh,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  messagesSendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: 38,
    minWidth: 82,
    paddingHorizontal: 10,
  },
  messagesSendButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  claimTargetList: {
    paddingBottom: 2,
    paddingRight: 6,
  },
  claimTargetChip: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.2)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    width: 170,
  },
  claimTargetChipActive: {
    backgroundColor: '#E8EEFF',
    borderColor: '#A9BCF2',
  },
  claimTargetTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 12,
  },
  claimTargetTitleActive: {
    color: colors.primary,
  },
  claimTargetMeta: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 3,
  },
  claimTargetMetaActive: {
    color: colors.primary,
  },
  selectedTargetHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginBottom: 4,
    marginTop: 8,
  },
  claimFlowHintCard: {
    alignItems: 'center',
    backgroundColor: '#EAF1FF',
    borderColor: '#D2DEFF',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  claimFlowHintText: {
    color: colors.primary,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  emptySelectionCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.2)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  emptySelectionText: {
    color: colors.onSurfaceVariant,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 6,
  },
  imagePickerWrap: {
    alignItems: 'center',
    backgroundColor: '#F2F5FC',
    borderColor: '#C7D2EA',
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 210,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    height: '100%',
    width: '100%',
  },
  previewPlaceholder: {
    alignItems: 'center',
  },
  previewPlaceholderText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 8,
  },
  modalActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  modalActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3EDFB',
    borderColor: '#C8D8FA',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexBasis: '48.5%',
    justifyContent: 'center',
    marginBottom: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalActionChipText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  modalActionChipPrimary: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    flexDirection: 'row',
    flexBasis: '48.5%',
    justifyContent: 'center',
    marginBottom: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalActionChipPrimaryText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  modalActionIconButton: {
    alignItems: 'center',
    backgroundColor: '#FFF4E5',
    borderColor: '#F3D2A4',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexBasis: '48.5%',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalActionIconButtonDisabled: {
    opacity: 0.6,
  },
  modalActionIconButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  scanCard: {
    backgroundColor: '#EAF8F0',
    borderColor: '#CBE9D9',
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 10,
    padding: 10,
  },
  scanTitle: {
    color: '#16543A',
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 14,
  },
  scanMeta: {
    color: '#1C6A48',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 3,
  },
  scanTags: {
    color: '#1C6A48',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 3,
  },
  inputLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D5DCEB',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMultiline: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D5DCEB',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    minHeight: 92,
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  locationInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  locationInputField: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D5DCEB',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  locationPinButton: {
    alignItems: 'center',
    backgroundColor: '#E8EEFF',
    borderColor: '#C8D8FA',
    borderRadius: radii.md,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    marginLeft: 8,
    width: 42,
  },
  locationPinButtonDisabled: {
    opacity: 0.65,
  },
  aiAssistCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    width: '100%',
  },
  aiAssistHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  aiAssistTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 16,
    marginLeft: 6,
  },
  aiAssistSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
    marginTop: 8,
  },
  aiAssistStepRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8,
  },
  aiAssistStepText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 8,
  },
  aiAssistStepTextDone: {
    color: '#1C6E44',
    fontFamily: fontFamily.bodySemiBold,
  },
  aiDraftCard: {
    backgroundColor: '#F3F6FF',
    borderColor: '#DCE5FB',
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 10,
  },
  aiDraftLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.7,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  aiDraftValue: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  aiDraftMeta: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginTop: 10,
  },
  aiAssistActionsRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  aiAssistSecondaryButtonSingle: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 38,
  },
  aiAssistSecondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 38,
  },
  aiAssistSecondaryButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  aiAssistPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  aiAssistPrimaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  errorWrap: {
    alignItems: 'center',
    backgroundColor: '#FFE8E8',
    borderColor: '#F2C6C6',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: {
    color: colors.error,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  noticeWrap: {
    alignItems: 'center',
    backgroundColor: '#EAF8F0',
    borderColor: '#CBE9D9',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  noticeText: {
    color: '#1E6B49',
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 6,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 18,
    marginTop: 2,
    minHeight: 54,
    paddingVertical: 13,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 14,
    marginLeft: 6,
  },
});