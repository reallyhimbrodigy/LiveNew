import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAppStore } from "../state/store";
import Card from "../ui/Card";
import Button from "../ui/Button";

export default function DayScreen({ route, navigation }) {
  const { dateISO } = route.params;
  const weekPlan = useAppStore((s) => s.weekPlan);
  const completions = useAppStore((s) => s.completions);
  const toggleCompletion = useAppStore((s) => s.toggleCompletion);
  const addStressor = useAppStore((s) => s.addStressor);
  const checkIns = useAppStore((s) => s.checkIns);
  const stressors = useAppStore((s) => s.stressors);
  const day = weekPlan?.days.find((d) => d.dateISO === dateISO);
  const hasHighStressToday = checkIns.some((c) => c.dateISO === dateISO && c.stress >= 8);
  const hasStressorToday = stressors.some((s) => s.dateISO === dateISO);
  const [emergencyShown, setEmergencyShown] = useState(hasHighStressToday || hasStressorToday);

  useEffect(() => {
    if (!emergencyShown && (hasHighStressToday || hasStressorToday)) {
      setEmergencyShown(true);
    }
  }, [emergencyShown, hasHighStressToday, hasStressorToday]);

  if (!day) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>Day not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.h1}>{dateISO}</Text>
      <Text style={styles.p}>Focus: {day.focus}</Text>

      <View style={styles.emergencyWrap}>
        <Text style={styles.sectionTitle}>Emergency downshift</Text>
        <Button title="Run 6-minute reset" onPress={() => setEmergencyShown(true)} />
        {emergencyShown ? (
          <Card>
            <Text style={styles.line}>90 seconds: inhale 4s, exhale 6s</Text>
            <Text style={styles.line}>5 minutes: easy walk or slow mobility</Text>
            <Text style={styles.line}>30 seconds: write one next action</Text>
          </Card>
        ) : null}
      </View>

      <View style={styles.stressorWrap}>
        <Text style={styles.sectionTitle}>Quick stressor</Text>
        <View style={styles.stressorRow}>
          {STRESSOR_KINDS.map((kind) => (
            <Button
              key={kind}
              title={labelForStressor(kind)}
              variant="ghost"
              onPress={() => {
                addStressor(kind, dateISO);
                setEmergencyShown(true);
              }}
            />
          ))}
        </View>
      </View>

      <Button title="Do check-in" onPress={() => navigation.navigate("CheckIn", { dateISO })} />

      {day.blocks.map((b) => (
        <Card key={b.id}>
          <Text style={styles.blockTitle}>
            {completions[b.id] ? "✓ " : ""}{b.window} · {b.title}
          </Text>
          <Text style={styles.meta}>{b.minutes} min · {b.tags.join(", ")}</Text>
          <View style={{ height: 10 }} />
          {b.instructions.map((line, idx) => (
            <Text key={idx} style={styles.line}>• {line}</Text>
          ))}
          <View style={{ height: 12 }} />
          <Button
            title={completions[b.id] ? "Done" : "Mark done"}
            variant={completions[b.id] ? "ghost" : "primary"}
            onPress={() => toggleCompletion(b.id)}
          />
        </Card>
      ))}
    </ScrollView>
  );
}

const STRESSOR_KINDS = ["bad_sleep", "argument", "deadline", "travel", "sick", "late_caffeine"];

function labelForStressor(kind) {
  switch (kind) {
    case "bad_sleep":
      return "Bad sleep";
    case "argument":
      return "Argument";
    case "deadline":
      return "Deadline";
    case "travel":
      return "Travel";
    case "sick":
      return "Sick";
    case "late_caffeine":
      return "Late caffeine";
    default:
      return kind;
  }
}

const styles = StyleSheet.create({
  wrap: { padding: 18, gap: 14 },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
  p: { fontSize: 15, color: "#374151" },
  sectionTitle: { fontSize: 14, color: "#111827", fontWeight: "700" },
  emergencyWrap: { gap: 8 },
  stressorWrap: { gap: 8 },
  stressorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  blockTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  meta: { fontSize: 13, color: "#6B7280" },
  line: { fontSize: 15, color: "#374151", lineHeight: 22 },
});
