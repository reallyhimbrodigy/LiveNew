import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAppStore } from "../state/store";
import Card from "../ui/Card";
import Button from "../ui/Button";
import BrandLogo from "../components/BrandLogo";

export default function DayScreen({ route, navigation }) {
  const { dateISO } = route.params;
  const weekPlan = useAppStore((s) => s.weekPlan);
  const applyQuickSignal = useAppStore((s) => s.applyQuickSignal);
  const addStressor = useAppStore((s) => s.addStressor);
  const lastStressStateByDate = useAppStore((s) => s.lastStressStateByDate);
  const history = useAppStore((s) => s.history);
  const undoLastChange = useAppStore((s) => s.undoLastChange);
  const activateBadDayMode = useAppStore((s) => s.activateBadDayMode);
  const submitFeedback = useAppStore((s) => s.submitFeedback);

  const day = weekPlan?.days.find((d) => d.dateISO === dateISO);
  const drivers = lastStressStateByDate?.[dateISO]?.drivers || [];
  const canUndo = history.length && history[0].dateISO === dateISO;
  const [showReasons, setShowReasons] = React.useState(false);

  if (!day) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>Day not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.logoRow}>
        <BrandLogo variant="mark" size={28} />
      </View>
      <Text style={styles.h1}>{dateISO}</Text>
      <Text style={styles.p}>Profile: {day.profile}</Text>
      <Text style={styles.p}>Focus: {day.focus}</Text>
      <Button title="Today is a bad day" variant="ghost" onPress={() => activateBadDayMode(dateISO)} />

      <Card>
        <Text style={styles.blockTitle}>Why this plan</Text>
        <Text style={styles.meta}>Profile: {day.profile}</Text>
        <Text style={styles.meta}>Focus: {day.focus}</Text>
        {drivers.slice(0, 2).map((line, idx) => (
          <Text key={idx} style={styles.line}>- {line}</Text>
        ))}
        <View style={{ height: 8 }} />
        <Text style={styles.line}>{focusStatement(day.focus)}</Text>
        {day.rationale.slice(0, 2).map((line, idx) => (
          <Text key={`r-${idx}`} style={styles.line}>- {line}</Text>
        ))}
      </Card>

      <View style={styles.quickWrap}>
        <Text style={styles.sectionTitle}>Quick signals</Text>
        <View style={styles.quickRow}>
          <Button title="I'm stressed" variant="ghost" onPress={() => applyQuickSignal("im_stressed", dateISO)} />
          <Button title="I'm exhausted" variant="ghost" onPress={() => applyQuickSignal("im_exhausted", dateISO)} />
          <Button title="I have 10 minutes" variant="ghost" onPress={() => applyQuickSignal("i_have_10_min", dateISO)} />
          <Button title="I have more energy" variant="ghost" onPress={() => applyQuickSignal("i_have_more_energy", dateISO)} />
        </View>
      </View>

      <View style={styles.quickWrap}>
        <Text style={styles.sectionTitle}>Quick stressor</Text>
        <View style={styles.quickRow}>
          {STRESSOR_KINDS.map((kind) => (
            <Button
              key={kind}
              title={labelForStressor(kind)}
              variant="ghost"
              onPress={() => addStressor(kind, dateISO)}
            />
          ))}
        </View>
      </View>

      {canUndo ? <Button title="Undo last change" variant="ghost" onPress={undoLastChange} /> : null}

      <Button title="Do check-in" onPress={() => navigation.navigate("CheckIn", { dateISO })} />

      <Card>
        <Text style={styles.blockTitle}>Workout</Text>
        <Text style={styles.meta}>{day.workout.title} - {day.workout.minutes} min</Text>
        <Text style={styles.meta}>Window: {day.workoutWindow || "PM"}</Text>
        <View style={{ height: 10 }} />
        {day.workout.steps.map((line, idx) => (
          <Text key={idx} style={styles.line}>- {line}</Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.blockTitle}>Nutrition</Text>
        <Text style={styles.meta}>{day.nutrition.title}</Text>
        <View style={{ height: 10 }} />
        {day.nutrition.priorities.map((line, idx) => (
          <Text key={idx} style={styles.line}>- {line}</Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.blockTitle}>Reset</Text>
        <Text style={styles.meta}>{day.reset.title} - {day.reset.minutes} min</Text>
        <View style={{ height: 10 }} />
        {day.reset.steps.map((line, idx) => (
          <Text key={idx} style={styles.line}>- {line}</Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.blockTitle}>Rationale</Text>
        <View style={{ height: 10 }} />
        {day.rationale.slice(0, 3).map((line, idx) => (
          <Text key={idx} style={styles.line}>- {line}</Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.blockTitle}>Did this help?</Text>
        <View style={{ height: 8 }} />
        <View style={styles.quickRow}>
          <Button title="Yes" variant="ghost" onPress={() => { setShowReasons(false); submitFeedback({ dateISO, helped: true }); }} />
          <Button title="No" variant="ghost" onPress={() => setShowReasons((v) => !v)} />
        </View>
        {showReasons ? (
          <View style={styles.quickRow}>
            <Button title="Too hard" variant="ghost" onPress={() => submitFeedback({ dateISO, helped: false, reason: "too_hard" })} />
            <Button title="Too easy" variant="ghost" onPress={() => submitFeedback({ dateISO, helped: false, reason: "too_easy" })} />
            <Button title="Wrong time" variant="ghost" onPress={() => submitFeedback({ dateISO, helped: false, reason: "wrong_time" })} />
            <Button title="Not relevant" variant="ghost" onPress={() => submitFeedback({ dateISO, helped: false, reason: "not_relevant" })} />
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 18, gap: 14 },
  logoRow: { alignItems: "flex-start" },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
  p: { fontSize: 15, color: "#374151" },
  sectionTitle: { fontSize: 14, color: "#111827", fontWeight: "700" },
  quickWrap: { gap: 8 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  blockTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  meta: { fontSize: 13, color: "#6B7280" },
  line: { fontSize: 15, color: "#374151", lineHeight: 22 },
});

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

function focusStatement(focus) {
  if (focus === "downshift") return "Today is about lowering activation and protecting sleep pressure.";
  if (focus === "rebuild") return "Today is about rebuilding capacity while staying cortisol-safe.";
  return "Today is about steady support without adding extra strain.";
}
