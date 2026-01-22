import React from "react";
import { View, StyleSheet } from "react-native";

export default function Card(props) {
  return <View style={styles.card}>{props.children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
});
