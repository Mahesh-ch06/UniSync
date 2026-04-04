import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
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
import { CampusActionStudio } from '../components/CampusActionStudio';
import { backendEnv } from '../config/env';
import { buildSupabaseClient } from '../lib/supabase';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

type CampusZone = 'Academic' | 'Residence' | 'Transit' | 'Commons' | 'General';
type SortMode = 'latest' | 'recovery';

type FoundItem = {
  id: string;
  title: string;
  location: string;
  foundAgo: string;
  category: string;
  imageUri: string | null;
  categoryTone: 'primary' | 'secondary' | 'neutral';
  createdAtMs: number;
  recoveryScore: number;
  campusZone: CampusZone;
};

type HotspotInsight = {
  location: string;
  count: number;
  recentCount: number;
  previousCount: number;
  trend: number;
  campusZone: CampusZone;
};

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

function resolveCategoryTone(category: string): FoundItem['categoryTone'] {
  const lowered = category.toLowerCase();

  if (lowered.includes('electronic') || lowered.includes('device')) {
    return 'primary';
  }

  if (lowered.includes('key') || lowered.includes('wallet') || lowered.includes('id')) {
    return 'secondary';
  }

  return 'neutral';
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

function resolveCategoryPriority(category: string): number {
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

function resolveZoneVisibilityScore(zone: CampusZone): number {
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

function resolveRecencyScore(createdAtMs: number): number {
  if (createdAtMs <= 0) {
    return 16;
  }

  const ageHours = Math.max(Date.now() - createdAtMs, 0) / (1000 * 60 * 60);

  if (ageHours < 3) {
    return 40;
  }

  if (ageHours < 12) {
    return 34;
  }

  if (ageHours < 24) {
    return 30;
  }

  if (ageHours < 72) {
    return 22;
  }

  if (ageHours < 168) {
    return 16;
  }

  return 10;
}

function computeRecoveryScore(category: string, location: string, createdAtMs: number): number {
  const zone = inferCampusZone(location);
  const score =
    resolveCategoryPriority(category) +
    resolveZoneVisibilityScore(zone) +
    resolveRecencyScore(createdAtMs);

  return Math.max(35, Math.min(99, score));
}

function recoveryTier(score: number): 'Urgent' | 'High' | 'Moderate' {
  if (score >= 82) {
    return 'Urgent';
  }

  if (score >= 68) {
    return 'High';
  }

  return 'Moderate';
}

function recoveryBadgeStyle(score: number): { backgroundColor: string; color: string } {
  const tier = recoveryTier(score);

  if (tier === 'Urgent') {
    return {
      backgroundColor: '#FFE0D8',
      color: '#8A2F13',
    };
  }

  if (tier === 'High') {
    return {
      backgroundColor: '#DCE7FF',
      color: '#224086',
    };
  }

  return {
    backgroundColor: '#E9ECEF',
    color: '#3E4A54',
  };
}

function campusZoneIcon(zone: CampusZone): keyof typeof MaterialIcons.glyphMap {
  if (zone === 'Academic') {
    return 'school';
  }

  if (zone === 'Residence') {
    return 'apartment';
  }

  if (zone === 'Transit') {
    return 'directions-bus';
  }

  if (zone === 'Commons') {
    return 'groups';
  }

  return 'place';
}

function normalizeLocationLabel(location: string): string {
  const split = location.split(',')[0];
  const normalized = split ? split.trim() : '';
  return normalized || 'Campus location';
}

function formatFoundAgo(input: string | null): string {
  if (!input) {
    return 'Found recently';
  }

  const timestamp = new Date(input).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Found recently';
  }

  const diffMs = Math.max(Date.now() - timestamp, 0);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    const diffMinutes = Math.max(Math.floor(diffMs / (1000 * 60)), 1);
    return `Found ${diffMinutes}m ago`;
  }

  if (diffHours < 24) {
    return `Found ${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `Found ${diffDays}d ago`;
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
    categoryTone: resolveCategoryTone(category),
    createdAtMs: safeCreatedAtMs,
    campusZone: inferCampusZone(location),
    recoveryScore: computeRecoveryScore(category, location, safeCreatedAtMs),
  };
}

function categoryPillStyle(tone: FoundItem['categoryTone']) {
  if (tone === 'primary') {
    return {
      backgroundColor: '#FFDBD0',
      color: '#7B2E12',
    };
  }

  if (tone === 'secondary') {
    return {
      backgroundColor: '#D2D4FF',
      color: '#575B7F',
    };
  }

  return {
    backgroundColor: colors.surfaceHighest,
    color: colors.onSurfaceVariant,
  };
}

function nextSweepWindow(zone: CampusZone): string {
  const hour = new Date().getHours();

  if (zone === 'Academic') {
    if (hour < 10) {
      return '10:50 class-switch sweep';
    }

    if (hour < 13) {
      return '13:10 lunch transition sweep';
    }

    if (hour < 17) {
      return '16:40 class-closing sweep';
    }

    if (hour < 20) {
      return '19:00 evening lab sweep';
    }

    return 'Tomorrow 10:50 class-switch sweep';
  }

  if (zone === 'Residence') {
    if (hour < 9) {
      return '08:30 morning checkout sweep';
    }

    if (hour < 18) {
      return '18:30 return-to-hostel sweep';
    }

    if (hour < 22) {
      return '21:15 quiet-hours sweep';
    }

    return 'Tomorrow 08:30 morning checkout sweep';
  }

  if (zone === 'Transit') {
    if (hour < 11) {
      return '09:00 commute peak sweep';
    }

    if (hour < 16) {
      return '15:45 afternoon departure sweep';
    }

    if (hour < 20) {
      return '18:20 evening commute sweep';
    }

    return 'Tomorrow 09:00 commute peak sweep';
  }

  if (zone === 'Commons') {
    if (hour < 11) {
      return '11:50 meal-rush sweep';
    }

    if (hour < 17) {
      return '16:10 activity changeover sweep';
    }

    if (hour < 21) {
      return '20:00 event closeout sweep';
    }

    return 'Tomorrow 11:50 meal-rush sweep';
  }

  if (hour < 12) {
    return '12:00 midday sweep';
  }

  if (hour < 18) {
    return '17:30 evening sweep';
  }

  return 'Tomorrow 12:00 midday sweep';
}

function trendDetails(trend: number): {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
} {
  if (trend > 0) {
    return {
      label: `+${trend} vs yesterday`,
      icon: 'trending-up',
      color: '#1A6A3D',
    };
  }

  if (trend < 0) {
    return {
      label: `${trend} vs yesterday`,
      icon: 'trending-down',
      color: '#9C2E1C',
    };
  }

  return {
    label: 'Flat vs yesterday',
    icon: 'remove',
    color: colors.onSurfaceVariant,
  };
}

function FoundItemCard({ item }: { item: FoundItem }) {
  const pill = categoryPillStyle(item.categoryTone);
  const recoveryStyle = recoveryBadgeStyle(item.recoveryScore);
  const recoveryLabel = recoveryTier(item.recoveryScore);

  return (
    <View style={styles.card}>
      {item.imageUri ? (
        <Image source={{ uri: item.imageUri }} style={styles.cardImage} />
      ) : (
        <View style={styles.cardImageFallback}>
          <MaterialIcons color={colors.outline} name="photo" size={28} />
        </View>
      )}

      <View style={styles.cardContent}>
        <View>
          <View style={styles.cardHeader}>
            <Text numberOfLines={1} style={styles.cardTitle}>
              {item.title}
            </Text>
            <View style={[styles.categoryPill, { backgroundColor: pill.backgroundColor }]}> 
              <Text style={[styles.categoryText, { color: pill.color }]}>{item.category}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <MaterialIcons color={colors.onSurfaceVariant} name="location-on" size={14} />
            <Text numberOfLines={1} style={styles.locationText}>
              {item.location}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooterBlock}>
          <View style={styles.cardSignalsRow}>
            <View style={[styles.scoreChip, { backgroundColor: recoveryStyle.backgroundColor }]}>
              <MaterialIcons color={recoveryStyle.color} name="flash-on" size={14} />
              <Text style={[styles.scoreText, { color: recoveryStyle.color }]}>
                {item.recoveryScore}% {recoveryLabel}
              </Text>
            </View>

            <View style={styles.zoneChip}>
              <MaterialIcons color={colors.onSurfaceVariant} name={campusZoneIcon(item.campusZone)} size={14} />
              <Text style={styles.zoneText}>{item.campusZone}</Text>
            </View>
          </View>

          <Text style={styles.foundAgoText}>{item.foundAgo}</Text>
        </View>
      </View>
    </View>
  );
}

export function HomeScreen() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [allItems, setAllItems] = useState<FoundItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All Items');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [recentOnly, setRecentOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const categories = useMemo(() => {
    const uniqueCategories = Array.from(new Set(allItems.map((item) => item.category))).sort();
    return ['All Items', ...uniqueCategories];
  }, [allItems]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const now = Date.now();

    const filtered = allItems.filter((item) => {
      const categoryPass =
        selectedCategory === 'All Items' || item.category === selectedCategory;

      const searchPass =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.location.toLowerCase().includes(normalizedSearch) ||
        item.category.toLowerCase().includes(normalizedSearch) ||
        item.campusZone.toLowerCase().includes(normalizedSearch);

      const recencyPass =
        !recentOnly || (item.createdAtMs > 0 && now - item.createdAtMs <= DAY_MS);

      return categoryPass && searchPass && recencyPass;
    });

    filtered.sort((left, right) => {
      if (sortMode === 'recovery') {
        if (right.recoveryScore !== left.recoveryScore) {
          return right.recoveryScore - left.recoveryScore;
        }

        return right.createdAtMs - left.createdAtMs;
      }

      if (right.createdAtMs !== left.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }

      return right.recoveryScore - left.recoveryScore;
    });

    return filtered;
  }, [allItems, recentOnly, searchText, selectedCategory, sortMode]);

  const hotspotInsights = useMemo<HotspotInsight[]>(() => {
    const now = Date.now();
    const byLocation = new Map<string, HotspotInsight>();

    allItems.forEach((item) => {
      const key = normalizeLocationLabel(item.location);
      const previous = byLocation.get(key);

      if (previous) {
        previous.count += 1;

        if (previous.campusZone === 'General' && item.campusZone !== 'General') {
          previous.campusZone = item.campusZone;
        }

        if (item.createdAtMs > 0) {
          const ageMs = now - item.createdAtMs;

          if (ageMs <= DAY_MS) {
            previous.recentCount += 1;
          } else if (ageMs <= DAY_MS * 2) {
            previous.previousCount += 1;
          }
        }

        return;
      }

      const entry: HotspotInsight = {
        location: key,
        count: 1,
        recentCount: 0,
        previousCount: 0,
        trend: 0,
        campusZone: item.campusZone,
      };

      if (item.createdAtMs > 0) {
        const ageMs = now - item.createdAtMs;

        if (ageMs <= DAY_MS) {
          entry.recentCount = 1;
        } else if (ageMs <= DAY_MS * 2) {
          entry.previousCount = 1;
        }
      }

      byLocation.set(key, entry);
    });

    return Array.from(byLocation.values())
      .map((entry) => ({
        ...entry,
        trend: entry.recentCount - entry.previousCount,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return right.recentCount - left.recentCount;
      })
      .slice(0, 4);
  }, [allItems]);

  const campusPulse = useMemo(() => {
    if (!allItems.length) {
      return null;
    }

    const zoneCounter: Record<CampusZone, number> = {
      Academic: 0,
      Residence: 0,
      Transit: 0,
      Commons: 0,
      General: 0,
    };

    allItems.forEach((item) => {
      zoneCounter[item.campusZone] += 1;
    });

    let dominantZone: CampusZone = 'General';
    let dominantZoneCount = 0;

    (Object.entries(zoneCounter) as [CampusZone, number][]).forEach(([zone, count]) => {
      if (count > dominantZoneCount) {
        dominantZone = zone;
        dominantZoneCount = count;
      }
    });

    const topRecoveryItem = [...allItems].sort(
      (left, right) => right.recoveryScore - left.recoveryScore,
    )[0];

    const freshInDay = allItems.filter(
      (item) => item.createdAtMs > 0 && Date.now() - item.createdAtMs <= DAY_MS,
    ).length;

    return {
      dominantZone,
      hotspot: hotspotInsights[0] ?? null,
      topRecoveryItem,
      freshInDay,
      nextSweep: nextSweepWindow(dominantZone),
    };
  }, [allItems, hotspotInsights]);

  const loadItems = useCallback(async (options?: { soft?: boolean }) => {
    const soft = options?.soft ?? false;

    setErrorText('');

    if (!soft) {
      setIsLoading(true);
    }

    try {
      const backendBaseUrl = backendEnv.backendUrl.replace(/\/+$/, '');

      if (backendBaseUrl) {
        const response = await fetch(`${backendBaseUrl}/api/found-items`);

        if (!response.ok) {
          throw new Error(`Render backend request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { items?: Record<string, unknown>[] };
        const mappedFromBackend = (payload.items ?? []).map((row) =>
          mapRowToItem(row as Record<string, unknown>),
        );

        setAllItems(mappedFromBackend);
        return;
      }

      const accessToken = await getTokenRef.current({ template: 'supabase' }).catch(() => null);
      const client = buildSupabaseClient(accessToken ?? undefined);

      if (!client) {
        setErrorText('Supabase is not configured yet. Add keys in your .env file.');

        if (!soft) {
          setAllItems([]);
        }

        return;
      }

      const { data, error } = await client
        .from('found_items')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(60);

      if (error) {
        throw error;
      }

      const mapped = (data ?? []).map((row) => mapRowToItem(row as Record<string, unknown>));
      setAllItems(mapped);
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Failed to load items from Supabase.';

      setErrorText(message);

      if (!soft) {
        setAllItems([]);
      }
    } finally {
      if (!soft) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadItems({ soft: true });
    setIsRefreshing(false);
  }, [loadItems]);

  const hasVisibleItems = visibleItems.length > 0;
  const showBlockingError = !isLoading && !hasVisibleItems && !!errorText;
  const showInlineError = !isLoading && hasVisibleItems && !!errorText;

  const resetFilters = useCallback(() => {
    setSelectedCategory('All Items');
    setSearchText('');
    setRecentOnly(false);
    setSortMode('latest');
  }, []);

  const handleStudioActionsFinished = useCallback(async () => {
    await loadItems({ soft: true });
  }, [loadItems]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar leftIcon="menu" title="CampusFind" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.editorialBlock}>
          <Text style={styles.editorialTitle}>Lost & Found</Text>
          <Text style={styles.editorialSubtitle}>
            Campus intelligence + community action, in one recovery feed.
          </Text>
        </View>

        <View style={styles.searchShell}>
          <MaterialIcons color={colors.outline} name="search" size={20} style={styles.searchIcon} />
          <TextInput
            onChangeText={setSearchText}
            placeholder="Search items, locations, categories..."
            placeholderTextColor={colors.outline}
            style={styles.searchInput}
            value={searchText}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.chipsContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsWrap}
        >
          {categories.map((chip) => {
            const active = chip === selectedCategory;
            return (
              <Pressable
                key={chip}
                onPress={() => setSelectedCategory(chip)}
                style={[styles.filterChip, active ? styles.filterChipActive : styles.filterChipMuted]}
              >
                <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : undefined]}>
                  {chip}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.actionChipsContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionChipsWrap}
        >
          <Pressable
            onPress={() => setSortMode('latest')}
            style={[styles.actionChip, sortMode === 'latest' ? styles.actionChipActive : undefined]}
          >
            <MaterialIcons
              color={sortMode === 'latest' ? colors.onPrimary : colors.onSurfaceVariant}
              name="schedule"
              size={15}
            />
            <Text style={[styles.actionChipText, sortMode === 'latest' ? styles.actionChipTextActive : undefined]}>
              Latest
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSortMode('recovery')}
            style={[styles.actionChip, sortMode === 'recovery' ? styles.actionChipActive : undefined]}
          >
            <MaterialIcons
              color={sortMode === 'recovery' ? colors.onPrimary : colors.onSurfaceVariant}
              name="verified"
              size={15}
            />
            <Text
              style={[
                styles.actionChipText,
                sortMode === 'recovery' ? styles.actionChipTextActive : undefined,
              ]}
            >
              Best Match
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setRecentOnly((value) => !value)}
            style={[styles.actionChip, recentOnly ? styles.actionChipActive : undefined]}
          >
            <MaterialIcons
              color={recentOnly ? colors.onPrimary : colors.onSurfaceVariant}
              name="flash-on"
              size={15}
            />
            <Text style={[styles.actionChipText, recentOnly ? styles.actionChipTextActive : undefined]}>
              Recent 24h
            </Text>
          </Pressable>

          <Pressable onPress={resetFilters} style={styles.actionChip}>
            <MaterialIcons color={colors.onSurfaceVariant} name="refresh" size={15} />
            <Text style={styles.actionChipText}>Reset</Text>
          </Pressable>
        </ScrollView>

        <CampusActionStudio onActionsFinished={handleStudioActionsFinished} />

        {!isLoading && campusPulse ? (
          <View style={styles.pulseCard}>
            <View style={styles.pulseHeader}>
              <View>
                <Text style={styles.pulseTitle}>Campus Pulse</Text>
                <Text style={styles.pulseSubtitle}>Predictive recovery intelligence</Text>
              </View>
              <View style={styles.pulseBadge}>
                <MaterialIcons color={colors.primary} name="timeline" size={16} />
                <Text style={styles.pulseBadgeText}>Live</Text>
              </View>
            </View>

            <View style={styles.pulseMetricGrid}>
              <View style={styles.pulseMetricCard}>
                <Text style={styles.pulseMetricLabel}>Dominant Zone</Text>
                <Text style={styles.pulseMetricValue}>{campusPulse.dominantZone}</Text>
                <Text style={styles.pulseMetricHint}>{campusPulse.nextSweep}</Text>
              </View>

              <View style={styles.pulseMetricCard}>
                <Text style={styles.pulseMetricLabel}>Fresh Reports</Text>
                <Text style={styles.pulseMetricValue}>{campusPulse.freshInDay}</Text>
                <Text style={styles.pulseMetricHint}>in the last 24h</Text>
              </View>
            </View>

            <View style={styles.pulseInsightRow}>
              <MaterialIcons color={colors.primary} name="my-location" size={16} />
              <Text numberOfLines={1} style={styles.pulseInsightText}>
                Hotspot: {campusPulse.hotspot ? campusPulse.hotspot.location : 'Campus-wide'}
              </Text>
            </View>

            <View style={styles.pulseInsightRow}>
              <MaterialIcons color={colors.primary} name="flash-on" size={16} />
              <Text numberOfLines={1} style={styles.pulseInsightText}>
                Top reclaim lead: {campusPulse.topRecoveryItem.title} ({campusPulse.topRecoveryItem.recoveryScore}% match)
              </Text>
            </View>
          </View>
        ) : null}

        {!isLoading && hotspotInsights.length ? (
          <View style={styles.hotspotSection}>
            <View style={styles.hotspotSectionHeader}>
              <Text style={styles.hotspotSectionTitle}>Hotspot Radar</Text>
              <Text style={styles.hotspotSectionSubtitle}>Top campus zones right now</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {hotspotInsights.map((spot) => {
                const trend = trendDetails(spot.trend);

                return (
                  <View key={spot.location} style={styles.hotspotCard}>
                    <View style={styles.hotspotCardTop}>
                      <Text numberOfLines={1} style={styles.hotspotLocation}>
                        {spot.location}
                      </Text>
                      <View style={styles.hotspotZoneChip}>
                        <MaterialIcons color={colors.onSurfaceVariant} name={campusZoneIcon(spot.campusZone)} size={13} />
                        <Text style={styles.hotspotZoneText}>{spot.campusZone}</Text>
                      </View>
                    </View>

                    <Text style={styles.hotspotCount}>{spot.count} reports</Text>

                    <View style={styles.hotspotTrendRow}>
                      <MaterialIcons color={trend.color} name={trend.icon} size={14} />
                      <Text style={[styles.hotspotTrendText, { color: trend.color }]}>{trend.label}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.feedHeader}>
          <Text style={styles.feedTitle}>Live Recovery Feed</Text>
          <Text style={styles.feedCount}>{visibleItems.length} showing</Text>
        </View>

        {showInlineError ? (
          <View style={styles.inlineErrorWrap}>
            <MaterialIcons color={colors.error} name="error-outline" size={16} />
            <Text numberOfLines={2} style={styles.inlineErrorText}>
              Sync issue: {errorText}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingText}>Loading campus feed...</Text>
          </View>
        ) : showBlockingError ? (
          <View style={styles.emptyStateCard}>
            <MaterialIcons color={colors.error} name="error-outline" size={24} />
            <Text style={styles.emptyStateTitle}>Could not load items</Text>
            <Text style={styles.emptyStateSubtitle}>{errorText}</Text>
            <Pressable onPress={() => void loadItems()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : visibleItems.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <MaterialIcons color={colors.outline} name="inventory-2" size={24} />
            <Text style={styles.emptyStateTitle}>
              {allItems.length ? 'No items match your filters' : 'No items yet'}
            </Text>
            <Text style={styles.emptyStateSubtitle}>
              {allItems.length
                ? 'Try resetting filters or search to see more campus matches.'
                : 'Add rows to your found_items table in Supabase to populate this feed.'}
            </Text>
            {allItems.length ? (
              <Pressable onPress={resetFilters} style={styles.retryButton}>
                <Text style={styles.retryText}>Reset filters</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          visibleItems.map((item) => <FoundItemCard item={item} key={item.id} />)
        )}
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
    paddingBottom: 34,
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  editorialBlock: {
    marginBottom: 22,
  },
  editorialTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 44,
    letterSpacing: -1.6,
    lineHeight: 48,
    marginBottom: 8,
  },
  editorialSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: colors.surfaceHighest,
    borderRadius: radii.md,
    flexDirection: 'row',
    height: 54,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
  },
  chipsWrap: {
    marginBottom: 12,
  },
  chipsContent: {
    paddingRight: 8,
  },
  filterChip: {
    borderRadius: radii.pill,
    marginRight: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipMuted: {
    backgroundColor: colors.surfaceHigh,
  },
  filterChipText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  filterChipTextActive: {
    color: colors.onPrimary,
  },
  actionChipsWrap: {
    marginBottom: 16,
  },
  actionChipsContent: {
    paddingRight: 8,
  },
  actionChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.18)',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionChipText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  actionChipTextActive: {
    color: colors.onPrimary,
  },
  pulseCard: {
    ...shadows.soft,
    backgroundColor: '#EEF2FF',
    borderColor: '#D4DBFF',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  pulseHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pulseTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  pulseSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 2,
  },
  pulseBadge: {
    alignItems: 'center',
    backgroundColor: '#DDE5FF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pulseBadgeText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  pulseMetricGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  pulseMetricCard: {
    backgroundColor: '#F8FAFF',
    borderRadius: radii.md,
    flex: 1,
    marginRight: 8,
    padding: 10,
  },
  pulseMetricLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pulseMetricValue: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 19,
    marginTop: 4,
  },
  pulseMetricHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 4,
  },
  pulseInsightRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },
  pulseInsightText: {
    color: colors.onSurface,
    flex: 1,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
  hotspotSection: {
    marginBottom: 12,
  },
  hotspotSectionHeader: {
    marginBottom: 10,
  },
  hotspotSectionTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  hotspotSectionSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginTop: 2,
  },
  hotspotCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.15)',
    borderRadius: radii.md,
    borderWidth: 1,
    marginRight: 10,
    padding: 12,
    width: 220,
  },
  hotspotCardTop: {
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  hotspotLocation: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 15,
    marginBottom: 6,
  },
  hotspotZoneChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hotspotZoneText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 4,
  },
  hotspotCount: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineSemiBold,
    fontSize: 19,
    marginBottom: 6,
  },
  hotspotTrendRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  hotspotTrendText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
  },
  feedHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 8,
  },
  feedTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 20,
  },
  feedCount: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1,
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
  card: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.14)',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardImage: {
    height: 150,
    width: 112,
  },
  cardImageFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    height: 150,
    justifyContent: 'center',
    width: 112,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 12,
  },
  cardHeader: {
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  cardTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 19,
    marginBottom: 8,
    paddingRight: 10,
  },
  categoryPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  locationText: {
    color: colors.onSurfaceVariant,
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 3,
  },
  cardFooterBlock: {
    marginTop: 10,
  },
  cardSignalsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scoreChip: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 3,
    textTransform: 'uppercase',
  },
  zoneChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  zoneText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    marginLeft: 3,
    textTransform: 'uppercase',
  },
  foundAgoText: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    marginTop: 8,
    textTransform: 'uppercase',
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
    borderColor: 'rgba(118, 118, 131, 0.16)',
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
  },
  emptyStateTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 18,
    marginTop: 8,
  },
  emptyStateSubtitle: {
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
  retryText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
});