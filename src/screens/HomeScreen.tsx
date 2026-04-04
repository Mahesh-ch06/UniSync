import { MaterialIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

type FoundItem = {
  id: string;
  title: string;
  location: string;
  foundAgo: string;
  category: string;
  imageUri: string;
  categoryTone: 'primary' | 'secondary' | 'neutral';
};

const categories = ['All Items', 'Electronics', 'Clothing', 'Keys', 'Wallets'];

const foundItems: FoundItem[] = [
  {
    id: '1',
    title: 'Sony WH-1000XM4',
    location: 'Main Library, Level 3',
    foundAgo: 'Found 2h ago',
    category: 'Electronics',
    imageUri:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCYH1dwbddvlvCeWLYLCw5ibWLhVVIwTE59sDdMhkYnmHUiJegCYo6twtr3sM0rKNbhCEuU2fxFK98HmByraE_6BnTvbjVFIGFvC55HWarbT2B3ZSJ9ZRuNwsUOxj7oX6tvHUGgP9XQtoMsEtr0-c8K7O94baDc_IeD4s9wniekOZWbURrzN-DbN-zHD4az86az4JUbkP1uWEy6xFVLa5P77xIdP-THwROEvPyOffrujqsljfN8mq9zCoM5J1Uoc1rE1_DELz91hnur',
    categoryTone: 'primary',
  },
  {
    id: '2',
    title: 'Keys & Blue Lanyard',
    location: 'Student Union Plaza',
    foundAgo: 'Found 4h ago',
    category: 'Keys',
    imageUri:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAm_OP6CNbVyEbxkf6KEitL3yOPLz_vPSNI7KSR_iyqLK-kJjCxtRCt1Wn1QgW0wpdq-bXlhot9W_ZxQBRvKUsChxLjlVTavYO3CHbQ6xoCIrYwL5IpawS0r6aJK6v2031WhpW9qrgb4eDHtBF9WqPCxwqtmzFVOGDUb-iZYQMBpFb_Vb_u8cFRo5wQT1eGYzpdsLLGQbzUmFrP3sLCebuS9QtdaRWrKs6pourApmcdpzCGmwtkFGXMPUhpnxOrvqxt8JuVSNjhtr0q',
    categoryTone: 'secondary',
  },
  {
    id: '3',
    title: 'Denim Jacket (M)',
    location: 'Engineering Hall B1',
    foundAgo: 'Found 6h ago',
    category: 'Clothing',
    imageUri:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDolcE243MQcUlZd1_N6DYAPZ75VppLbWkTUvdsqaV5XrGT_KkGgdoVlKalTxLE6Qd_qoICgMuvXxQYGzfrpb4u0FLFW_9eXypWZYnT4A92TX2ixPmuE8U6T2EBVrA1WrBV86MyurOmpC_vEa73z1gCfKcuSvNSC3Uzxh686WFRYFq1mhQFL8Sj832vGH_q6n-q5HD9X2hhRNmnWXSuJqqPdtREOf1ucnK1MgZuFnXHnH2PKtQom9Ypkhj_55IXqeHUZYFEGU5POYwu',
    categoryTone: 'neutral',
  },
];

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
      <Image source={{ uri: item.imageUri }} style={styles.cardImage} />
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
          <TextInput placeholder="Search for items..." placeholderTextColor={colors.outline} style={styles.searchInput} />
        </View>

        <ScrollView
          contentContainerStyle={styles.chipsContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsWrap}
        >
          {categories.map((chip, index) => {
            const active = index === 0;
            return (
              <Pressable
                key={chip}
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
          <Text style={styles.feedCount}>24 New Today</Text>
        </View>

        {foundItems.map((item) => (
          <FoundItemCard item={item} key={item.id} />
        ))}
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
});
