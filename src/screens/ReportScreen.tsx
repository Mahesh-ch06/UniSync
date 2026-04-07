import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from '@clerk/clerk-expo';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { backendEnv } from '../config/env';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const allTags = ['Blue', 'Electronics', 'Apple', 'Case', 'Personalized', 'Small'];
const REQUEST_TIMEOUT_MS = 15000;

type ReportStatusTone = 'neutral' | 'success' | 'error';
type ReportPopupTone = 'success' | 'warning';

type PickedImage = {
  uri: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  fileName: string;
};

type VisionDetection = {
  label: string;
  category: string;
  confidence: number;
  tags: string[];
};

type SubmissionPopupState = {
  visible: boolean;
  tone: ReportPopupTone;
  title: string;
  message: string;
  openHistory: boolean;
  requestId: string;
};

type ReportTabParamList = {
  Home: undefined;
  Map: undefined;
  Report: undefined;
  History:
    | {
        focusRequestId?: string;
        focusFoundItemId?: string;
        focusNonce?: number;
        autoOpenMessages?: boolean;
      }
    | undefined;
  Profile: undefined;
  Settings: undefined;
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

function toTagLabel(value: string): string {
  const normalized = readText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return '';
  }

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeDetection(value: unknown): VisionDetection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const label = toTagLabel(readText(payload.label)) || 'Personal Item';
  const category = toTagLabel(readText(payload.category)) || 'General';
  const confidence = Math.max(0, Math.min(1, readNumber(payload.confidence) || 0));

  const tags = Array.isArray(payload.tags)
    ? payload.tags
        .map((entry) => toTagLabel(readText(entry)))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    label,
    category,
    confidence,
    tags,
  };
}

function mergeTags(current: string[], next: string[]): string[] {
  const unique = Array.from(
    new Set(
      [...current, ...next]
        .map((value) => toTagLabel(value))
        .filter(Boolean),
    ),
  );

  return unique.slice(0, 8);
}

function buildAiSuggestedQuestion(detection: VisionDetection): string {
  const label = detection.label.toLowerCase() || 'item';
  const category = detection.category.toLowerCase();

  if (/(electronic|phone|laptop|device|tablet)/.test(category)) {
    return `What unique lock screen, sticker, or case detail is on this ${label}?`;
  }

  if (/(wallet|identity|card|id)/.test(category)) {
    return `What exact name, card detail, or identifier is inside this ${label}?`;
  }

  if (/(key|keys)/.test(category)) {
    return `How many keys are attached and what unique keychain detail does this ${label} have?`;
  }

  if (detection.tags.length > 0) {
    const hintTag = detection.tags[0].toLowerCase();
    return `What unique ${hintTag} detail can prove this ${label} belongs to you?`;
  }

  return `What unique mark or detail can prove this ${label} belongs to you?`;
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

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: unknown;
      details?: unknown;
    };

    const errorText = readText(payload.error);
    const detailsText = readText(payload.details);

    if (errorText && detailsText) {
      return `${errorText}: ${detailsText}`;
    }

    return errorText || detailsText || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function ReportScreen() {
  const { getToken } = useAuth();
  const navigation = useNavigation<BottomTabNavigationProp<ReportTabParamList, 'Report'>>();
  const backendBaseUrl = useMemo(() => backendEnv.backendUrl.replace(/\/+$/, ''), []);

  const [selectedTags, setSelectedTags] = useState<string[]>(['Blue', 'Electronics', 'Apple']);
  const [question, setQuestion] = useState('');
  const [selectedImage, setSelectedImage] = useState<PickedImage | null>(null);
  const [scanDetection, setScanDetection] = useState<VisionDetection | null>(null);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState<ReportStatusTone>('neutral');
  const [submissionPopup, setSubmissionPopup] = useState<SubmissionPopupState>({
    visible: false,
    tone: 'success',
    title: '',
    message: '',
    openHistory: false,
    requestId: '',
  });

  const canSubmit = useMemo(
    () => question.trim().length > 8 && Boolean(selectedImage),
    [question, selectedImage],
  );

  const visibleTags = useMemo(() => mergeTags(allTags, selectedTags), [selectedTags]);

  const previewUri =
    selectedImage?.uri ||
    'https://lh3.googleusercontent.com/aida-public/AB6AXuD5orpYUAZ2FU165f--XS5tNxEmJcZa_rgO2SAwnEl6HuIjMATHRMd-T1Q7b-m9x6mfL80YZFImoc436sLb8s1oyvfknVtV-8PScj08_DJxyr8x8p1A8T0hf9u1jipUlSBKBQsl_teW5SgHPybwR5NDRQih7NOWeWZvoqDlydWK8ZeFgRcsOH3q2vQY8OL79qbjUgHQai4nq89nBTheiQSgEHPoC40OGQmlWMWYPQUraLUBFnLB5YoEJR7TC3MkzNeBsrcF6SacPUtC';

  const updateStatus = useCallback((message: string, tone: ReportStatusTone = 'neutral') => {
    setStatusMessage(message);
    setStatusTone(tone);
  }, []);

  const openSubmissionPopup = useCallback(
    ({
      tone,
      title,
      message,
      openHistory,
      requestId,
    }: Omit<SubmissionPopupState, 'visible'>) => {
      setSubmissionPopup({
        visible: true,
        tone,
        title,
        message,
        openHistory,
        requestId,
      });
    },
    [],
  );

  const closeSubmissionPopup = useCallback(() => {
    setSubmissionPopup((previous) => ({ ...previous, visible: false }));
  }, []);

  const handlePopupPrimaryAction = useCallback(() => {
    const openHistory = submissionPopup.openHistory;
    const requestId = submissionPopup.requestId;

    closeSubmissionPopup();

    if (!openHistory) {
      return;
    }

    navigation.navigate('History', {
      focusRequestId: requestId || undefined,
      focusNonce: Date.now(),
      autoOpenMessages: false,
    });
  }, [closeSubmissionPopup, navigation, submissionPopup.openHistory, submissionPopup.requestId]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => {
      if (current.includes(tag)) {
        return current.filter((value) => value !== tag);
      }

      return [...current, tag];
    });
  };

  const classifySelectedImage = useCallback(
    async (options?: { silent?: boolean }): Promise<VisionDetection | null> => {
      if (isDetecting || isSubmitting) {
        return null;
      }

      if (!selectedImage) {
        if (!options?.silent) {
          updateStatus('Add a photo first, then run AI scan.', 'error');
        }
        return null;
      }

      if (!backendBaseUrl) {
        updateStatus('Backend URL is missing. Configure EXPO_PUBLIC_BACKEND_URL first.', 'error');
        return null;
      }

      const token = await getToken().catch(() => null);
      if (!token) {
        updateStatus('Sign in again to use AI scan.', 'error');
        return null;
      }

      setIsDetecting(true);

      if (!options?.silent) {
        updateStatus('AI is scanning your image...', 'neutral');
      }

      try {
        const response = await fetchWithTimeout(`${backendBaseUrl}/api/vision/classify-item`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_base64: selectedImage.base64,
            mime_type: selectedImage.mimeType,
            width: selectedImage.width,
            height: selectedImage.height,
            file_name: selectedImage.fileName,
            hint_text: question.trim(),
          }),
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response));
        }

        const payload = (await response.json()) as { detection?: unknown };
        const detection = normalizeDetection(payload.detection);

        if (!detection) {
          if (!options?.silent) {
            updateStatus('AI scan finished, but no detection data was returned.', 'error');
          }
          return null;
        }

        setScanDetection(detection);
        setSelectedTags((current) =>
          mergeTags(current, [detection.category, detection.label, ...detection.tags]),
        );

        if (!options?.silent) {
          updateStatus(
            `AI detected ${detection.label} (${Math.round(detection.confidence * 100)}% confidence). Tags updated.`,
            'success',
          );
        }

        return detection;
      } catch (error) {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'AI scan failed. Please try again.';

        updateStatus(message, 'error');
        return null;
      } finally {
        setIsDetecting(false);
      }
    },
    [backendBaseUrl, getToken, isDetecting, isSubmitting, question, selectedImage, updateStatus],
  );

  const handlePickImage = useCallback(async () => {
    if (isPickingImage) {
      return;
    }

    setIsPickingImage(true);
    updateStatus('');

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        updateStatus('Allow photo access to add an item image.', 'error');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const uri = readText(asset?.uri);
      const base64 = readText(asset?.base64);

      if (!uri || !base64) {
        updateStatus('Could not read selected image.', 'error');
        return;
      }

      setSelectedImage({
        uri,
        base64,
        mimeType: readText(asset?.mimeType) || 'image/jpeg',
        width: readNumber(asset?.width),
        height: readNumber(asset?.height),
        fileName: readText(asset?.fileName) || `report-${Date.now()}.jpg`,
      });
      setScanDetection(null);
      updateStatus('Photo added. Tap AI scan to suggest tags before submitting.', 'success');
    } catch {
      updateStatus('Could not open image picker. Please try again.', 'error');
    } finally {
      setIsPickingImage(false);
    }
  }, [isPickingImage, updateStatus]);

  const handleAiScan = useCallback(async () => {
    await classifySelectedImage();
  }, [classifySelectedImage]);

  const handleSubmitReport = useCallback(async () => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    if (!selectedImage) {
      updateStatus('Please add an image before submitting.', 'error');
      return;
    }

    if (!backendBaseUrl) {
      updateStatus('Backend URL is missing. Configure EXPO_PUBLIC_BACKEND_URL first.', 'error');
      return;
    }

    const token = await getToken().catch(() => null);
    if (!token) {
      updateStatus('Please sign in again to submit a secure claim.', 'error');
      return;
    }

    setIsSubmitting(true);
    updateStatus('Submitting report and running auto-match...', 'neutral');

    try {
      const response = await fetchWithTimeout(`${backendBaseUrl}/api/match-requests/auto`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proof_image_base64: selectedImage.base64,
          mime_type: selectedImage.mimeType,
          width: selectedImage.width,
          height: selectedImage.height,
          file_name: selectedImage.fileName,
          hint_text: question.trim(),
          location_hint: selectedTags.join(', '),
          lost_title: 'Lost personal item',
          lost_description: question.trim(),
          detected_label: scanDetection?.label,
          detected_category: scanDetection?.category,
        }),
      });

      if (response.status === 409) {
        const duplicatePayload = (await response.json().catch(() => null)) as {
          error?: unknown;
          existingRequestId?: unknown;
        } | null;

        const existingRequestId = readText(duplicatePayload?.existingRequestId);
        const duplicateMessage =
          readText(duplicatePayload?.error) || 'This item is already submitted.';

        updateStatus(duplicateMessage, 'error');
        openSubmissionPopup({
          tone: 'warning',
          title: 'Already Submitted',
          message: 'This item is already submitted. You can track the request in History.',
          openHistory: true,
          requestId: existingRequestId,
        });
        return;
      }

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as {
        matched?: unknown;
        reason?: unknown;
        pointsAwarded?: unknown;
        request?: unknown;
        foundItem?: unknown;
        bestSuggestion?: unknown;
        detection?: unknown;
      };

      const detection = normalizeDetection(payload.detection);
      if (detection) {
        setScanDetection(detection);
        setSelectedTags((current) =>
          mergeTags(current, [detection.category, detection.label, ...detection.tags]),
        );
      }

      const requestRecord =
        payload.request && typeof payload.request === 'object'
          ? (payload.request as Record<string, unknown>)
          : null;
      const foundItemRecord =
        payload.foundItem && typeof payload.foundItem === 'object'
          ? (payload.foundItem as Record<string, unknown>)
          : null;
      const requestId = readText(requestRecord?.id);
      const foundTitle = readText(foundItemRecord?.title) || 'matching item';
      const pointsAwarded = Math.max(0, Math.floor(readNumber(payload.pointsAwarded)));
      const matched = Boolean(payload.matched);

      if (matched && requestId) {
        updateStatus(
          `Match found for ${foundTitle}. Claim sent${pointsAwarded ? ` (+${pointsAwarded} points)` : ''}.`,
          'success',
        );
        setQuestion('');
        openSubmissionPopup({
          tone: 'success',
          title: 'Successfully Submitted',
          message: `Your secure match request was submitted for ${foundTitle}.`,
          openHistory: true,
          requestId,
        });

        return;
      }

      const reason = readText(payload.reason) || 'No strong match yet, but your report is saved.';
      const suggestionRecord =
        payload.bestSuggestion && typeof payload.bestSuggestion === 'object'
          ? (payload.bestSuggestion as Record<string, unknown>)
          : null;
      const suggestionTitle = readText(suggestionRecord?.title);
      const suggestionScore = Math.floor(readNumber(suggestionRecord?.score));

      if (suggestionTitle && suggestionScore > 0) {
        updateStatus(
          `${reason} Best current suggestion: ${suggestionTitle} (${suggestionScore}% match).`,
          'neutral',
        );
        openSubmissionPopup({
          tone: 'success',
          title: 'Successfully Submitted',
          message: `${reason} Best suggestion: ${suggestionTitle} (${suggestionScore}% match).`,
          openHistory: false,
          requestId: '',
        });
      } else {
        updateStatus(reason, 'neutral');
        openSubmissionPopup({
          tone: 'success',
          title: 'Successfully Submitted',
          message: reason,
          openHistory: false,
          requestId: '',
        });
      }
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Could not submit report. Please try again.';

      updateStatus(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    backendBaseUrl,
    canSubmit,
    getToken,
    isSubmitting,
    navigation,
    question,
    scanDetection,
    selectedImage,
    selectedTags,
    openSubmissionPopup,
    updateStatus,
  ]);

  const handleQuickFillQuestion = useCallback(async () => {
    if (!selectedImage) {
      return;
    }

    if (isGeneratingQuestion || isSubmitting) {
      return;
    }

    setIsGeneratingQuestion(true);

    try {
      const detection = scanDetection ?? (await classifySelectedImage({ silent: true }));

      if (!detection) {
        return;
      }

      const suggestedQuestion = buildAiSuggestedQuestion(detection);
      setQuestion(suggestedQuestion);
      updateStatus('AI suggested a question from your uploaded photo. You can edit it before submit.', 'success');
    } finally {
      setIsGeneratingQuestion(false);
    }
  }, [
    classifySelectedImage,
    isGeneratingQuestion,
    isSubmitting,
    scanDetection,
    selectedImage,
    updateStatus,
  ]);

  const isScanDisabled = !selectedImage || isDetecting || isSubmitting || isGeneratingQuestion;
  const isQuestionSuggestionAvailable = Boolean(selectedImage);
  const isQuestionSuggestionBusy = isGeneratingQuestion || isDetecting;
  const statusToneStyle =
    statusTone === 'success'
      ? styles.statusTextSuccess
      : statusTone === 'error'
        ? styles.statusTextError
        : styles.statusTextNeutral;
  const popupToneStyle =
    submissionPopup.tone === 'warning' ? styles.submitPopupCardWarning : styles.submitPopupCardSuccess;
  const popupIconName = submissionPopup.tone === 'warning' ? 'report' : 'check-circle';

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar
        leftIcon="home"
        onLeftPress={() => navigation.navigate('Home')}
        onRightPress={() => navigation.navigate('Settings')}
        rightIcon="settings"
        title="UniSync"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => void handlePickImage()} style={styles.uploadZone}>
          <Image
            source={{
              uri: previewUri,
            }}
            style={styles.uploadImage}
          />
          <View style={styles.uploadOverlay}>
            <View style={styles.uploadIconCircle}>
              <MaterialIcons color={colors.onPrimary} name="photo-camera" size={30} />
            </View>
            <Text style={styles.uploadTitle}>{selectedImage ? 'Change Photo' : 'Add Object Photo'}</Text>
            <Text style={styles.uploadHint}>
              {isPickingImage ? 'Opening gallery...' : 'Tap to choose a clear image for AI matching'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>AI Auto-Tags</Text>
          <View style={styles.assistantBadge}>
            <Text style={styles.assistantBadgeText}>Assistant Active</Text>
          </View>
        </View>

        <View style={styles.tagsWrap}>
          {visibleTags.map((tag) => {
            const selected = selectedTags.includes(tag);

            return (
              <Pressable
                key={tag}
                onPress={() => toggleTag(tag)}
                style={[styles.tagChip, selected ? styles.tagChipSelected : styles.tagChipIdle]}
              >
                <Text style={[styles.tagText, selected ? styles.tagTextSelected : undefined]}>{tag}</Text>
                {selected ? (
                  <MaterialIcons
                    color={colors.onPrimary}
                    name="check"
                    size={14}
                    style={styles.tagIcon}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          disabled={isScanDisabled}
          onPress={() => void handleAiScan()}
          style={[styles.scanButton, isScanDisabled ? styles.scanButtonDisabled : undefined]}
        >
          <MaterialIcons
            color={isScanDisabled ? colors.onSurfaceVariant : colors.primary}
            name="auto-awesome"
            size={16}
          />
          <Text style={[styles.scanButtonText, isScanDisabled ? styles.scanButtonTextDisabled : undefined]}>
            {isDetecting ? 'Scanning with AI...' : 'Scan With AI'}
          </Text>
        </Pressable>

        {scanDetection ? (
          <View style={styles.scanResultCard}>
            <Text style={styles.scanResultTitle}>AI Result</Text>
            <Text style={styles.scanResultMeta}>
              {scanDetection.label} • {scanDetection.category} •{' '}
              {Math.round(scanDetection.confidence * 100)}% confidence
            </Text>
            {scanDetection.tags.length ? (
              <Text style={styles.scanResultHint}>
                Detected tags: {scanDetection.tags.join(', ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.ownershipCard}>
          <MaterialIcons
            color="rgba(225,124,90,0.12)"
            name="verified-user"
            size={84}
            style={styles.watermark}
          />
          <Text style={styles.ownershipTitle}>Proof of Ownership Setup</Text>
          <Text style={styles.ownershipSubtitle}>
            Create a security gate to ensure the item reaches its rightful owner.
          </Text>

          <Text style={styles.questionLabel}>Secret Question</Text>
          {isQuestionSuggestionAvailable ? (
            <Pressable
              disabled={isQuestionSuggestionBusy || isSubmitting}
              onPress={() => void handleQuickFillQuestion()}
              style={[
                styles.quickFillButton,
                (isQuestionSuggestionBusy || isSubmitting) ? styles.quickFillButtonDisabled : undefined,
              ]}
            >
              <MaterialIcons
                color={(isQuestionSuggestionBusy || isSubmitting) ? colors.onSurfaceVariant : colors.primary}
                name="auto-awesome"
                size={14}
              />
              <Text
                style={[
                  styles.quickFillButtonText,
                  (isQuestionSuggestionBusy || isSubmitting) ? styles.quickFillButtonTextDisabled : undefined,
                ]}
              >
                {isQuestionSuggestionBusy ? 'Generating AI question...' : 'Use AI suggested question'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.questionAssistHint}>Upload a photo to unlock AI suggested question.</Text>
          )}

          <TextInput
            multiline
            onChangeText={setQuestion}
            placeholder="e.g., What is the lock screen wallpaper?"
            placeholderTextColor="rgba(118, 118, 131, 0.72)"
            style={styles.questionInput}
            value={question}
          />

          <Pressable
            disabled={!canSubmit || isSubmitting}
            onPress={() => void handleSubmitReport()}
            style={styles.submitOuter}
          >
            <LinearGradient
              colors={
                canSubmit && !isSubmitting
                  ? [colors.primary, colors.primaryContainer]
                  : ['#A9AECE', '#959AB5']
              }
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.submitGradient}
            >
              <Text style={styles.submitText}>{isSubmitting ? 'Matching...' : 'Secure & Match Item'}</Text>
            </LinearGradient>
          </Pressable>

          {statusMessage ? <Text style={[styles.statusText, statusToneStyle]}>{statusMessage}</Text> : null}
        </View>
      </ScrollView>

      <Modal animationType="fade" transparent visible={submissionPopup.visible}>
        <View style={styles.submitPopupBackdrop}>
          <View style={[styles.submitPopupCard, popupToneStyle]}>
            <View style={styles.submitPopupTitleRow}>
              <MaterialIcons
                color={submissionPopup.tone === 'warning' ? '#8A5318' : colors.success}
                name={popupIconName}
                size={20}
              />
              <Text style={styles.submitPopupTitle}>{submissionPopup.title}</Text>
            </View>

            <Text style={styles.submitPopupMessage}>{submissionPopup.message}</Text>

            <View style={styles.submitPopupActionsRow}>
              <Pressable onPress={closeSubmissionPopup} style={styles.submitPopupSecondaryButton}>
                <Text style={styles.submitPopupSecondaryButtonText}>Close</Text>
              </Pressable>

              <Pressable onPress={handlePopupPrimaryAction} style={styles.submitPopupPrimaryButton}>
                <Text style={styles.submitPopupPrimaryButtonText}>
                  {submissionPopup.openHistory ? 'Open History' : 'Done'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: 36,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  uploadZone: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderColor: 'rgba(198, 197, 212, 0.6)',
    borderRadius: 32,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: 430,
    justifyContent: 'center',
    marginBottom: 26,
    overflow: 'hidden',
    position: 'relative',
  },
  uploadImage: {
    height: '100%',
    opacity: 0.16,
    position: 'absolute',
    width: '100%',
  },
  uploadOverlay: {
    alignItems: 'center',
  },
  uploadIconCircle: {
    ...shadows.strong,
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    marginBottom: 14,
    width: 64,
  },
  uploadTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 24,
    marginBottom: 6,
  },
  uploadHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 28,
    letterSpacing: -0.6,
  },
  assistantBadge: {
    backgroundColor: 'rgba(92, 24, 0, 0.08)',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assistantBadgeText: {
    color: colors.onTertiaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  tagChip: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 10,
    marginRight: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  tagChipSelected: {
    backgroundColor: colors.primary,
  },
  tagChipIdle: {
    backgroundColor: colors.surfaceHigh,
  },
  tagText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  tagTextSelected: {
    color: colors.onPrimary,
  },
  tagIcon: {
    marginLeft: 4,
  },
  scanButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E9EEFF',
    borderColor: 'rgba(0, 6, 102, 0.14)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scanButtonDisabled: {
    backgroundColor: '#ECECF1',
    borderColor: '#D1D4DE',
  },
  scanButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  scanButtonTextDisabled: {
    color: colors.onSurfaceVariant,
  },
  scanResultCard: {
    backgroundColor: '#F4F7FF',
    borderColor: '#D7E2FF',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scanResultTitle: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.2,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  scanResultMeta: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  scanResultHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  ownershipCard: {
    ...shadows.soft,
    backgroundColor: colors.surfaceLow,
    borderRadius: 30,
    overflow: 'hidden',
    padding: 22,
    position: 'relative',
  },
  watermark: {
    position: 'absolute',
    right: 12,
    top: 10,
  },
  ownershipTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 28,
    lineHeight: 30,
    marginBottom: 8,
    maxWidth: '78%',
  },
  ownershipSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    maxWidth: '90%',
  },
  questionLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  quickFillButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E9EEFF',
    borderColor: 'rgba(0, 6, 102, 0.14)',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  quickFillButtonDisabled: {
    backgroundColor: '#ECECF1',
    borderColor: '#D1D4DE',
  },
  quickFillButtonText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 4,
  },
  quickFillButtonTextDisabled: {
    color: colors.onSurfaceVariant,
  },
  questionAssistHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  questionInput: {
    backgroundColor: colors.surfaceHighest,
    borderRadius: radii.lg,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
    minHeight: 110,
    paddingHorizontal: 16,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  submitOuter: {
    marginTop: 16,
  },
  submitGradient: {
    alignItems: 'center',
    borderRadius: radii.lg,
    justifyContent: 'center',
    paddingVertical: 15,
  },
  submitText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 17,
  },
  submitPopupBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(9, 12, 24, 0.5)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  submitPopupCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    maxWidth: 420,
    paddingHorizontal: 16,
    paddingVertical: 16,
    width: '100%',
  },
  submitPopupCardSuccess: {
    borderColor: '#CDEDD9',
  },
  submitPopupCardWarning: {
    borderColor: '#F3D9B8',
  },
  submitPopupTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  submitPopupTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 18,
    marginLeft: 7,
  },
  submitPopupMessage: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  submitPopupActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  submitPopupSecondaryButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2FA',
    borderRadius: radii.pill,
    justifyContent: 'center',
    minWidth: 82,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  submitPopupSecondaryButtonText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  submitPopupPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginLeft: 8,
    minWidth: 110,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  submitPopupPrimaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  statusText: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  statusTextNeutral: {
    color: colors.onSurfaceVariant,
  },
  statusTextSuccess: {
    color: colors.success,
  },
  statusTextError: {
    color: colors.error,
  },
});