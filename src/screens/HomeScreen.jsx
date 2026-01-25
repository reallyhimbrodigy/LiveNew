import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAppStore } from "../state/store";
import Card from "../ui/Card";
import Button from "../ui/Button";
import BrandLogo from "../components/BrandLogo";
import { isoToday, computeProgress } from "../domain";

export default function HomeScreen({ navigation }) {
  const weekPlan = useAppStore((s) => s.weekPlan);
  const ensureCurrentWeek = useAppStore((s) => s.ensureCurrentWeek);
  const checkIns = useAppStore((s) => s.checkIns);
  const lastStressStateByDate = useAppStore((s) => s.lastStressStateByDate);
  const userProfile = useAppStore((s) => s.userProfile);
  const completions = useAppStore((s) => s.completions);

  const todayISO = useMemo(() => isoToday(), []);
  const progress = useMemo(() => computeProgress({ checkIns, weekPlan, completions }), [checkIns, weekPlan, completions]);
  const todayProfile = lastStressStateByDate?.[todayISO]?.profile;
  const [didAutoOpen, setDidAutoOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const run = async () => {
      await ensureCurrentWeek();
      if (!active) return;
      if (!didAutoOpen && weekPlan) {
        setDidAutoOpen(true);
        navigation.navigate("Day", { dateISO: todayISO });
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [ensureCurrentWeek, weekPlan, didAutoOpen, navigation, todayISO]);

  if (!weekPlan) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>No plan yet.</Text>
        {userProfile ? (
          <Button title="Build this week" onPress={() => ensureCurrentWeek()} />
        ) : (
          <Button title="Start baseline" onPress={() => navigation.navigate("Baseline")} />
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.logoRow}>
        <BrandLogo variant="mark" size={28} />
      </View>
      <Text style={styles.h1}>This Week</Text>
      <Text style={styles.p}>Designed around lowering stress load, not maxing output.</Text>
      <View style={styles.kpiRow}>
        <Text style={styles.kpiText}>7-day avg stress: {progress.stressAvg7 == null ? "n/a" : progress.stressAvg7.toFixed(1)}</Text>
        <Text style={styles.kpiText}>Today profile: {todayProfile || "n/a"}</Text>
      </View>

      <Card>
        <Text style={styles.sectionTitle}>Progress</Text>
        <Text style={styles.small}>Avg sleep (7d): {progress.sleepAvg7 == null ? "n/a" : progress.sleepAvg7.toFixed(1)}</Text>
        <Text style={styles.small}>Adherence: {progress.adherencePct == null ? "n/a" : `${progress.adherencePct}%`}</Text>
        <Text style={styles.small}>Downshift minutes (7d): {progress.downshiftMinutes7 == null ? "n/a" : progress.downshiftMinutes7}</Text>
      </Card>

      {weekPlan.days.map((d) => (
        <View key={d.dateISO} style={{ gap: 8 }}>
          <Text style={styles.dayTitle}>
            {d.dateISO} - {d.profile} - {d.focus}
          </Text>
          <Card>
            <Text style={styles.small}>Workout: {d.workout.title} - {d.workout.minutes} min</Text>
            <Text style={styles.small}>Window: {d.workoutWindow || "PM"}</Text>
            <Text style={styles.small}>Reset: {d.reset.title} - {d.reset.minutes} min</Text>
            <Text style={styles.small}>Nutrition: {d.nutrition.title}</Text>
            <View style={{ height: 10 }} />
            <Button title="Open day" onPress={() => navigation.navigate("Day", { dateISO: d.dateISO })} />
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 18, gap: 14 },
  logoRow: { alignItems: "flex-start" },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
  p: { fontSize: 15, color: "#374151" },
  sectionTitle: { fontSize: 14, color: "#111827", fontWeight: "700" },
  kpiRow: { gap: 6 },
  kpiText: { fontSize: 14, color: "#374151", fontWeight: "600" },
  dayTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  small: { color: "#374151" },
});
