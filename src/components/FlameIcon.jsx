import React, { useEffect, useRef, useState } from 'react';
import { Animated, AccessibilityInfo } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Streak tiers — color warms and the flicker quickens/strengthens as the
// streak grows. Mirrors the milestone language elsewhere in the app: gold for
// the early days, a warmer ember through the first month, a hot flame after.
//   1-6   → brand gold, calm flicker
//   7-29  → warmer orange, livelier
//   30+   → hot orange, strongest flicker
function tierForStreak(streak) {
  if (streak >= 30) return { color: '#ff6a2a', period: 900, minOpacity: 0.78, maxScale: 1.06 };
  if (streak >= 7) return { color: '#e0892e', period: 1100, minOpacity: 0.82, maxScale: 1.045 };
  return { color: '#c4a86c', period: 1400, minOpacity: 0.85, maxScale: 1.03 };
}

// Crafted flame icon (Lucide "flame" path) — replaces the 🔥 emoji, which
// renders inconsistently across platforms and can't be themed. Stroke-based so
// it matches the app's thin-line icon language and takes the brand gold.
//
// When a `streak` is passed the color is derived by tier and a subtle flicker
// (opacity + scale loop) brings the flame alive — higher streak = warmer +
// stronger flicker. The flicker is skipped when the OS reduce-motion setting
// is on. Without `streak` it renders exactly as before (static).
export default function FlameIcon({ size = 18, color, strokeWidth = 2, streak }) {
  const hasStreak = typeof streak === 'number';
  const tier = hasStreak ? tierForStreak(streak) : null;
  const resolvedColor = color || tier?.color || '#c4a86c';

  const flicker = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (mounted) setReduceMotion(on); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hasStreak || reduceMotion) return;
    const half = tier.period / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 0, duration: half, useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 1, duration: half, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hasStreak, reduceMotion, tier?.period]);

  // Static render — backward compatible, no animation wrapper.
  if (!hasStreak || reduceMotion) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          stroke={resolvedColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  const opacity = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [tier.minOpacity, 1],
  });
  const scale = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [1, tier.maxScale],
  });

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <AnimatedPath
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          stroke={resolvedColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
}
