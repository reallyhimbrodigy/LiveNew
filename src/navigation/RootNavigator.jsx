import React, { useCallback, useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Lora_400Regular_Italic, Lora_500Medium, Lora_700Bold } from '@expo-google-fonts/lora';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../theme';
import AppBackground from '../components/AppBackground';
import BootLoader from '../components/BootLoader';
import ErrorBoundary from '../components/ErrorBoundary';
import * as SplashScreen from 'expo-splash-screen';
import { initPurchases } from '../purchases';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../socialAuthConfig';

// Screens
import AuthScreen from '../screens/AuthScreen';
import VerifyEmailScreen from '../screens/VerifyEmailScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import StressTapScreen from '../screens/StressTapScreen';
import TodayScreen from '../screens/TodayScreen';
import ProgressScreen from '../screens/ProgressScreen';
import AccountScreen from '../screens/AccountScreen';
import EssentialsScreen from '../screens/EssentialsScreen';
import IntroScreen from '../screens/IntroScreen';
import PaywallScreen from '../screens/PaywallScreen';
import ChatScreen from '../screens/ChatScreen';
import OvernightScreen from '../screens/OvernightScreen';
import SoundscapesScreen from '../screens/SoundscapesScreen';
import ZonesScreen from '../screens/ZonesScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabBarIcon({ name, color }) {
  if (name === 'Today') {
    return (
      <View style={{ width: 24, height: 24, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          width: 20, height: 20,
          borderWidth: 1.5, borderColor: color, borderRadius: 4,
        }}>
          <View style={{
            position: 'absolute', top: -4, left: 4,
            width: 1.5, height: 6, backgroundColor: color, borderRadius: 1,
          }} />
          <View style={{
            position: 'absolute', top: -4, right: 4,
            width: 1.5, height: 6, backgroundColor: color, borderRadius: 1,
          }} />
          <View style={{
            position: 'absolute', top: 6, left: 3, right: 3,
            height: 1, backgroundColor: color,
          }} />
        </View>
      </View>
    );
  }

  if (name === 'Progress') {
    return (
      <View style={{ width: 24, height: 24, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, paddingBottom: 2 }}>
        <View style={{ width: 4, height: 8, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: 4, height: 14, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: 4, height: 10, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: 4, height: 18, backgroundColor: color, borderRadius: 1 }} />
      </View>
    );
  }

  if (name === 'Account') {
    return (
      <View style={{ width: 24, height: 24, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          width: 10, height: 10,
          borderRadius: 5,
          borderWidth: 1.5, borderColor: color,
          marginBottom: 1,
        }} />
        <View style={{
          width: 16, height: 8,
          borderTopLeftRadius: 8, borderTopRightRadius: 8,
          borderWidth: 1.5, borderColor: color,
          borderBottomWidth: 0,
        }} />
      </View>
    );
  }

  return null;
}

function MainTabs() {
  const { colors, fonts } = useTheme();
  return (
    <Tab.Navigator
      sceneContainerStyle={{ backgroundColor: 'transparent' }}
      screenOptions={({ route }) => ({
        headerShown: false,
        // Mount each tab on first focus (visible + properly sized) rather than
        // pre-mounting hidden. Pre-mounting (lazy:false) inside the v7 animated
        // tab container committed Progress/Account at size 0 while inactive, so
        // the first focus revealed a blank, un-laid-out tree — you had to switch
        // away and back to force a real layout pass. Lazy mount fixes that at
        // the source. (Progress is cache-first, so first open is still instant.)
        lazy: true,
        freezeOnBlur: false,
        // No tab-transition animation: the v7 'fade' container is what revealed
        // the un-laid-out screen on first focus. Instant switching is also the
        // platform-standard behavior for a bottom tab bar.
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.dim,
        tabBarLabelStyle: {
          fontFamily: fonts.displaySemibold,
          fontSize: 11,
          letterSpacing: 0.3,
        },
        tabBarIcon: ({ focused, color, size }) => {
          return <TabBarIcon name={route.name} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Today" component={TodayStack} options={{ tabBarLabel: 'Today' }} />
      <Tab.Screen name="Progress" component={ProgressStack} options={{ tabBarLabel: 'Progress' }} />
      <Tab.Screen name="Account" component={AccountStack} options={{ tabBarLabel: 'Account' }} />
    </Tab.Navigator>
  );
}

function TodayStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="TodayMain" component={TodayScreen} />
      <Stack.Screen name="Overnight" component={OvernightScreen} />
      <Stack.Screen name="StressTap" component={StressTapScreen} />
      <Stack.Screen name="Soundscapes" component={SoundscapesScreen} />
      <Stack.Screen name="Zones" component={ZonesScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

// Account is a stack so the Account tab can push Essentials and present the
// Paywall as a modal — navigate('Essentials') / navigate('Paywall') resolve here.
function AccountStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="AccountMain" component={AccountScreen} />
      <Stack.Screen name="Essentials" component={EssentialsScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

// Progress needs its own stack so the "Unlock"/upgrade cards on Progress can
// reach the Paywall — otherwise navigate('Paywall') from the Progress tab is a
// silent no-op (Paywall only existed in the Today/Account stacks).
function ProgressStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="ProgressMain" component={ProgressScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

function IntroStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="IntroMain" component={IntroScreen} />
      <Stack.Screen name="OnboardingFlow" component={OnboardingScreen} />
    </Stack.Navigator>
  );
}

// Pre-login stack so we can push the email-verification screen on top of Auth
// after signup. Once verifyOtp succeeds and isLoggedIn flips, RootNavigator
// swaps to Intro or Main and this stack unmounts cleanly.
function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="AuthMain" component={AuthScreen} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const hasProfile = useAuthStore((s) => s.hasProfile);
  const hydrate = useAuthStore((s) => s.hydrate);
  const { colors, scheme } = useTheme();

  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Lora_400Regular_Italic,
    Lora_500Medium,
    Lora_700Bold,
  });

  useEffect(() => {
    (async () => {
      // Configure Google Sign-In once at app boot. Idempotent — overwrites
      // config on every call, so re-running on Fast Refresh during dev is
      // fine. The webClientId is the audience Supabase expects in the
      // idToken; iosClientId is the iOS-native OAuth client.
      try {
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        GoogleSignin.configure({
          webClientId: GOOGLE_WEB_CLIENT_ID,
          iosClientId: GOOGLE_IOS_CLIENT_ID,
        });
      } catch {}

      // Initialize Purchases BEFORE hydrate so the subscription check inside
      // hydrate has a working RevenueCat session. Without this, the cold-boot
      // checkSubscription call silently fails and paying users get downgraded
      // until the next app launch.
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const authRaw = await AsyncStorage.getItem('livenew:auth');
        const authData = authRaw ? JSON.parse(authRaw) : {};
        // ALWAYS configure RevenueCat (even logged-out → anonymous), so the
        // paywall works in every session. If we know the user, configure as them.
        await initPurchases(authData?.userId || null);
      } catch {}
      await hydrate();
    })();
  }, []);

  // BootLoader gate: shown until the boot animation completes.
  // It hides the native splash itself, breathes while hydrate runs, then
  // zooms out on handoff. Once bootAnimDone flips, we never re-show it.
  const [bootAnimDone, setBootAnimDone] = useState(false);
  const handleBootFinish = useCallback(() => setBootAnimDone(true), []);

  // FAILSAFE: the app MUST appear even if the boot screen never finishes.
  // Independently of BootLoader, force past the boot gate after a hard cap and
  // force-hide the native splash. This is what guarantees the app can never get
  // stuck on the splash — the cause of the App Store launch rejection.
  useEffect(() => {
    const finish = setTimeout(() => setBootAnimDone(true), 4500);
    const hide = setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 1200);
    return () => { clearTimeout(finish); clearTimeout(hide); };
  }, []);

  if (!bootAnimDone) {
    // BootLoader wrapped so a render crash on a real device can't strand the
    // launch — on error we just proceed into the app (no animation, but it loads).
    return (
      <ErrorBoundary onError={handleBootFinish} fallback={null}>
        <BootLoader
          ready={!isLoading}
          onFinish={handleBootFinish}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary diagnostic>
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBackground />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    <NavigationContainer
      theme={{
        dark: scheme === 'dark',
        colors: {
          primary: colors.gold,
          // Transparent so the global circadian gradient shows through every
          // scene. Screen surfaces are transparent too (see each screen's safe).
          background: 'transparent',
          card: 'transparent',
          text: colors.text,
          border: colors.line,
          notification: colors.gold,
        },
        fonts: {
          regular: { fontFamily: 'Manrope_400Regular', fontWeight: '400' },
          medium: { fontFamily: 'Manrope_500Medium', fontWeight: '500' },
          bold: { fontFamily: 'Manrope_700Bold', fontWeight: '700' },
          heavy: { fontFamily: 'Manrope_700Bold', fontWeight: '800' },
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        {!isLoggedIn ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : !hasProfile ? (
          <Stack.Screen name="Intro" component={IntroStack} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </View>
    </ErrorBoundary>
  );
}
