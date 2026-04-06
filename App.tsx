import {
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  SignedIn,
  SignedOut,
  useUser,
} from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { backendEnv, isBackendConfigured, missingEnvKeys } from './src/config/env';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OfflineExperienceModal } from './src/components/OfflineExperienceModal';
import { NotificationBadgeProvider, useNotificationBadge } from './src/lib/notificationBadge';
import { AuthScreen } from './src/screens/AuthScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { MapScreen } from './src/screens/MapScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { CompleteNameScreen } from './src/screens/CompleteNameScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { colors, fontFamily } from './src/theme/tokens';

type RootTabsParamList = {
  Home: undefined;
  Map: undefined;
  Report: undefined;
  History: {
    focusRequestId?: string;
    focusFoundItemId?: string;
    focusNonce?: number;
    autoOpenMessages?: boolean;
  } | undefined;
  Profile: undefined;
  Notifications: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabsParamList>();

const tabIcons: Record<keyof RootTabsParamList, keyof typeof MaterialIcons.glyphMap> = {
  Home: 'home',
  Map: 'map',
  Report: 'add-circle',
  History: 'history',
  Profile: 'person',
  Notifications: 'notifications-none',
  Settings: 'settings',
};

const tabLabels: Record<keyof RootTabsParamList, string> = {
  Home: 'Home',
  Map: 'Map',
  Report: 'Report',
  History: 'History',
  Profile: 'Profile',
  Notifications: 'Notifications',
  Settings: 'Settings',
};

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
  },
};

function TabIconWithBadge({
  badgeCount,
  color,
  focused,
  iconName,
}: {
  badgeCount: number;
  color: string;
  focused: boolean;
  iconName: keyof typeof MaterialIcons.glyphMap;
}) {
  const safeBadgeCount = Math.max(0, Math.floor(badgeCount));

  return (
    <View style={styles.tabIconWrap}>
      <MaterialIcons color={color} name={iconName} size={focused ? 23 : 21} />
      {safeBadgeCount > 0 ? (
        <View style={styles.tabIconBadge}>
          <Text style={styles.tabIconBadgeText}>
            {safeBadgeCount > 99 ? '99+' : String(safeBadgeCount)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AppTabsNavigator() {
  const { unreadCount } = useNotificationBadge();

  return (
    <Tab.Navigator
      screenOptions={(
        { route }: { route: { name: keyof RootTabsParamList } },
      ): BottomTabNavigationOptions => ({
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: styles.tabLabel,
        tabBarActiveTintColor: colors.primaryContainer,
        tabBarInactiveTintColor: '#8C8F9B',
        tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => {
          const iconName = tabIcons[route.name as keyof RootTabsParamList];
          const badgeCount = route.name === 'Home' ? unreadCount : 0;

          return (
            <TabIconWithBadge
              badgeCount={badgeCount}
              color={color}
              focused={focused}
              iconName={iconName}
            />
          );
        },
      })}
    >
      <Tab.Screen
        component={HomeScreen}
        name="Home"
        options={{
          tabBarLabel: tabLabels.Home,
        }}
      />
      <Tab.Screen
        component={MapScreen}
        name="Map"
        options={{
          tabBarLabel: tabLabels.Map,
        }}
      />
      <Tab.Screen
        component={ReportScreen}
        name="Report"
        options={{
          tabBarLabel: tabLabels.Report,
        }}
      />
      <Tab.Screen
        component={HistoryScreen}
        name="History"
        options={{
          tabBarLabel: tabLabels.History,
        }}
      />
      <Tab.Screen
        component={ProfileScreen}
        name="Profile"
        options={{
          tabBarLabel: tabLabels.Profile,
        }}
      />
      <Tab.Screen
        component={NotificationsScreen}
        name="Notifications"
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tab.Screen
        component={SettingsScreen}
        name="Settings"
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tab.Navigator>
  );
}

function AppTabs() {
  return (
    <NotificationBadgeProvider>
      <AppTabsNavigator />
    </NotificationBadgeProvider>
  );
}

function SignedInGate() {
  const { isLoaded, user } = useUser();

  if (!isLoaded) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loaderText}>Loading profile...</Text>
      </View>
    );
  }

  const hasName = Boolean(user?.firstName?.trim() || user?.lastName?.trim());

  if (!hasName) {
    return <CompleteNameScreen />;
  }

  return (
    <ErrorBoundary fallbackMessage="A screen encountered an error">
      <AppTabs />
    </ErrorBoundary>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loaderText}>Building UniSync UI...</Text>
      </View>
    );
  }

  if (!isBackendConfigured) {
    return (
      <SafeAreaProvider>
        <SetupScreen missingKeys={missingEnvKeys} />
      </SafeAreaProvider>
    );
  }

  return (
    <ErrorBoundary fallbackMessage="UniSync encountered an unexpected error">
      <ClerkProvider
        clerkJSVersion="5"
        publishableKey={backendEnv.clerkPublishableKey}
        tokenCache={tokenCache}
      >
        <SafeAreaProvider>
          <NavigationContainer theme={navigationTheme}>
            <StatusBar style="dark" />

            <ClerkLoading>
              <View style={styles.loaderWrap}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.loaderText}>Preparing secure session...</Text>
              </View>
            </ClerkLoading>

            <ClerkLoaded>
              <SignedIn>
                <SignedInGate />
              </SignedIn>
              <SignedOut>
                <AuthScreen />
              </SignedOut>
            </ClerkLoaded>
          </NavigationContainer>
          <OfflineExperienceModal />
        </SafeAreaProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loaderWrap: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
  loaderText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    marginTop: 12,
  },
  tabBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopColor: 'rgba(118, 118, 131, 0.18)',
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
    height: 82,
    paddingBottom: 8,
    paddingHorizontal: 2,
    paddingTop: 6,
  },
  tabItem: {
    borderRadius: 12,
    marginHorizontal: 0,
    marginTop: 0,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  tabLabel: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 10,
    letterSpacing: 0.4,
    marginTop: 1,
    textTransform: 'uppercase',
  },
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 26,
    position: 'relative',
  },
  tabIconBadge: {
    alignItems: 'center',
    backgroundColor: '#D22F27',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 1.4,
    justifyContent: 'center',
    minWidth: 15,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -9,
    top: -5,
  },
  tabIconBadgeText: {
    color: '#FFFFFF',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 8,
    lineHeight: 11,
  },
});
