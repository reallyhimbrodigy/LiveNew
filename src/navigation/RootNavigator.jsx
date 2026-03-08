import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';

// Screens (we'll create these in the next prompts)
import AuthScreen from '../screens/AuthScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import StressTapScreen from '../screens/StressTapScreen';
import TodayScreen from '../screens/TodayScreen';
import SessionScreen from '../screens/SessionScreen';
import ProgressScreen from '../screens/ProgressScreen';
import AccountScreen from '../screens/AccountScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }) {
  const color = focused ? colors.gold : colors.dim;
  // Simple circle indicator
  return (
    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: focused ? colors.gold : 'transparent', marginBottom: 2 }} />
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#111110',
          borderTopColor: colors.line,
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.dim,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.3,
        },
      }}
    >
      <Tab.Screen name="Today" component={TodayStack} options={{ tabBarLabel: 'Today' }} />
      <Tab.Screen name="Progress" component={ProgressScreen} options={{ tabBarLabel: 'Progress' }} />
      <Tab.Screen name="Account" component={AccountScreen} options={{ tabBarLabel: 'Account' }} />
    </Tab.Navigator>
  );
}

function TodayStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TodayMain" component={TodayScreen} />
      <Stack.Screen name="StressTap" component={StressTapScreen} />
      <Stack.Screen name="Session" component={SessionScreen} options={{ gestureEnabled: false }} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const hasProfile = useAuthStore((s) => s.hasProfile);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          primary: colors.gold,
          background: colors.bg,
          card: colors.bg,
          text: colors.text,
          border: colors.line,
          notification: colors.gold,
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isLoggedIn ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : !hasProfile ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
});
