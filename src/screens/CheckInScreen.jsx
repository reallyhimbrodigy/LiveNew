import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import Button from "../ui/Button";
import { useAppStore } from "../state/store";

export default function CheckInScreen({ route, navigation }) {
  const { dateISO } = route.params;
  const addCheckIn = useAppStore((s) => s.addCheckIn);

  const [stress, setStress] = useState("6");
  const [sleepQuality, setSleepQuality] = useState("6");
  const [energy, setEnergy] = useState("6");
  const [cravings, setCravings] = useState("4");

  const save = async () => {
    await addCheckIn({
      dateISO,
      stress: Number(stress),
      sleepQuality: Number(sleepQuality),
      energy: Number(energy),
      cravings: Number(cravings),
    });
    navigation.goBack();
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>Check-in</Text>
      <Text style={styles.p}>{dateISO}</Text>

      <Field label="Stress (1-10)" v={stress} setV={setStress} />
      <Field label="Sleep quality (1-10)" v={sleepQuality} setV={setSleepQuality} />
      <Field label="Energy (1-10)" v={energy} setV={setEnergy} />
      <Field label="Cravings (1-10)" v={cravings} setV={setCravings} />

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
