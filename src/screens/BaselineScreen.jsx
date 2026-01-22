import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView } from "react-native";
import Button from "../ui/Button";
import { useAppStore } from "../state/store";

export default function BaselineScreen({ navigation }) {
  const setBaseline = useAppStore((s) => s.setBaseline);
  const buildWeek = useAppStore((s) => s.buildWeek);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [sleepHours, setSleepHours] = useState("7");
  const [caffeineCups, setCaffeineCups] = useState("1");
  const [workoutsPerWeek, setWorkoutsPerWeek] = useState("3");
  const [perceivedStress, setPerceivedStress] = useState("6");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [bedtime, setBedtime] = useState("23:00");
  const [timePerDayMin, setTimePerDayMin] = useState("20");
  const [lateScreenMins, setLateScreenMins] = useState("45");
  const [alcoholNightsPerWeek, setAlcoholNightsPerWeek] = useState("1");
  const [sunlightMinsPerDay, setSunlightMinsPerDay] = useState("10");
  const [mealTimingConsistency, setMealTimingConsistency] = useState("5");
  const [lateCaffeineDaysPerWeek, setLateCaffeineDaysPerWeek] = useState("1");
  const [sleepRegularity, setSleepRegularity] = useState("5");

  const commit = async () => {
    const b = {
      sleepHours: Number(sleepHours),
      caffeineCups: Number(caffeineCups),
      workoutsPerWeek: Number(workoutsPerWeek),
      perceivedStress: Number(perceivedStress),
      wakeTime,
      bedtime,
      lateScreenMins: Number(lateScreenMins),
      alcoholNightsPerWeek: Number(alcoholNightsPerWeek),
      sunlightMinsPerDay: Number(sunlightMinsPerDay),
      mealTimingConsistency: Number(mealTimingConsistency),
      lateCaffeineDaysPerWeek: Number(lateCaffeineDaysPerWeek),
      sleepRegularity: Number(sleepRegularity),
      goals: { calmer: true, energy: true, digestion: false, focus: true },
      constraints: { timePerDayMin: Number(timePerDayMin), dietaryStyle: "balanced" },
    };
    await setBaseline(b);
    await buildWeek(todayISO);
    navigation.replace("Home");
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.h1}>Baseline</Text>

      <Field label="Sleep hours (typical)" value={sleepHours} setValue={setSleepHours} />
      <Field label="Caffeine cups/day" value={caffeineCups} setValue={setCaffeineCups} />
      <Field label="Workouts/week" value={workoutsPerWeek} setValue={setWorkoutsPerWeek} />
      <Field label="Perceived stress (1-10)" value={perceivedStress} setValue={setPerceivedStress} />
      <Field label="Wake time (HH:MM)" value={wakeTime} setValue={setWakeTime} />
      <Field label="Bedtime (HH:MM)" value={bedtime} setValue={setBedtime} />
      <Field label="Time per day (minutes)" value={timePerDayMin} setValue={setTimePerDayMin} />
      <Field label="Late screen minutes/night" value={lateScreenMins} setValue={setLateScreenMins} />
      <Field label="Alcohol nights/week" value={alcoholNightsPerWeek} setValue={setAlcoholNightsPerWeek} />
      <Field label="Sunlight minutes/day" value={sunlightMinsPerDay} setValue={setSunlightMinsPerDay} />
      <Field label="Meal timing consistency (1-10)" value={mealTimingConsistency} setValue={setMealTimingConsistency} />
      <Field label="Late caffeine days/week" value={lateCaffeineDaysPerWeek} setValue={setLateCaffeineDaysPerWeek} />
      <Field label="Sleep regularity (1-10)" value={sleepRegularity} setValue={setSleepRegularity} />

      <Button title="Generate my week" onPress={commit} />
    </ScrollView>
  );
}

function Field(props) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.setValue}
        style={styles.input}
        keyboardType="default"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 18, gap: 14 },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
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
