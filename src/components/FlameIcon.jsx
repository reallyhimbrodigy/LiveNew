import React, { useEffect, useRef, useState } from 'react';
import { Animated, AccessibilityInfo, Easing, View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, RadialGradient, Stop, Circle } from 'react-native-svg';

const AnimatedView = Animated.createAnimatedComponent(View);

// The classic Lucide "flame" outline — used for the static (no-streak) render so
// other call sites keep the thin-line icon language.
const OUTLINE_PATH =
  'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z';

// A solid teardrop flame body used for the FILLED, gradient render. Slightly
// rounder/fuller than the outline so the gradient reads as a real flame.
const BODY_PATH =
  'M12 2c.6 2.6 2 4.7 4 6.3 2 1.7 3 3.7 3 5.7a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3.3.2 1.3 1 2.3 2.3 2.3 1.4 0 2.4-1.1 2.4-2.5 0-1.4-.6-2.1-1.1-3.1C11.9 5.9 11.8 3.9 12 2z';

// An inner flame (drawn smaller/centered) for high tiers — the hot core.
const CORE_PATH =
  'M12 8.2c.5 1.4 1.4 2.4 2.2 3.4 .9 1 1.4 2 1.4 3.1a3.6 3.6 0 1 1-7.2 0c0-.8.3-1.6.8-2.2.2.8.8 1.4 1.6 1.4.9 0 1.5-.7 1.5-1.6 0-.8-.4-1.3-.7-1.9-.4-.8-.4-1.6.4-2.2z';

// Streak tiers — color warms and the flicker quickens/strengthens as the streak
// grows, matching the user's vision: calm gold ember early, hot red around a
// month, magenta then PURPLE and most-alive at 100+. Each tier defines:
//   color      — primary flame fill / outline color
//   color2     — secondary gradient stop (hotter highlight up the flame)
//   glow       — radial glow color behind the flame (null = no glow)
//   period     — full flicker cycle in ms (lower = faster flicker)
//   minOpacity — bottom of the opacity flicker (1 = top)
//   maxScale   — top of the scale pulse (1 = bottom)
//   filled     — true → gradient-filled flame body; false → thin outline
//   core       — true → draw a second inner flame layer (hot core)
//   sparks     — true → draw drifting spark embers (top tier only)
function tierForStreak(streak) {
  const s = typeof streak === 'number' ? streak : 0;
  // EVERY tier is a filled, glowing, animated flame — even day one is a small
  // live ember, never a dead outline. Color/scale/speed/core/sparks all ramp so
  // the flame visibly gets hotter and more alive as the streak climbs.
  if (s >= 100)
    return { color: '#9a5cf0', color2: '#c98cff', glow: '#7a3cf0', period: 470, minOpacity: 0.6, maxScale: 1.24, filled: true, core: true, sparks: true };
  if (s >= 60)
    return { color: '#e8358a', color2: '#f06ad0', glow: '#e8358a', period: 550, minOpacity: 0.64, maxScale: 1.18, filled: true, core: true, sparks: true };
  if (s >= 30)
    return { color: '#ef4a2a', color2: '#f5732a', glow: '#ef4a2a', period: 630, minOpacity: 0.68, maxScale: 1.15, filled: true, core: true, sparks: false };
  if (s >= 14)
    return { color: '#f0701e', color2: '#f5a02a', glow: '#f0701e', period: 730, minOpacity: 0.7, maxScale: 1.12, filled: true, core: false, sparks: false };
  if (s >= 7)
    return { color: '#f08a2e', color2: '#f5b347', glow: '#f0901e', period: 850, minOpacity: 0.72, maxScale: 1.10, filled: true, core: false, sparks: false };
  if (s >= 3)
    return { color: '#eba93f', color2: '#f5cf78', glow: '#e8a93f', period: 1000, minOpacity: 0.74, maxScale: 1.08, filled: true, core: false, sparks: false };
  return { color: '#e0b85a', color2: '#f0d488', glow: '#d8a838', period: 1150, minOpacity: 0.76, maxScale: 1.07, filled: true, core: false, sparks: false };
}

// Crafted flame icon — replaces the 🔥 emoji, which renders inconsistently and
// can't be themed. Two modes:
//
//   • No `streak`  → original static thin-line flame (back-compat; other call
//     sites pass size/color only).
//   • With `streak` → a progressive, living flame. Color, fill, glow and flicker
//     all ramp with the streak: small calm gold ember at day one, hot red near a
//     month, magenta, then a fully-alive PURPLE flame with a hot inner core and
//     drifting sparks at 100+. The flicker is opacity (0.7–0.88 ↔ 1) + a scale
//     pulse (1 ↔ ~1.025–1.16), faster and bigger by tier.
//
// All animation is skipped when the OS reduce-motion setting is on (we fall back
// to a still, fully-colored flame), every loop is cleaned up on unmount, and the
// transform/opacity animations use the native driver.
export default function FlameIcon({ size = 18, color, strokeWidth = 2, streak }) {
  const hasStreak = typeof streak === 'number';
  const tier = hasStreak ? tierForStreak(streak) : null;
  const resolvedColor = color || tier?.color || '#d8b56a';

  const flicker = useRef(new Animated.Value(1)).current; // primary flame flicker
  const coreFlicker = useRef(new Animated.Value(0.5)).current; // out-of-phase core
  const sparkT = useRef(new Animated.Value(0)).current; // spark drift 0→1
  // Stable per-instance suffix so SVG gradient ids never collide between two
  // flames on screen (e.g. the header chip + a streak-risk banner).
  const uidRef = useRef(Math.random().toString(36).slice(2, 9));
  const uid = uidRef.current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (mounted) setReduceMotion(on); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      if (mounted) setReduceMotion(on);
    });
    return () => {
      mounted = false;
      // RN >= 0.65 returns a subscription with remove(); guard for older shapes.
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!hasStreak || reduceMotion) return undefined;
    const half = tier.period / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 0, duration: half, easing: Easing.sin, useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 1, duration: half, easing: Easing.sin, useNativeDriver: true }),
      ])
    );
    loop.start();

    // Inner core breathes slightly faster and out of phase for a "living" look.
    let coreLoop;
    if (tier.core) {
      const cHalf = tier.period * 0.35;
      coreLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(coreFlicker, { toValue: 1, duration: cHalf, easing: Easing.sin, useNativeDriver: true }),
          Animated.timing(coreFlicker, { toValue: 0, duration: cHalf, easing: Easing.sin, useNativeDriver: true }),
        ])
      );
      coreLoop.start();
    }

    // Sparks drift up + fade on a continuous loop (top tier only).
    let sparkLoop;
    if (tier.sparks) {
      sparkLoop = Animated.loop(
        Animated.timing(sparkT, { toValue: 1, duration: tier.period * 1.6, easing: Easing.linear, useNativeDriver: true })
      );
      sparkLoop.start();
    }

    return () => {
      loop.stop();
      if (coreLoop) coreLoop.stop();
      if (sparkLoop) { sparkLoop.stop(); sparkT.setValue(0); }
    };
  }, [hasStreak, reduceMotion, tier?.period, tier?.core, tier?.sparks]);

  // ── Static / back-compat render ───────────────────────────────────────────
  // No streak, OR reduce-motion is on. We still color a filled flame for higher
  // tiers (so the streak still reads "hotter") but with no animation wrapper.
  if (!hasStreak || reduceMotion) {
    if (hasStreak && tier.filled) {
      const gid = `flameStatic${uid}`;
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Defs>
            <LinearGradient id={gid} x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={tier.color2} />
              <Stop offset="1" stopColor={tier.color} />
            </LinearGradient>
          </Defs>
          <Path d={BODY_PATH} fill={`url(#${gid})`} />
        </Svg>
      );
    }
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d={OUTLINE_PATH}
          stroke={resolvedColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  // ── Animated render ───────────────────────────────────────────────────────
  const opacity = flicker.interpolate({ inputRange: [0, 1], outputRange: [tier.minOpacity, 1] });
  const scale = flicker.interpolate({ inputRange: [0, 1], outputRange: [1, tier.maxScale] });
  const glowOpacity = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.6] });
  const glowScale = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.25] });
  const coreOpacity = coreFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const coreScale = coreFlicker.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] });

  // Spark drift: rise up the flame while fading out.
  const sparkTranslateY = sparkT.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.55] });
  const sparkOpacity = sparkT.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 0.9, 0.4, 0] });

  const bodyGid = `flameBody${uid}`;
  const coreGid = `flameCore${uid}`;
  const glowGid = `flameGlow${uid}`;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Soft radial glow behind the flame (mid/high tiers). Pure SVG so it
          composites cleanly; scaled/faded with the flicker via native driver. */}
      {tier.glow ? (
        <AnimatedView
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size * 1.7,
            height: size * 1.7,
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          }}
        >
          <Svg width={size * 1.7} height={size * 1.7} viewBox="0 0 24 24">
            <Defs>
              <RadialGradient id={glowGid} cx="12" cy="13" r="11" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={tier.glow} stopOpacity="0.85" />
                <Stop offset="0.6" stopColor={tier.glow} stopOpacity="0.35" />
                <Stop offset="1" stopColor={tier.glow} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx="12" cy="13" r="11" fill={`url(#${glowGid})`} />
          </Svg>
        </AnimatedView>
      ) : null}

      {/* Flame body — filled gradient for tiers >= 7, thin outline for embers. */}
      <Animated.View
        style={{ position: 'absolute', opacity, transform: [{ scale }] }}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Defs>
            <LinearGradient id={bodyGid} x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={tier.color2} />
              <Stop offset="1" stopColor={tier.color} />
            </LinearGradient>
          </Defs>
          {tier.filled ? (
            <Path d={BODY_PATH} fill={`url(#${bodyGid})`} />
          ) : (
            <Path
              d={OUTLINE_PATH}
              stroke={resolvedColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
      </Animated.View>

      {/* Hot inner core — a second flame layer for the most intense tiers,
          breathing out of phase with the body for a flickering, alive feel. */}
      {tier.core ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', opacity: coreOpacity, transform: [{ scale: coreScale }] }}
        >
          <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Defs>
              <LinearGradient id={coreGid} x1="12" y1="8" x2="12" y2="20" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#fff3b0" />
                <Stop offset="1" stopColor={tier.color2} />
              </LinearGradient>
            </Defs>
            <Path d={CORE_PATH} fill={`url(#${coreGid})`} />
          </Svg>
        </Animated.View>
      ) : null}

      {/* Drifting sparks — top tier only. Two small embers rising + fading. */}
      {tier.sparks ? (
        <AnimatedView
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            opacity: sparkOpacity,
            transform: [{ translateY: sparkTranslateY }],
          }}
        >
          <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Circle cx="8.5" cy="9" r="0.9" fill="#fff3b0" />
            <Circle cx="15" cy="11" r="0.7" fill={tier.color} />
            <Circle cx="12" cy="7" r="0.6" fill="#ffd9f2" />
          </Svg>
        </AnimatedView>
      ) : null}
    </View>
  );
}
