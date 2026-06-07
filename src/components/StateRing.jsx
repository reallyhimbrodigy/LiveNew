import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet, AccessibilityInfo } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Calm, nervous-system-flavored word for the score band. Higher score = more
// regulated state; lower score = more elevated/frayed. This is the one-word
// read in the center of the ring — the qualitative companion to the number.
function captionForScore(score) {
  if (score >= 80) return 'regulated';
  if (score >= 60) return 'steady';
  if (score >= 40) return 'settling';
  if (score >= 20) return 'elevated';
  return 'frayed';
}

// Hero "state ring" — the centerpiece of Today. A gold arc that draws in to
// represent today's 0–100 state, with the number and a one-word read in the
// center. Built on react-native-svg; the arc draw uses the built-in Animated
// API (no reanimated dependency) and honors Reduce Motion.
export default function StateRing({
  score = 0,
  size = 208,
  strokeWidth = 14,
  onPress,
  caption,
}) {
  const { colors, fonts } = useTheme();
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const word = caption || captionForScore(clamped);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - clamped / 100);

  // Arc starts empty (fully offset) and animates to the target on mount.
  const offset = useRef(new Animated.Value(circumference)).current;
  // Center number + halo fade/scale in just behind the arc for a soft reveal.
  const reveal = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (cancelled) return;
      setReduceMotion(on);
      if (on) {
        // No animation: snap to final state.
        offset.setValue(targetOffset);
        reveal.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.timing(offset, {
          toValue: targetOffset,
          duration: 1100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false, // strokeDashoffset is not a transform/opacity
        }),
        Animated.timing(reveal, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => { cancelled = true; };
    // Re-run when the score changes so the arc re-draws to the new value.
  }, [targetOffset, circumference]);

  const haloStyle = {
    opacity: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
  };

  const ring = (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Soft gold halo behind the center — sells the "glow" without a blur lib. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          { width: size * 0.62, height: size * 0.62, borderRadius: size, backgroundColor: colors.ringGlow },
          haloStyle,
        ]}
      />
      <Svg width={size} height={size}>
        <Defs>
          <SvgGradient id="stateRingGold" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.goldDeep} />
            <Stop offset="1" stopColor={colors.gold} />
          </SvgGradient>
        </Defs>
        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.ringTrack}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc — rotated -90° so it starts at 12 o'clock. */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#stateRingGold)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {/* Center label */}
      <Animated.View style={[styles.center, haloStyle]} pointerEvents="none">
        <Text style={[styles.number, { fontFamily: fonts.displayBold, color: colors.text }]}>{clamped}</Text>
        <Text style={[styles.caption, { fontFamily: fonts.displaySemibold, color: colors.gold }]}>{word}</Text>
      </Animated.View>
    </View>
  );

  if (!onPress) return ring;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Today's state: ${clamped} out of 100, ${word}. Tap to see what this means.`}
      style={({ pressed }) => [{ alignItems: 'center' }, pressed && { opacity: 0.85 }]}
    >
      {ring}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    fontSize: 60,
    lineHeight: 66,
    letterSpacing: -1,
  },
  caption: {
    fontSize: 13,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});
