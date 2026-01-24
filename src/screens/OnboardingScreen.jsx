import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Button from "../ui/Button";
import { useAppStore } from "../state/store";
import BrandLogo from "../components/BrandLogo";

export default function OnboardingScreen({ navigation }) {
  const hydrate = useAppStore((s) => s.hydrate);
  const baseline = useAppStore((s) => s.baseline);
  const resetData = useAppStore((s) => s.resetData);

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (baseline) navigation.replace("Home");
  }, [baseline]);

  return (
    <View style={styles.wrap}>
      <View style={styles.logoWrap}>
        <BrandLogo variant="full" size={96} />
      </View>
      <Text style={styles.h1}>Cortisol-first wellness.</Text>
      <Text style={styles.p}>
        LiveNew designs your week around downshifting stress hormones through movement, food timing, and nervous-system regulation.
      </Text>
      <Button title="Start baseline" onPress={() => navigation.navigate("Baseline")} />
      {__DEV__ ? <Button title="Reset data" variant="ghost" onPress={resetData} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 18, gap: 14, justifyContent: "center" },
  logoWrap: { alignItems: "center", width: "100%" },
  h1: { fontSize: 28, fontWeight: "800", color: "#111827" },
  p: { fontSize: 16, lineHeight: 22, color: "#374151" },
});
