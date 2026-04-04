import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useUser } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type StudioMode = 'lost' | 'claim';

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
  claimableItems?: ClaimableItemOption[];
};

const LEVEL_STEPS = [
  { level: 'Seed', min: 0, max: 49, next: 'Scout', nextTarget: 50 },
  { level: 'Scout', min: 50, max: 149, next: 'Tracker', nextTarget: 150 },
  { level: 'Tracker', min: 150, max: 349, next: 'Guardian', nextTarget: 350 },
  { level: 'Guardian', min: 350, max: 699, next: 'Champion', nextTarget: 700 },
  { level: 'Champion', min: 700, max: 1199, next: 'Legend', nextTarget: 1200 },
  { level: 'Legend', min: 1200, max: Number.MAX_SAFE_INTEGER, next: null, nextTarget: null },
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
  claimableItems = [],
}: CampusActionStudioProps) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
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

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [mode, setMode] = useState<StudioMode>('lost');

  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationHint, setLocationHint] = useState('');
  const [selectedClaimItemId, setSelectedClaimItemId] = useState('');

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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

  const submitLostReport = useCallback(async () => {
    if (!pickedImage) {
      setActionError('Please upload an image first.');
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

        await loadPanelData();
        await Promise.resolve(onActionsFinished?.());

        setPanelNotice(
          `Pickup confirmed. Finder +${finderPoints} points${
            claimantPoints ? `, owner +${claimantPoints} points` : ''
          }. History updated for both users.`,
        );
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

  const isClaimSubmitBlocked = mode === 'claim' && !selectedClaimItemId;

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
          Upload from camera/gallery, detect item type, and submit lost report or claim request instantly.
        </Text>

        <View style={styles.studioActionRow}>
          <Pressable onPress={() => openComposer('lost')} style={styles.primaryAction}>
            <MaterialIcons color={colors.onPrimary} name="add-photo-alternate" size={16} />
            <Text style={styles.primaryActionText}>Report Lost Item</Text>
          </Pressable>

          <Pressable onPress={() => openComposer('claim')} style={styles.secondaryAction}>
            <MaterialIcons color={colors.primary} name="fact-check" size={16} />
            <Text style={styles.secondaryActionText}>Proof Scan Claim</Text>
          </Pressable>
        </View>

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

      <View style={styles.boardHeader}>
        <Text style={styles.boardTitle}>Claim Inbox</Text>
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
              <Image source={{ uri: claim.proof_image_url }} style={styles.claimProofImage} />
            ) : null}

            <Text numberOfLines={1} style={styles.claimMetaSubText}>
              Proof label: {claim.ai_detected_label || 'Manual proof'}
            </Text>

            <View style={styles.claimActionRow}>
              <Pressable
                disabled={Boolean(isResolvingClaimId)}
                onPress={() => void resolveIncomingClaim(claim.id, 'reject')}
                style={styles.rejectButton}
              >
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
                  <Text style={styles.approveButtonText}>Approve + Points</Text>
                )}
              </Pressable>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyBoardCard}>
          <MaterialIcons color={colors.outline} name="inbox" size={18} />
          <Text style={styles.emptyBoardText}>No incoming claims to review.</Text>
        </View>
      )}

      {pickupQueue.length ? (
        <>
          <View style={styles.boardHeader}>
            <Text style={styles.boardTitle}>Pickup Confirmation</Text>
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

              <Pressable
                disabled={Boolean(isConfirmingPickupId)}
                onPress={() => void confirmPickup(claim.id)}
                style={styles.pickupButton}
              >
                {isConfirmingPickupId === claim.id ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.pickupButtonText}>Mark Picked Up</Text>
                )}
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      <View style={styles.boardHeader}>
        <Text style={styles.boardTitle}>Claim History</Text>
      </View>

      {claimHistory.length ? (
        claimHistory.slice(0, compact ? 2 : 5).map((entry) => (
          <View key={`history-${entry.id}`} style={styles.historyCard}>
            <View style={styles.historyTopRow}>
              <Text numberOfLines={1} style={styles.historyTitle}>
                {entry.found_item.title}
              </Text>
              <Text style={styles.historyStatus}>{entry.status.replace('_', ' ')}</Text>
            </View>

            <Text numberOfLines={1} style={styles.historyMeta}>
              Score {entry.match_score}% • {formatRelativeTime(entry.created_at)}
            </Text>
          </View>
        ))
      ) : (
        <View style={styles.emptyBoardCard}>
          <MaterialIcons color={colors.outline} name="history" size={18} />
          <Text style={styles.emptyBoardText}>No claim history yet.</Text>
        </View>
      )}

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

      <Modal animationType="slide" transparent visible={isModalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {mode === 'lost' ? 'Report Lost Product' : 'Claim Product With Proof'}
              </Text>
              <Pressable onPress={closeComposer}>
                <MaterialIcons color={colors.onSurfaceVariant} name="close" size={24} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {mode === 'claim' ? (
                <>
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
                      Claiming: {selectedClaimItem.title} • {selectedClaimItem.location}
                    </Text>
                  ) : null}
                </>
              ) : null}

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
                  <Text style={styles.modalActionChipPrimaryText}>Scan Type</Text>
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

              <Text style={styles.inputLabel}>Item Title</Text>
              <TextInput
                onChangeText={setTitle}
                placeholder="e.g., Black Lenovo Laptop"
                placeholderTextColor={colors.outline}
                style={styles.input}
                value={title}
              />

              <Text style={styles.inputLabel}>Description / Proof Notes</Text>
              <TextInput
                multiline
                onChangeText={setDescription}
                placeholder={
                  mode === 'lost'
                    ? 'Add unique details so owner can identify...'
                    : 'Add ownership proof details...'
                }
                placeholderTextColor={colors.outline}
                style={styles.inputMultiline}
                value={description}
              />

              <Text style={styles.inputLabel}>Location Hint</Text>
              <TextInput
                onChangeText={setLocationHint}
                placeholder="e.g., Main Library, Block B"
                placeholderTextColor={colors.outline}
                style={styles.input}
                value={locationHint}
              />

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

              <Pressable
                disabled={isWorking || isClaimSubmitBlocked}
                onPress={() => void (mode === 'lost' ? submitLostReport() : submitAutoClaim())}
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
                      name={mode === 'lost' ? 'upload' : 'verified-user'}
                      size={17}
                    />
                    <Text style={styles.submitButtonText}>
                      {mode === 'lost'
                        ? 'Submit Lost Product'
                        : 'Submit Claim Request'}
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
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
  boardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  boardTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 19,
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
    marginBottom: 8,
    padding: 10,
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
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  claimMetaText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 5,
  },
  claimMetaSubText: {
    color: colors.outline,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 5,
  },
  claimProofImage: {
    borderRadius: 10,
    height: 124,
    marginTop: 8,
    width: '100%',
  },
  claimActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 9,
  },
  rejectButton: {
    alignItems: 'center',
    backgroundColor: '#F0F2F4',
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginRight: 8,
    minWidth: 84,
    paddingVertical: 8,
  },
  rejectButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
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
  pickupButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.16)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 8,
    padding: 10,
  },
  historyTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyTitle: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 13,
    marginRight: 8,
  },
  historyStatus: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  historyMeta: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 4,
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
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
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
    backgroundColor: colors.surfaceLow,
    borderColor: colors.surfaceHigh,
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 220,
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
    marginTop: 10,
  },
  modalActionChip: {
    alignItems: 'center',
    backgroundColor: '#E3EDFB',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginRight: 8,
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
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalActionChipPrimaryText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
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
    backgroundColor: colors.surface,
    borderColor: colors.surfaceHigh,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMultiline: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceHigh,
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
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 18,
    marginTop: 14,
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