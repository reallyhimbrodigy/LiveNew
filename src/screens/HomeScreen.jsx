import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAppStore } from "../state/store";
import Card from "../ui/Card";
import Button from "../ui/Button";
import { adherencePercent, sevenDayAvgStress } from "../domain/kpis";
import BrandLogo from "../components/BrandLogo";

export default function HomeScreen({ navigation }) {
  const weekPlan = useAppStore((s) => s.weekPlan);
  const buildWeek = useAppStore((s) => s.buildWeek);
  const ensureCurrentWeek = useAppStore((s) => s.ensureCurrentWeek);
  const checkIns = useAppStore((s) => s.checkIns);
  const completions = useAppStore((s) => s.completions);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const avgStress = useMemo(() => sevenDayAvgStress(checkIns), [checkIns]);
  const adherence = useMemo(() => (weekPlan ? adherencePercent(weekPlan, completions) : 0), [weekPlan, completions]);
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
        <Button title="Build this week" onPress={() => buildWeek(todayISO)} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.logoRow}>
        <BrandLogo variant="mark" size={28} />
      </View>
      <Text style={styles.h1}>Week plan</Text>
      <Text style={styles.p}>Designed around lowering stress load, not maxing output.</Text>
      <View style={styles.kpiRow}>
        <Text style={styles.kpiText}>7-day avg stress: {avgStress === null ? "—" : avgStress.toFixed(1)}</Text>
        <Text style={styles.kpiText}>Adherence: {adherence}%</Text>
      </View>

      {weekPlan.days.map((d) => (
        <View key={d.dateISO} style={{ gap: 8 }}>
          <Text style={styles.dayTitle}>{d.dateISO} · {d.focus}</Text>
          <Card>
            <Text style={styles.small}>{d.blocks.length} blocks</Text>
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
  kpiRow: { gap: 6 },
  kpiText: { fontSize: 14, color: "#374151", fontWeight: "600" },
  dayTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  small: { color: "#374151" },
});
