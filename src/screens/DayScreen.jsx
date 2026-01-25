import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAppStore } from "../state/store";
import Card from "../ui/Card";
import Button from "../ui/Button";
import BrandLogo from "../components/BrandLogo";

export default function DayScreen({ route, navigation }) {
  const { dateISO } = route.params;
  const weekPlan = useAppStore((s) => s.weekPlan);
  const ensureCurrentWeek = useAppStore((s) => s.ensureCurrentWeek);
  const applyQuickSignal = useAppStore((s) => s.applyQuickSignal);
  const addStressor = useAppStore((s) => s.addStressor);
  const lastStressStateByDate = useAppStore((s) => s.lastStressStateByDate);
  const history = useAppStore((s) => s.history);
  const undoLastChange = useAppStore((s) => s.undoLastChange);
  const activateBadDayMode = useAppStore((s) => s.activateBadDayMode);
  const submitFeedback = useAppStore((s) => s.submitFeedback);
  const togglePartCompletion = useAppStore((s) => s.togglePartCompletion);
  const partCompletionByDate = useAppStore((s) => s.partCompletionByDate);
  const checkIns = useAppStore((s) => s.checkIns);
  const dayViewed = useAppStore((s) => s.dayViewed);

  const day = weekPlan?.days.find((d) => d.dateISO === dateISO);
  const drivers = lastStressStateByDate?.[dateISO]?.drivers || [];
  const canUndo = history.length && history[0].dateISO === dateISO;
  const [showReasons, setShowReasons] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const checkIn = checkIns.find((c) => c.dateISO === dateISO);
  const timeAvailableMin = checkIn?.timeAvailableMin;

  const loggedRef = useRef(null);

  useEffect(() => {
    if (!day) return;
    if (loggedRef.current === dateISO) return;
    loggedRef.current = dateISO;
    dayViewed({
      dateISO,
      pipelineVersion: day.pipelineVersion,
      appliedRules: day.meta?.appliedRules || [],
    });
  }, [dateISO, day, dayViewed]);

  if (!day) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.h1}>No plan for this day yet.</Text>
        <Button title="Rebuild this week" onPress={async () => { await ensureCurrentWeek(); navigation.goBack(); }} />
      </View>
    );
  }

  const totalMinutes = (day.workout?.minutes || 0) + (day.reset?.minutes || 0);
  const parts = partCompletionByDate?.[dateISO] || {};

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.logoRow}>
        <BrandLogo variant="mark" size={28} />
      </View>
      <Text style={styles.h1}>{dateISO}</Text>
      <Button title="Today is a bad day" variant="ghost" onPress={() => activateBadDayMode(dateISO)} />

      <Card>
        <Text style={styles.blockTitle}>What you're doing today</Text>
        <Text style={styles.meta}>Workout: {day.workout.title} - {day.workout.minutes} min</Text>
        <Text style={styles.meta}>Window: {day.workoutWindow || "PM"}</Text>
        <Text style={styles.meta}>Reset: {day.reset.title} - {day.reset.minutes} min</Text>
        <Text style={styles.meta}>Nutrition: {day.nutrition.title}</Text>
      </Card>

      <Card>
        <Text style={styles.blockTitle}>Why</Text>
        <Text style={styles.meta}>Profile: {day.profile}</Text>
        <Text style={styles.meta}>Focus: {day.focus}</Text>
        {drivers.slice(0, 2).length ? (
          drivers.slice(0, 2).map((line, idx) => (
            <Text key={idx} style={styles.line}>- {line}</Text>
          ))
        ) : (
          <Text style={styles.line}>- n/a</Text>
        )}
        <View style={{ height: 8 }} />
        <Text style={styles.line}>{focusStatement(day.focus)}</Text>
        {day.rationale.slice(0, 2).map((line, idx) => (
          <Text key={`r-${idx}`} style={styles.line}>- {line}</Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.blockTitle}>How long</Text>
        <Text style={styles.meta}>Total: {totalMinutes} min</Text>
        {timeAvailableMin ? <Text style={styles.meta}>Time available: {timeAvailableMin} min</Text> : null}
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

      <View style={styles.quickWrap}>
        <Text style={styles.sectionTitle}>Mark done</Text>
        <View style={styles.quickRow}>
          <Button title={parts.workout ? "Workout done" : "Workout done"} variant={parts.workout ? "primary" : "ghost"} onPress={() => togglePartCompletion(dateISO, "workout")} />
          <Button title={parts.reset ? "Reset done" : "Reset done"} variant={parts.reset ? "primary" : "ghost"} onPress={() => togglePartCompletion(dateISO, "reset")} />
          <Button title={parts.nutrition ? "Nutrition done" : "Nutrition done"} variant={parts.nutrition ? "primary" : "ghost"} onPress={() => togglePartCompletion(dateISO, "nutrition")} />
        </View>
      </View>

      {canUndo ? <Button title="Undo last change" variant="ghost" onPress={undoLastChange} /> : null}

      <Button title="Add check-in" onPress={() => navigation.navigate("CheckIn", { dateISO })} />

      <Button
        title={showDetails ? "Hide details" : "Show details"}
        variant="ghost"
        onPress={() => setShowDetails((v) => !v)}
      />

      {showDetails ? (
        <Card>
          <Text style={styles.blockTitle}>Details</Text>
          <Text style={styles.meta}>Workout steps</Text>
          {day.workout.steps.map((line, idx) => (
            <Text key={`w-${idx}`} style={styles.line}>- {line}</Text>
          ))}
          <View style={{ height: 8 }} />
          <Text style={styles.meta}>Nutrition priorities</Text>
          {day.nutrition.priorities.map((line, idx) => (
            <Text key={`n-${idx}`} style={styles.line}>- {line}</Text>
          ))}
          <View style={{ height: 8 }} />
          <Text style={styles.meta}>Reset steps</Text>
          {day.reset.steps.map((line, idx) => (
            <Text key={`r-${idx}`} style={styles.line}>- {line}</Text>
          ))}
        </Card>
      ) : null}

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
