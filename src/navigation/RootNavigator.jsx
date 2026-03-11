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
import IntroScreen from '../screens/IntroScreen';

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
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
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
        tabBarIcon: ({ focused, color, size }) => {
          return <TabBarIcon name={route.name} color={color} />;
        },
      })}
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

function IntroStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="IntroMain" component={IntroScreen} />
      <Stack.Screen name="OnboardingFlow" component={OnboardingScreen} />
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
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '500' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '800' },
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isLoggedIn ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : !hasProfile ? (
          <Stack.Screen name="Intro" component={IntroStack} />
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
