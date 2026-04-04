import { RouteProp, useRoute } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { CampusActionStudio } from '../components/CampusActionStudio';
import { colors, fontFamily, radii } from '../theme/tokens';

type HistoryRouteParams = {
  focusRequestId?: string;
  focusFoundItemId?: string;
  focusNonce?: number;
  autoOpenMessages?: boolean;
};

type HistoryRoute = RouteProp<{ History: HistoryRouteParams | undefined }, 'History'>;

export function HistoryScreen() {
  const route = useRoute<HistoryRoute>();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar leftIcon="menu" title="CampusFind" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Claim History Center</Text>
          <Text style={styles.headerSubtitle}>
            Review approvals, message the other user, and confirm pickup from one place.
          </Text>
        </View>

        <CampusActionStudio
          autoOpenFocusedClaimMessages={Boolean(route.params?.autoOpenMessages)}
          focusClaimNonce={route.params?.focusNonce ?? 0}
          focusClaimRequestId={route.params?.focusRequestId}
          layout="history"
        />
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
  headerCard: {
    backgroundColor: '#EFF4FF',
    borderColor: '#D7E2FF',
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
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
    marginTop: 4,
  },
});
