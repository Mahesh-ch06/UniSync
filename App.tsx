import {
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  SignedIn,
  SignedOut,
  useUser,
} from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { MaterialIcons } from '@expo/vector-icons';
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
import { AuthScreen } from './src/screens/AuthScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { MapScreen } from './src/screens/MapScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ReportScreen } from './src/screens/ReportScreen';
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
};

const Tab = createBottomTabNavigator<RootTabsParamList>();

const tabIcons: Record<keyof RootTabsParamList, keyof typeof MaterialIcons.glyphMap> = {
  Home: 'home',
  Map: 'map',
  Report: 'add-circle',
  History: 'history',
  Profile: 'person',
};

const tabLabels: Record<keyof RootTabsParamList, string> = {
  Home: 'Home',
  Map: 'Map',
  Report: 'Report',
  History: 'History',
  Profile: 'Profile',
};

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
  },
};

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: styles.tabLabel,
        tabBarActiveTintColor: colors.primaryContainer,
        tabBarInactiveTintColor: '#8C8F9B',
        tabBarIcon: ({ color, focused }) => {
          const iconName = tabIcons[route.name as keyof RootTabsParamList];

          return <MaterialIcons color={color} name={iconName} size={focused ? 23 : 21} />;
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
    </Tab.Navigator>
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

  return <AppTabs />;
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
    return <SetupScreen missingKeys={missingEnvKeys} />;
  }

  return (
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
      </SafeAreaProvider>
    </ClerkProvider>
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
});
