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

function FoundItemCard({ item }: { item: FoundItem }) {
  const categoryPill = categoryPillStyle(item.category);

  return (
    <View style={styles.itemCard}>
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
      </View>
    </View>
  );
}

export function HomeScreen() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  const [allItems, setAllItems] = useState<FoundItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
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

        const response = await fetch(`${backendBaseUrl}/api/found-items`, {
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : undefined,
        });

        if (!response.ok) {
          throw new Error(`Backend request failed (${response.status}).`);
        }

        const payload = (await response.json()) as { items?: Record<string, unknown>[] };
        const mapped = (payload.items ?? []).map((row) => mapRowToItem(row));
        setAllItems(mapped);
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
        .limit(80);

      if (error) {
        throw error;
      }

      setAllItems((data ?? []).map((row) => mapRowToItem(row as Record<string, unknown>)));
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

  const handleStudioActionsFinished = useCallback(async () => {
    await loadItems({ soft: true });
  }, [loadItems]);

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
      <AppTopBar leftIcon="menu" title="CampusFind" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Lost & Found</Text>
          <Text style={styles.heroSubtitle}>
            Find items faster, submit claims safely, and help items return to the right owner.
          </Text>

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

        <View style={styles.searchShell}>
          <MaterialIcons color={colors.outline} name="search" size={20} style={styles.searchIcon} />
          <TextInput
            onChangeText={setSearchText}
            placeholder="Search item, category, or location"
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Found Items</Text>
          <Text style={styles.sectionMeta}>{visibleItems.length} visible</Text>
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
          visibleItems.slice(0, 40).map((item) => <FoundItemCard item={item} key={item.id} />)
        )}

        <View style={styles.toolsWrap}>
          <Text style={styles.toolsTitle}>Quick Actions</Text>
          <Text style={styles.toolsSubtitle}>
            Report lost items, scan proof, manage points, and review claims in one place.
          </Text>
          <CampusActionStudio
            claimableItems={claimableItems}
            compact
            onActionsFinished={handleStudioActionsFinished}
          />
        </View>
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
    paddingBottom: 32,
    paddingHorizontal: 18,
    paddingTop: 16,
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
});