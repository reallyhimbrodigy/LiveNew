/**
 * PlanBuilding — soothing "Iris is thinking" loader
 *
 * Shown while Iris generates the daily plan. A calm, premium experience:
 *   • Iris figure gently breathes (scale + opacity pulse, ~3200ms cycle).
 *   • 7 gold dots below the logo flow in a sequential wave — each dot
 *     crests and falls in turn, like a slow tide moving across them.
 *   • A rotating status line cross-fades every ~2400ms.
 *
 * Animation architecture:
 *   - Each dot owns its own Animated.Value (no shared progress value driving
 *     interpolations — that pattern causes native-driver issues when the value
 *     is shared across multiple nodes with different phase offsets).
 *   - All Animated.loop instances use useNativeDriver: true.
 *   - Loops start on mount and are stopped + cleaned up on unmount.
 *   - reduce-motion: breathing and wave are skipped; dots are shown at a
 *     consistent medium gold opacity so the screen still looks intentional
 *     (not blank or frozen-mid-animation).
 *
 * Props
 *   messages  string[]  Optional. Overrides DEFAULT_MESSAGES.
 *   style     ViewStyle Optional. Applied to the outermost container.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Animated, Easing,
  AccessibilityInfo, StyleSheet,
} from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

// ─── Tunable constants ────────────────────────────────────────────────────────
const IRIS_ASSET = require('../../assets/brand/iris-figure.png');
const IRIS_SIZE  = 112;           // image width / height px

// Breathing logo
const BREATHE_DURATION    = 4600; // ms — one full inhale+exhale cycle (slow,
                                  // deliberate; a calm breath reads as smoother
                                  // than a quick subtle pulse)
const BREATHE_SCALE_MIN   = 1.0;
const BREATHE_SCALE_MAX   = 1.075;
const BREATHE_OPACITY_MIN = 0.72;
const BREATHE_OPACITY_MAX = 1.0;

// Flowing wave dots
const DOT_COUNT   = 7;
const DOT_SIZE    = 7;            // diameter px
const DOT_GAP     = 14;           // gap between dot centres, px
const DOT_STAGGER = 180;          // ms between successive dot peaks
const DOT_RISE    = 320;          // ms — dot rising from dim to bright
const DOT_HOLD    = 100;          // ms — dot held at peak brightness
const DOT_FALL    = 360;          // ms — dot falling from bright back to dim
const DOT_ACTIVE  = DOT_RISE + DOT_HOLD + DOT_FALL; // 780ms total active time
// Total loop duration per dot — all dots share this same period so they stay
// in sync across loop iterations. Must be >= last_stagger + DOT_ACTIVE.
// (DOT_COUNT - 1) * DOT_STAGGER + DOT_ACTIVE = 1080 + 780 = 1860 → use 2000.
const DOT_PERIOD  = 2000;         // ms — one full wave cycle
const DOT_DIM_OPACITY  = 0.18;
const DOT_PEAK_OPACITY = 1.0;

// Glow pulse around the logo (soft radius halo — achieved via shadowOpacity)
const GLOW_DURATION = BREATHE_DURATION; // stay in sync with breathe

// Message rotation
const MESSAGE_INTERVAL = 2400;    // ms between message swaps
const MESSAGE_FADE_OUT = 220;
const MESSAGE_FADE_IN  = 300;

const DEFAULT_MESSAGES = [
  'Reading your signals…',
  'Pulling your cortisol pattern…',
  'Mapping the curve…',
  'Finding what matters today…',
  'Building zone by zone…',
  'Iris is being thorough…',
  'Almost ready…',
];
// ─────────────────────────────────────────────────────────────────────────────

export default function PlanBuilding({ messages, style }) {
  const { colors, fonts } = useTheme();
  const msgList = messages && messages.length ? messages : DEFAULT_MESSAGES;
  const glowId = React.useId();

  // ── Reduce-motion gate ──────────────────────────────────────────────────
  // IMPORTANT: Start as null (unknown) so we don't start animations that
  // immediately get cancelled. We wait for the async check before starting.
  const [reduceMotion, setReduceMotion] = useState(null);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) setReduceMotion(enabled ? true : false);
    });
    // Fallback: if the check takes >200ms, assume false so we don't stall.
    const fallback = setTimeout(() => {
      if (!cancelled) setReduceMotion(prev => (prev === null ? false : prev));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  // ── Animated values ─────────────────────────────────────────────────────
  const breatheScale   = useRef(new Animated.Value(BREATHE_SCALE_MIN)).current;
  const breatheOpacity = useRef(new Animated.Value(BREATHE_OPACITY_MIN)).current;
  const glowOpacity    = useRef(new Animated.Value(0)).current;

  // One Animated.Value per dot — each runs its own independent loop.
  const dotValues = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(DOT_DIM_OPACITY))
  ).current;

  const msgOpacity = useRef(new Animated.Value(1)).current;

  // ── Loop refs (stored so we can .stop() on unmount) ─────────────────────
  const loopRefs   = useRef([]);   // all Animated.loop handles
  const msgTimerRef = useRef(null);
  const msgFadeRef  = useRef(null);
  const mountedRef  = useRef(true);

  // ── Message state ────────────────────────────────────────────────────────
  const [msgIndex, setMsgIndex] = useState(0);

  // ── Helper: register + start a loop ─────────────────────────────────────
  const runLoop = useCallback((loop) => {
    loopRefs.current.push(loop);
    loop.start();
  }, []);

  // ── Start breathing animation ─────────────────────────────────────────────
  const startBreathe = useCallback(() => {
    // Scale breathe
    runLoop(Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, {
          toValue: BREATHE_SCALE_MAX,
          duration: BREATHE_DURATION / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breatheScale, {
          toValue: BREATHE_SCALE_MIN,
          duration: BREATHE_DURATION / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ));

    // Opacity breathe — same easing + phase as the scale so the figure
    // brightens AS it expands (one coherent breath, not loops drifting apart).
    runLoop(Animated.loop(
      Animated.sequence([
        Animated.timing(breatheOpacity, {
          toValue: BREATHE_OPACITY_MAX,
          duration: BREATHE_DURATION / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breatheOpacity, {
          toValue: BREATHE_OPACITY_MIN,
          duration: BREATHE_DURATION / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ));

    // Soft glow pulse (shadowOpacity-like effect via a tinted View behind logo)
    runLoop(Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.72,
          duration: GLOW_DURATION / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.42,
          duration: GLOW_DURATION / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ));
  }, [breatheScale, breatheOpacity, glowOpacity, runLoop]);

  // ── Start wave dots ───────────────────────────────────────────────────────
  const startWave = useCallback(() => {
    dotValues.forEach((val, i) => {
      // Each dot's loop: leading_rest → rise → hold → fall → trailing_rest.
      // All dots share the same DOT_PERIOD so they stay synchronised across
      // loop iterations. The stagger is split into leading + trailing rests
      // that always sum to (DOT_PERIOD - DOT_ACTIVE), keeping total time fixed.
      const leadRest    = i * DOT_STAGGER;
      const trailRest   = DOT_PERIOD - DOT_ACTIVE - leadRest; // always >= 0

      const sequence = [];
      if (leadRest > 0)  sequence.push(Animated.delay(leadRest));
      sequence.push(
        Animated.timing(val, {
          toValue: DOT_PEAK_OPACITY,
          duration: DOT_RISE,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      );
      if (DOT_HOLD > 0)  sequence.push(Animated.delay(DOT_HOLD));
      sequence.push(
        Animated.timing(val, {
          toValue: DOT_DIM_OPACITY,
          duration: DOT_FALL,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      );
      if (trailRest > 0) sequence.push(Animated.delay(trailRest));

      runLoop(Animated.loop(Animated.sequence(sequence)));
    });
  }, [dotValues, runLoop]);

  // ── Start message rotation ────────────────────────────────────────────────
  const startMessages = useCallback(() => {
    const rotate = () => {
      if (!mountedRef.current) return;
      const fadeOut = Animated.timing(msgOpacity, {
        toValue: 0,
        duration: MESSAGE_FADE_OUT,
        useNativeDriver: true,
      });
      msgFadeRef.current = fadeOut;
      fadeOut.start(() => {
        if (!mountedRef.current) return;
        setMsgIndex(i => (i + 1) % msgList.length);
        Animated.timing(msgOpacity, {
          toValue: 1,
          duration: MESSAGE_FADE_IN,
          useNativeDriver: true,
        }).start();
      });
    };
    msgTimerRef.current = setInterval(rotate, MESSAGE_INTERVAL);
  }, [msgOpacity, msgList.length]);

  // ── Effect: wait for reduce-motion, then start ────────────────────────────
  // Using `null` as the initial state means this effect waits one tick for the
  // async check, preventing a "start then immediately stop" race.
  useEffect(() => {
    if (reduceMotion === null) return; // still loading
    mountedRef.current = true;

    if (!reduceMotion) {
      startBreathe();
    }
    startMessages();

    return () => {
      mountedRef.current = false;
      loopRefs.current.forEach(l => l.stop());
      loopRefs.current = [];
      if (msgTimerRef.current) clearInterval(msgTimerRef.current);
      msgFadeRef.current?.stop();
    };
  }, [reduceMotion, startBreathe, startWave, startMessages]);

  // ── Glow sizes — a wide ambient halo plus a tighter luminous core, both
  //     fading to transparent so it reads as warm LIGHT, not a flat disc. ─────
  const GLOW_SIZE = IRIS_SIZE * 2.0;   // outer ambient halo
  const GLOW_CORE = IRIS_SIZE * 1.15;  // bright inner core

  // ── Dot container width ───────────────────────────────────────────────────
  const dotRowWidth = DOT_COUNT * DOT_SIZE + (DOT_COUNT - 1) * DOT_GAP;

  // ── Reduce-motion: static dot opacity ────────────────────────────────────
  // When reduce-motion is enabled, show dots at a visible-but-calm opacity
  // so the loader still reads as "active" rather than blank or broken.
  const staticDotOpacity = 0.4;

  return (
    <View style={[styles.container, style]}>

      {/* ── Logo + glow composition ── */}
      <View style={styles.logoWrap}>
        {/* Wide ambient halo — soft warm light that fades to nothing. */}
        <Animated.View
          style={[
            styles.glow,
            {
              width: GLOW_SIZE,
              height: GLOW_SIZE,
              opacity: reduceMotion ? 0.5 : glowOpacity,
              transform: reduceMotion ? undefined : [{ scale: breatheScale }],
            },
          ]}
          pointerEvents="none"
        >
          <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
            <Defs>
              <RadialGradient id={`${glowId}-halo`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor="#e8bd72" stopOpacity="0.30" />
                <Stop offset="42%"  stopColor="#cf9d52" stopOpacity="0.10" />
                <Stop offset="100%" stopColor="#cf9d52" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={GLOW_SIZE} height={GLOW_SIZE} fill={`url(#${glowId}-halo)`} />
          </Svg>
        </Animated.View>

        {/* Bright luminous core — a near-cream centre so it reads as glowing
            light rather than a muddy brown disc. */}
        <Animated.View
          style={[
            styles.glow,
            {
              width: GLOW_CORE,
              height: GLOW_CORE,
              opacity: reduceMotion ? 0.7 : glowOpacity,
              transform: reduceMotion ? undefined : [{ scale: breatheScale }],
            },
          ]}
          pointerEvents="none"
        >
          <Svg width={GLOW_CORE} height={GLOW_CORE}>
            <Defs>
              <RadialGradient id={`${glowId}-core`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor="#fff1d4" stopOpacity="0.5" />
                <Stop offset="45%"  stopColor="#ffd98f" stopOpacity="0.2" />
                <Stop offset="100%" stopColor="#ffd98f" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={GLOW_CORE} height={GLOW_CORE} fill={`url(#${glowId}-core)`} />
          </Svg>
        </Animated.View>

        {/* Iris breathing image */}
        <Animated.Image
          source={IRIS_ASSET}
          style={[
            styles.irisImage,
            {
              width: IRIS_SIZE,
              height: IRIS_SIZE,
              transform: [{ scale: reduceMotion ? 1 : breatheScale }],
              opacity: reduceMotion ? 1 : breatheOpacity,
            },
          ]}
          resizeMode="contain"
        />
      </View>

      {/* ── Rotating status message ── */}
      <Animated.Text
        style={[
          styles.message,
          {
            fontFamily: fonts.display,
            color: colors.muted,
            opacity: msgOpacity,
          },
        ]}
      >
        {msgList[msgIndex]}
      </Animated.Text>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
    gap: 48,
  },
  // Wrapper lets the glow sit behind the image via absolute positioning
  // without affecting the layout flow.
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The glow halo is absolutely centered behind the logo.
  glow: {
    position: 'absolute',
  },
  irisImage: {
    // No position:absolute so the logoWrap sizes to the image,
    // keeping the glow centered automatically.
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dot: {
    // backgroundColor and borderRadius set inline from theme
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    letterSpacing: 0.3,
    paddingHorizontal: 32,
  },
});
