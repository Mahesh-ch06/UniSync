import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { CampusActionStudio } from '../components/CampusActionStudio';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

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

export function HistoryScreen() {
  const route = useRoute<HistoryRoute>();
  const navigation = useNavigation<BottomTabNavigationProp<HistoryTabParamList, 'History'>>();
  const hasFocusedClaim = Boolean(route.params?.focusRequestId);
  const [historyQuickView, setHistoryQuickView] = useState<HistoryQuickView>('all');

  const historyQuickNavItems = useMemo(
    () => [
      { key: 'all', label: 'All Claims', icon: 'view-list' },
      { key: 'needs-action', label: 'Needs Action', icon: 'bolt' },
      { key: 'active', label: 'Active', icon: 'autorenew' },
      { key: 'completed', label: 'Completed', icon: 'task-alt' },
    ] as const,
    [],
  );

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
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.headerTitle}>Claim History Center</Text>
            <View style={styles.heroBadge}>
              <MaterialIcons color={colors.onPrimary} name="history" size={14} />
              <Text style={styles.heroBadgeText}>Live</Text>
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

        {hasFocusedClaim ? (
          <View style={styles.focusBanner}>
            <MaterialIcons color={colors.primary} name="stars" size={16} />
            <Text style={styles.focusBannerText}>Opened from notification: your selected claim is highlighted below.</Text>
          </View>
        ) : null}

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

        <View style={styles.quickNavCard}>
          <Text style={styles.quickNavTitle}>History Quick Navigation</Text>
          <ScrollView
            contentContainerStyle={styles.quickNavRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
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
          </ScrollView>
        </View>

        <ErrorBoundary fallbackMessage="Claim history encountered an error">
          <CampusActionStudio
            autoOpenFocusedClaimMessages={Boolean(route.params?.autoOpenMessages)}
            focusClaimNonce={route.params?.focusNonce ?? 0}
            focusClaimRequestId={route.params?.focusRequestId}
            historyQuickView={historyQuickView}
            layout="history"
          />
        </ErrorBoundary>
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
    paddingBottom: 26,
    paddingHorizontal: 18,
    paddingTop: 16,
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
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
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
    alignItems: 'center',
    flexDirection: 'row',
    paddingRight: 6,
  },
  quickNavButton: {
    alignItems: 'center',
    backgroundColor: '#EDF3FF',
    borderColor: '#D9E5FA',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
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
    fontFamily: fontFamily.headlineBold,
    fontSize: 24,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
});
