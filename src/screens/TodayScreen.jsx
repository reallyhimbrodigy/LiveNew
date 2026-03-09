import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function TodayScreen({ navigation }) {
  const todayPlan = useAuthStore(s => s.todayPlan);
  const todayDate = useAuthStore(s => s.todayDate);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (!todayPlan || todayDate !== today) {
      navigation.replace('StressTap');
    }
  }, [todayPlan, todayDate]);

  if (!todayPlan) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  // Placeholder — we'll build the full Today screen in the next prompt
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.text}>Plan loaded — Today screen coming next</Text>
        <Text style={s.sub}>Sessions: {todayPlan?.sessions?.length || 0}</Text>
        <Text style={s.sub}>Meals: {todayPlan?.meals?.length || 0}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  text: { color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  sub: { color: colors.muted, fontSize: 14 },
});
