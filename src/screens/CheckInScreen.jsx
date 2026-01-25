import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import Button from "../ui/Button";
import { useAppStore } from "../state/store";

const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60];

function coerceTimeInput(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return 20;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 20;
  let closest = TIME_OPTIONS[0];
  let minDiff = Math.abs(n - closest);
  TIME_OPTIONS.forEach((opt) => {
    const diff = Math.abs(n - opt);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  });
  return closest;
}

function clampScale(value, fallback) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, n));
}

export default function CheckInScreen({ route, navigation }) {
  const { dateISO } = route.params;
  const addCheckIn = useAppStore((s) => s.addCheckIn);

  const [stress, setStress] = useState("6");
  const [sleepQuality, setSleepQuality] = useState("6");
  const [energy, setEnergy] = useState("6");
  const [timeAvailableMin, setTimeAvailableMin] = useState("20");
  const [notes, setNotes] = useState("");

  const save = async () => {
    const checkIn = {
      dateISO,
      stress: clampScale(stress, 6),
      sleepQuality: clampScale(sleepQuality, 6),
      energy: clampScale(energy, 6),
      timeAvailableMin: coerceTimeInput(timeAvailableMin),
    };

    if (notes.trim()) checkIn.notes = notes.trim();

    await addCheckIn(checkIn);
    navigation.goBack();
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>Check-in</Text>
      <Text style={styles.p}>{dateISO}</Text>

      <Field label="Stress (1-10)" v={stress} setV={setStress} />
      <Field label="Sleep quality (1-10)" v={sleepQuality} setV={setSleepQuality} />
      <Field label="Energy (1-10)" v={energy} setV={setEnergy} />
      <Field label="Time available (minutes)" v={timeAvailableMin} setV={setTimeAvailableMin} />
      <Field label="Notes (optional)" v={notes} setV={setNotes} />

      <Button title="Save" onPress={save} />
    </View>
  );
}

function Field(props) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput value={props.v} onChangeText={props.setV} style={styles.input} autoCapitalize="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 18, gap: 14 },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
  p: { fontSize: 15, color: "#374151" },
  label: { fontSize: 14, color: "#374151", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
