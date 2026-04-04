import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { backendEnv } from '../config/env';
import { buildSupabaseClient } from '../lib/supabase';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

type FoundItem = {
  id: string;
  title: string;
  location: string;
  foundAgo: string;
  category: string;
  imageUri: string | null;
  categoryTone: 'primary' | 'secondary' | 'neutral';
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

  if (lowered.includes('key') || lowered.includes('wallet')) {
    return 'secondary';
  }

  return 'neutral';
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
  const createdAt =
    readText(row.created_at) ?? readText(row.found_at) ?? readText(row.inserted_at) ?? null;

  return {
    id:
      readIdentifier(row.id) ??
      `${title}-${location}-${createdAt ?? Math.random().toString(36).slice(2)}`,
    title,
    location,
    foundAgo: formatFoundAgo(createdAt),
    category,
    imageUri,
    categoryTone: resolveCategoryTone(category),
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

function FoundItemCard({ item }: { item: FoundItem }) {
  const pill = categoryPillStyle(item.categoryTone);

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
            <Text style={styles.locationText}>{item.location}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.foundAgoText}>{item.foundAgo}</Text>
          <View style={styles.karmaChip}>
            <MaterialIcons color={colors.onTertiaryContainer} name="volunteer-activism" size={14} />
            <Text style={styles.karmaText}>Karma +50</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function HomeScreen() {
  const { getToken } = useAuth();
  const [allItems, setAllItems] = useState<FoundItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All Items');
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const categories = useMemo(() => {
    const uniqueCategories = Array.from(new Set(allItems.map((item) => item.category))).sort();
    return ['All Items', ...uniqueCategories];
  }, [allItems]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return allItems.filter((item) => {
      const categoryPass =
        selectedCategory === 'All Items' || item.category === selectedCategory;
      const searchPass =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.location.toLowerCase().includes(normalizedSearch) ||
        item.category.toLowerCase().includes(normalizedSearch);

      return categoryPass && searchPass;
    });
  }, [allItems, searchText, selectedCategory]);

  const loadItems = useCallback(async () => {
    setErrorText('');
    setIsLoading(true);

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

      const accessToken = await getToken({ template: 'supabase' }).catch(() => null);
      const client = buildSupabaseClient(accessToken ?? undefined);

      if (!client) {
        setErrorText('Supabase is not configured yet. Add keys in your .env file.');
        setAllItems([]);
        return;
      }

      const { data, error } = await client
        .from('found_items')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40);

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
      setAllItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar leftIcon="menu" title="CampusFind" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.editorialBlock}>
          <Text style={styles.editorialTitle}>Lost & Found</Text>
          <Text style={styles.editorialSubtitle}>Restoring value to the campus community.</Text>
        </View>

        <View style={styles.searchShell}>
          <MaterialIcons color={colors.outline} name="search" size={20} style={styles.searchIcon} />
          <TextInput
            onChangeText={setSearchText}
            placeholder="Search for items..."
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

        <View style={styles.feedHeader}>
          <Text style={styles.feedTitle}>Recently Found Items</Text>
          <Text style={styles.feedCount}>{visibleItems.length} Live</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingText}>Loading items from Supabase...</Text>
          </View>
        ) : errorText ? (
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
            <Text style={styles.emptyStateTitle}>No items yet</Text>
            <Text style={styles.emptyStateSubtitle}>
              Add rows to your found_items table in Supabase to populate this feed.
            </Text>
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
    marginBottom: 18,
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
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  filterChipTextActive: {
    color: colors.onPrimary,
  },
  feedHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
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
    letterSpacing: 1.1,
    textTransform: 'uppercase',
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
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 3,
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  foundAgoText: {
    color: colors.outline,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  karmaChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(225, 124, 90, 0.12)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  karmaText: {
    color: colors.onTertiaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    marginLeft: 4,
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
