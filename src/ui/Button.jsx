import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";

export default function Button(props) {
  const v = props.variant ?? "primary";
  return (
    <Pressable onPress={props.onPress} style={[styles.base, v === "primary" ? styles.primary : styles.ghost]}>
      <Text style={[styles.text, v === "primary" ? styles.textPrimary : styles.textGhost]}>{props.title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: "center" },
  primary: { backgroundColor: "#111827" },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#E5E7EB" },
  text: { fontSize: 16, fontWeight: "600" },
  textPrimary: { color: "white" },
  textGhost: { color: "#111827" },
});
