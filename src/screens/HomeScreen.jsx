import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAppStore } from "../state/store";
import Card from "../ui/Card";
import Button from "../ui/Button";
import BrandLogo from "../components/BrandLogo";
import { isoToday, computeProgress } from "../domain";
import { SCENARIOS } from "../dev/scenarios";
import { runSnapshotCheck, SNAPSHOT_IDS } from "../dev/snapshot";

export default function HomeScreen({ navigation }) {
  const weekPlan = useAppStore((s) => s.weekPlan);
  const ensureCurrentWeek = useAppStore((s) => s.ensureCurrentWeek);
  const checkIns = useAppStore((s) => s.checkIns);
  const lastStressStateByDate = useAppStore((s) => s.lastStressStateByDate);
  const userProfile = useAppStore((s) => s.userProfile);
  const completions = useAppStore((s) => s.completions);
  const eventLog = useAppStore((s) => s.eventLog);
  const clearEventLog = useAppStore((s) => s.clearEventLog);
  const computeAnyPartCompletionRate = useAppStore((s) => s.computeAnyPartCompletionRate);
  const partCompletionByDate = useAppStore((s) => s.partCompletionByDate);
  const applyScenario = useAppStore((s) => s.applyScenario);
  const ruleToggles = useAppStore((s) => s.ruleToggles);
  const setRuleToggles = useAppStore((s) => s.setRuleToggles);
  const getDebugBundle = useAppStore((s) => s.getDebugBundle);

  const todayISO = useMemo(() => isoToday(), []);
  const progress = useMemo(() => computeProgress({ checkIns, weekPlan, completions }), [checkIns, weekPlan, completions]);
  const todayProfile = lastStressStateByDate?.[todayISO]?.profile;
  const [didAutoOpen, setDidAutoOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const followThrough = useMemo(() => computeAnyPartCompletionRate(), [weekPlan, partCompletionByDate]);
  const [snapshotSummary, setSnapshotSummary] = useState("");
  const [showBundle, setShowBundle] = useState(false);
  const [bundleText, setBundleText] = useState("");

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
      <Text style={styles.p}>This week is built for regulation, not hustle.</Text>
      <View style={styles.kpiRow}>
        <Text style={styles.kpiText}>7-day avg stress: {progress.stressAvg7 == null ? "n/a" : progress.stressAvg7.toFixed(1)}</Text>
        <Text style={styles.kpiText}>Today profile: {todayProfile || "n/a"}</Text>
      </View>

      <Card>
        <Text style={styles.sectionTitle}>Progress</Text>
        <Text style={styles.small}>Avg sleep (7d): {progress.sleepAvg7 == null ? "n/a" : progress.sleepAvg7.toFixed(1)}</Text>
        <Text style={styles.small}>Adherence: {progress.adherencePct == null ? "n/a" : `${progress.adherencePct}%`}</Text>
        <Text style={styles.small}>Downshift minutes (7d): {progress.downshiftMinutes7 == null ? "n/a" : progress.downshiftMinutes7}</Text>
        <Text style={styles.small}>Weekly follow-through: {followThrough}%</Text>
      </Card>

      {__DEV__ ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>Debug log</Text>
            <View style={{ height: 6 }} />
            <Button title={showLog ? "Hide debug log" : "View debug log"} variant="ghost" onPress={() => setShowLog((v) => !v)} />
            <View style={{ height: 6 }} />
            <Button title="Clear debug log" variant="ghost" onPress={clearEventLog} />
            {showLog ? (
              <View style={{ marginTop: 8, maxHeight: 240 }}>
                <ScrollView>
                  {(eventLog || []).slice(0, 30).map((e) => (
                    <Text key={e.id} style={styles.small}>
                      {e.atISO} - {e.type} - {JSON.stringify(e.payload)}
                    </Text>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Scenario Runner</Text>
            <View style={{ height: 8 }} />
            <View style={styles.devRow}>
              {SCENARIOS.map((scenario) => (
                <Button
                  key={scenario.id}
                  title={scenario.title}
                  variant="ghost"
                  onPress={async () => {
                    await applyScenario(scenario.id);
                    navigation.navigate("Day", { dateISO: todayISO });
                  }}
                />
              ))}
            </View>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Rule Toggles</Text>
            <View style={{ height: 8 }} />
            <View style={styles.devRow}>
              <Button
                title={`Constraints: ${ruleToggles?.constraintsEnabled ? "On" : "Off"}`}
                variant={ruleToggles?.constraintsEnabled ? "primary" : "ghost"}
                onPress={() => setRuleToggles({ constraintsEnabled: !ruleToggles?.constraintsEnabled })}
              />
              <Button
                title={`Novelty: ${ruleToggles?.noveltyEnabled ? "On" : "Off"}`}
                variant={ruleToggles?.noveltyEnabled ? "primary" : "ghost"}
                onPress={() => setRuleToggles({ noveltyEnabled: !ruleToggles?.noveltyEnabled })}
              />
              <Button
                title={`Feedback: ${ruleToggles?.feedbackEnabled ? "On" : "Off"}`}
                variant={ruleToggles?.feedbackEnabled ? "primary" : "ghost"}
                onPress={() => setRuleToggles({ feedbackEnabled: !ruleToggles?.feedbackEnabled })}
              />
              <Button
                title={`Bad day: ${ruleToggles?.badDayEnabled ? "On" : "Off"}`}
                variant={ruleToggles?.badDayEnabled ? "primary" : "ghost"}
                onPress={() => setRuleToggles({ badDayEnabled: !ruleToggles?.badDayEnabled })}
              />
            </View>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Snapshot Checks</Text>
            <View style={{ height: 8 }} />
            <View style={styles.devRow}>
              <Button
                title="Run all"
                variant="ghost"
                onPress={() => {
                  let pass = 0;
                  let fail = 0;
                  SNAPSHOT_IDS.forEach((id) => {
                    const res = runSnapshotCheck(id, useAppStore.getState(), {
                      now: { todayISO: isoToday(), atISO: new Date().toISOString() },
                      ruleToggles,
                    });
                    if (res.ok) pass += 1;
                    else fail += 1;
                    if (!res.ok) console.log(`[snapshot] ${id}\n${res.diffs.join("\n")}`);
                  });
                  setSnapshotSummary(`Run all: ${pass}/${SNAPSHOT_IDS.length} passed (${fail} failed)`);
                }}
              />
              {SNAPSHOT_IDS.map((id) => (
                <Button
                  key={id}
                  title={id}
                  variant="ghost"
                  onPress={() => {
                    const res = runSnapshotCheck(id, useAppStore.getState(), {
                      now: { todayISO: isoToday(), atISO: new Date().toISOString() },
                      ruleToggles,
                    });
                    if (!res.ok) console.log(`[snapshot] ${id}\n${res.diffs.join("\n")}`);
                    setSnapshotSummary(`${id}: ${res.ok ? "pass" : "fail"} (${res.diffs.length})`);
                  }}
                />
              ))}
            </View>
            {snapshotSummary ? <Text style={styles.small}>{snapshotSummary}</Text> : null}
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Export Debug Bundle</Text>
            <View style={{ height: 8 }} />
            <Button
              title={showBundle ? "Hide JSON" : "Show JSON"}
              variant="ghost"
              onPress={() => {
                if (!showBundle) {
                  const bundle = getDebugBundle();
                  setBundleText(JSON.stringify(bundle, null, 2));
                }
                setShowBundle((v) => !v);
              }}
            />
            {showBundle ? (
              <View style={{ marginTop: 8, maxHeight: 240 }}>
                <ScrollView>
                  <Text style={styles.small}>{bundleText}</Text>
                </ScrollView>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

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
  devRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
