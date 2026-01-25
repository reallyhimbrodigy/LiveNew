import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView } from "react-native";
import Button from "../ui/Button";
import { useAppStore } from "../state/store";
import BrandLogo from "../components/BrandLogo";
import { isoToday, weekStartMonday, addDaysISO } from "../domain";

export default function BaselineScreen({ navigation }) {
  const setUserProfile = useAppStore((s) => s.setUserProfile);
  const ensureCurrentWeek = useAppStore((s) => s.ensureCurrentWeek);
  const existingProfile = useAppStore((s) => s.userProfile);

  const todayISO = useMemo(() => isoToday(), []);
  const weekStart = useMemo(() => weekStartMonday(todayISO), [todayISO]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart]);

  const [sleepHours, setSleepHours] = useState("7");
  const [caffeineCups, setCaffeineCups] = useState("1");
  const [workoutsPerWeek, setWorkoutsPerWeek] = useState("3");
  const [perceivedStress, setPerceivedStress] = useState("6");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [bedTime, setBedTime] = useState("23:00");
  const [timePerDayMin, setTimePerDayMin] = useState("20");
  const [lateScreenMinutesPerNight, setLateScreenMinutesPerNight] = useState("45");
  const [alcoholNightsPerWeek, setAlcoholNightsPerWeek] = useState("1");
  const [sunlightMinutesPerDay, setSunlightMinutesPerDay] = useState("10");
  const [mealTimingConsistency, setMealTimingConsistency] = useState("5");
  const [lateCaffeineDaysPerWeek, setLateCaffeineDaysPerWeek] = useState("1");
  const [sleepRegularity, setSleepRegularity] = useState("5");
  const [preferredWorkoutWindows, setPreferredWorkoutWindows] = useState(["PM"]);
  const [busyDays, setBusyDays] = useState([]);

  const toggleWindow = (win) => {
    setPreferredWorkoutWindows((prev) => (prev.includes(win) ? prev.filter((w) => w !== win) : [...prev, win]));
  };

  const toggleBusyDay = (dateISO) => {
    setBusyDays((prev) => (prev.includes(dateISO) ? prev.filter((d) => d !== dateISO) : [...prev, dateISO]));
  };

  const commit = async () => {
    const id = existingProfile?.id || Math.random().toString(36).slice(2);
    const createdAtISO = existingProfile?.createdAtISO || todayISO;

    const profile = {
      id,
      createdAtISO,
      wakeTime,
      bedTime,
      sleepRegularity: Number(sleepRegularity),
      caffeineCupsPerDay: Number(caffeineCups),
      lateCaffeineDaysPerWeek: Number(lateCaffeineDaysPerWeek),
      sunlightMinutesPerDay: Number(sunlightMinutesPerDay),
      lateScreenMinutesPerNight: Number(lateScreenMinutesPerNight),
      alcoholNightsPerWeek: Number(alcoholNightsPerWeek),
      mealTimingConsistency: Number(mealTimingConsistency),
      preferredWorkoutWindows: preferredWorkoutWindows.length ? preferredWorkoutWindows : ["PM"],
      busyDays,
      sleepHours: Number(sleepHours),
      workoutsPerWeek: Number(workoutsPerWeek),
      perceivedStress: Number(perceivedStress),
      goals: { calmer: true, energy: true, digestion: false, focus: true },
      constraints: { timePerDayMin: Number(timePerDayMin), dietaryStyle: "balanced" },
    };

    await setUserProfile(profile);
    await ensureCurrentWeek();
    navigation.replace("Home");
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.logoRow}>
        <BrandLogo variant="mark" size={32} />
      </View>
      <Text style={styles.h1}>Baseline</Text>

      <Field label="Sleep hours (typical)" value={sleepHours} setValue={setSleepHours} />
      <Field label="Caffeine cups/day" value={caffeineCups} setValue={setCaffeineCups} />
      <Field label="Workouts/week" value={workoutsPerWeek} setValue={setWorkoutsPerWeek} />
      <Field label="Perceived stress (1-10)" value={perceivedStress} setValue={setPerceivedStress} />
      <Field label="Wake time (HH:MM)" value={wakeTime} setValue={setWakeTime} />
      <Field label="Bedtime (HH:MM)" value={bedTime} setValue={setBedTime} />
      <Field label="Time per day (minutes)" value={timePerDayMin} setValue={setTimePerDayMin} />
      <Field label="Late screen minutes/night" value={lateScreenMinutesPerNight} setValue={setLateScreenMinutesPerNight} />
      <Field label="Alcohol nights/week" value={alcoholNightsPerWeek} setValue={setAlcoholNightsPerWeek} />
      <Field label="Sunlight minutes/day" value={sunlightMinutesPerDay} setValue={setSunlightMinutesPerDay} />
      <Field label="Meal timing consistency (1-10)" value={mealTimingConsistency} setValue={setMealTimingConsistency} />
      <Field label="Late caffeine days/week" value={lateCaffeineDaysPerWeek} setValue={setLateCaffeineDaysPerWeek} />
      <Field label="Sleep regularity (1-10)" value={sleepRegularity} setValue={setSleepRegularity} />

      <Text style={styles.sectionTitle}>Preferred workout window</Text>
      <View style={styles.toggleRow}>
        {["AM", "MIDDAY", "PM"].map((win) => (
          <Button
            key={win}
            title={win}
            variant={preferredWorkoutWindows.includes(win) ? "primary" : "ghost"}
            onPress={() => toggleWindow(win)}
          />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Busy days (this week)</Text>
      <View style={styles.toggleRow}>
        {weekDays.map((d) => (
          <Button
            key={d}
            title={d}
            variant={busyDays.includes(d) ? "primary" : "ghost"}
            onPress={() => toggleBusyDay(d)}
          />
        ))}
      </View>

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
  logoRow: { alignItems: "flex-start" },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
  sectionTitle: { fontSize: 14, color: "#111827", fontWeight: "700" },
  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
