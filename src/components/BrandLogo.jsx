import React from "react";
import { Image, View, StyleSheet } from "react-native";

const sources = {
  full: require("../../assets/brand/livenew-logo.png"),
  mark: require("../../assets/brand/livenew-mark.png"),
};

export default function BrandLogo({ variant, size }) {
  const isMark = variant === "mark";
  const source = isMark ? sources.mark : sources.full;
  const wrapStyle = isMark ? { width: size, height: size } : { width: "100%", height: size };
  const imageStyle = isMark ? { width: size, height: size } : { width: "100%", height: size };
  return (
    <View style={[styles.wrap, wrapStyle]}>
      <Image source={source} style={[styles.image, imageStyle]} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  image: {},
});
