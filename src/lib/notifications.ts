import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { colors } from '../theme/tokens';

export const NOTIFICATION_SEEN_STORAGE_PREFIX = 'notifications-seen-v1';

export type NotificationEntry = {
  id: string;
  requestId: string;
  foundItemId: string;
  title: string;
  subtitle: string;
  timestampMs: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  iconBackground: string;
  autoOpenMessages: boolean;
};

function readText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function parseTimestamp(...rawValues: unknown[]): number {
  for (const value of rawValues) {
    const parsed = new Date(readText(value)).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return Date.now();
}

function readPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function mapHistoryRowToNotification(
  row: Record<string, unknown>,
  currentUserId: string,
): NotificationEntry | null {
  const requestId = readText(row.id);
  const status = readText(row.status).toLowerCase();
  const claimantUserId = readText(row.claimant_user_id);
  const foundItemRaw =
    row.found_item && typeof row.found_item === 'object'
      ? (row.found_item as Record<string, unknown>)
      : null;

  const foundItemId = readText(foundItemRaw?.id ?? row.found_item_id);
  const foundItemTitle = readText(foundItemRaw?.title) || 'Found item';
  const foundItemLocation = readText(foundItemRaw?.location) || 'Campus location';
  const ownerUserId = readText(foundItemRaw?.created_by);

  if (!requestId || !foundItemId || !status) {
    return null;
  }

  const isOwner = ownerUserId === currentUserId;
  const isClaimant = claimantUserId === currentUserId;

  if (!isOwner && !isClaimant) {
    return null;
  }

  const eventMs = parseTimestamp(row.pickup_confirmed_at, row.reviewed_at, row.created_at);
  const eventId = `${requestId}:${status}:${eventMs}`;

  if (status === 'submitted') {
    if (isOwner) {
      return {
        id: eventId,
        requestId,
        foundItemId,
        title: `New claim request on ${foundItemTitle}`,
        subtitle: 'Review this request in History and respond.',
        timestampMs: eventMs,
        icon: 'notifications-active',
        iconColor: colors.primaryContainer,
        iconBackground: '#EAF0FF',
        autoOpenMessages: true,
      };
    }

    return {
      id: eventId,
      requestId,
      foundItemId,
      title: `Claim submitted for ${foundItemTitle}`,
      subtitle: 'Waiting for the finder to review your request.',
      timestampMs: eventMs,
      icon: 'schedule',
      iconColor: colors.secondary,
      iconBackground: '#EEF0F7',
      autoOpenMessages: false,
    };
  }

  if (status === 'approved') {
    if (isClaimant) {
      return {
        id: eventId,
        requestId,
        foundItemId,
        title: `Claim approved for ${foundItemTitle}`,
        subtitle: `Pickup location: ${foundItemLocation}.`,
        timestampMs: eventMs,
        icon: 'verified',
        iconColor: colors.success,
        iconBackground: '#E8F8EE',
        autoOpenMessages: true,
      };
    }

    return {
      id: eventId,
      requestId,
      foundItemId,
      title: `You approved a claim for ${foundItemTitle}`,
      subtitle: 'Coordinate handover through History messages.',
      timestampMs: eventMs,
      icon: 'verified-user',
      iconColor: colors.success,
      iconBackground: '#E8F8EE',
      autoOpenMessages: true,
    };
  }

  if (status === 'rejected') {
    if (isClaimant) {
      return {
        id: eventId,
        requestId,
        foundItemId,
        title: `Claim rejected for ${foundItemTitle}`,
        subtitle: 'You can submit a new request with better proof.',
        timestampMs: eventMs,
        icon: 'gpp-bad',
        iconColor: colors.error,
        iconBackground: '#FDECEC',
        autoOpenMessages: false,
      };
    }

    return {
      id: eventId,
      requestId,
      foundItemId,
      title: `You rejected a claim for ${foundItemTitle}`,
      subtitle: 'The claimant has been notified.',
      timestampMs: eventMs,
      icon: 'cancel',
      iconColor: colors.error,
      iconBackground: '#FDECEC',
      autoOpenMessages: false,
    };
  }

  if (status === 'picked_up') {
    if (isClaimant) {
      return {
        id: eventId,
        requestId,
        foundItemId,
        title: `Pickup confirmed for ${foundItemTitle}`,
        subtitle: 'This claim is now completed.',
        timestampMs: eventMs,
        icon: 'inventory-2',
        iconColor: colors.primaryContainer,
        iconBackground: '#EAF0FF',
        autoOpenMessages: false,
      };
    }

    return {
      id: eventId,
      requestId,
      foundItemId,
      title: `You confirmed pickup for ${foundItemTitle}`,
      subtitle: 'The handover is complete and recorded.',
      timestampMs: eventMs,
      icon: 'inventory-2',
      iconColor: colors.primaryContainer,
      iconBackground: '#EAF0FF',
      autoOpenMessages: false,
    };
  }

  if (status === 'cancelled') {
    return {
      id: eventId,
      requestId,
      foundItemId,
      title: `Claim cancelled for ${foundItemTitle}`,
      subtitle: 'No further action is needed for this request.',
      timestampMs: eventMs,
      icon: 'notifications-none',
      iconColor: colors.onSurfaceVariant,
      iconBackground: '#F3F4F5',
      autoOpenMessages: false,
    };
  }

  return null;
}

export function mapHistoryRowsToNotifications(
  rows: Record<string, unknown>[] | undefined,
  currentUserId: string,
  limit: number = 80,
): NotificationEntry[] {
  if (!Array.isArray(rows) || !currentUserId) {
    return [];
  }

  const mapped = rows
    .map((row) => mapHistoryRowToNotification(row, currentUserId))
    .filter((entry): entry is NotificationEntry => Boolean(entry));

  mapped.sort((left, right) => right.timestampMs - left.timestampMs);

  return mapped.slice(0, Math.max(1, limit));
}

export function mapInboxRowToNotification(row: Record<string, unknown>): NotificationEntry | null {
  const id = readText(row.id);
  const type = readText(row.type).toLowerCase();
  const title = readText(row.title) || 'UniSync update';
  const subtitle = readText(row.body || row.message) || 'You have a new notification.';

  if (!id) {
    return null;
  }

  const payload = readPlainObject(row.data);
  const requestId =
    readText(row.request_id) ||
    readText(payload.requestId) ||
    readText(payload.request_id);
  const foundItemId =
    readText(row.found_item_id) ||
    readText(payload.foundItemId) ||
    readText(payload.found_item_id);

  const timestampMs = parseTimestamp(row.created_at, payload.created_at, payload.timestamp);

  if (type === 'admin_broadcast') {
    return {
      id,
      requestId,
      foundItemId,
      title,
      subtitle,
      timestampMs,
      icon: 'campaign',
      iconColor: colors.primaryContainer,
      iconBackground: '#EAF0FF',
      autoOpenMessages: false,
    };
  }

  return {
    id,
    requestId,
    foundItemId,
    title,
    subtitle,
    timestampMs,
    icon: 'notifications-active',
    iconColor: colors.primaryContainer,
    iconBackground: '#EAF0FF',
    autoOpenMessages: Boolean(requestId),
  };
}

export function mapInboxRowsToNotifications(
  rows: Record<string, unknown>[] | undefined,
  limit: number = 80,
): NotificationEntry[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const mapped = rows
    .map((row) => mapInboxRowToNotification(row))
    .filter((entry): entry is NotificationEntry => Boolean(entry));

  mapped.sort((left, right) => right.timestampMs - left.timestampMs);

  return mapped.slice(0, Math.max(1, limit));
}

export function mergeNotificationEntries(
  streams: Array<NotificationEntry[] | undefined>,
  limit: number = 120,
): NotificationEntry[] {
  const byId = new Map<string, NotificationEntry>();

  streams.forEach((stream) => {
    (stream ?? []).forEach((entry) => {
      const existing = byId.get(entry.id);

      if (!existing || entry.timestampMs > existing.timestampMs) {
        byId.set(entry.id, entry);
      }
    });
  });

  return Array.from(byId.values())
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, Math.max(1, limit));
}
