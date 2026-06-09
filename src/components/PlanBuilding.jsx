/**
 * PlanBuilding — breathing-girl + cortisol-ring loader
 *
 * Shown while Iris generates the daily plan. A calm, premium animation:
 *   • Iris mark image gently "breathes" (scale + opacity pulse).
 *   • 8 dots — one per cortisol zone — light up clockwise around a ring.
 *   • A rotating status line cross-fades every ~1700 ms.
 *
 * Respects AccessibilityInfo.isReduceMotionEnabled: if enabled the
 * breathing + ring animations are skipped (dots held at medium opacity)
 * but the message text still rotates.
 *
 * Props
 *   messages  string[]  Optional. Overrides DEFAULT_MESSAGES.
 *   style     ViewStyle Optional. Applied to the outermost container.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Image, Animated, Easing,
  AccessibilityInfo, StyleSheet,
} from 'react-native';
import { useTheme } from '../theme';

// ─── Tunable constants ────────────────────────────────────────────────────────
const IRIS_ASSET      = require('../../assets/brand/iris-mark.png');
const IRIS_SIZE       = 108;          // image width / height px
const RING_RADIUS     = 84;           // centre of image → centre of dot, px
const DOT_COUNT       = 8;            // must match cortisol zones
const DOT_SIZE        = 7;            // diameter of each ring dot, px

const BREATHE_DURATION   = 3000;      // ms for one breathe cycle
const BREATHE_SCALE_MIN  = 1.0;
const BREATHE_SCALE_MAX  = 1.04;
const BREATHE_OPACITY_MIN = 0.9;
const BREATHE_OPACITY_MAX = 1.0;

const DOT_CYCLE_TOTAL   = 1600;       // ms for one full ring rotation
const DOT_ON_OPACITY    = 1.0;
const DOT_OFF_OPACITY   = 0.18;

const MESSAGE_INTERVAL  = 1700;       // ms between message swaps
const MESSAGE_FADE_OUT  = 220;        // ms fade-out before swap
const MESSAGE_FADE_IN   = 280;        // ms fade-in after swap

const DEFAULT_MESSAGES = [
  'Reading your signals…',
  'Pulling your cortisol pattern…',
  'Mapping the curve…',
  'Finding what matters today…',
  'Building zone by zone…',
  'Iris is being thorough…',
];
// ─────────────────────────────────────────────────────────────────────────────

export default function PlanBuilding({ messages, style }) {
  const { colors, fonts } = useTheme();
  const msgList = messages && messages.length ? messages : DEFAULT_MESSAGES;

  // ── Reduce-motion gate ──────────────────────────────────────────────────
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) setReduceMotion(enabled);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Animated values ─────────────────────────────────────────────────────
  const breatheScale   = useRef(new Animated.Value(BREATHE_SCALE_MIN)).current;
  const breatheOpacity = useRef(new Animated.Value(BREATHE_OPACITY_MIN)).current;
  // One progress value 0→1 drives the whole ring; each dot derives its phase.
  const ringProgress   = useRef(new Animated.Value(0)).current;
  const msgOpacity     = useRef(new Animated.Value(1)).current;

  // ── Loop refs (stored so we can .stop() on unmount) ─────────────────────
  const breatheLoopRef = useRef(null);
  const ringLoopRef    = useRef(null);
  const msgTimerRef    = useRef(null);
  const mountedRef     = useRef(true);

  // ── Message state ────────────────────────────────────────────────────────
  const [msgIndex, setMsgIndex] = useState(0);

  // ── Start / stop breathing ────────────────────────────────────────────────
  const startBreathe = useCallback(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(breatheScale, {
            toValue: BREATHE_SCALE_MAX,
            duration: BREATHE_DURATION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breatheScale, {
            toValue: BREATHE_SCALE_MIN,
            duration: BREATHE_DURATION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(breatheOpacity, {
            toValue: BREATHE_OPACITY_MAX,
            duration: BREATHE_DURATION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breatheOpacity, {
            toValue: BREATHE_OPACITY_MIN,
            duration: BREATHE_DURATION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    breatheLoopRef.current = loop;
    loop.start();
  }, [breatheScale, breatheOpacity]);

  // ── Start / stop ring ─────────────────────────────────────────────────────
  const startRing = useCallback(() => {
    ringProgress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(ringProgress, {
        toValue: 1,
        duration: DOT_CYCLE_TOTAL,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    ringLoopRef.current = loop;
    loop.start();
  }, [ringProgress]);

  // ── Start message rotation ────────────────────────────────────────────────
  const startMessages = useCallback(() => {
    const rotate = () => {
      if (!mountedRef.current) return;
      // Fade out
      Animated.timing(msgOpacity, {
        toValue: 0,
        duration: MESSAGE_FADE_OUT,
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        setMsgIndex(i => (i + 1) % msgList.length);
        // Fade in
        Animated.timing(msgOpacity, {
          toValue: 1,
          duration: MESSAGE_FADE_IN,
          useNativeDriver: true,
        }).start();
      });
    };

    // Kick off the interval; first swap happens after MESSAGE_INTERVAL ms.
    msgTimerRef.current = setInterval(rotate, MESSAGE_INTERVAL);
  }, [msgOpacity, msgList.length]);

  // ── Effect: mount / unmount ────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    if (!reduceMotion) {
      startBreathe();
      startRing();
    }
    startMessages();

    return () => {
      mountedRef.current = false;
      breatheLoopRef.current?.stop();
      ringLoopRef.current?.stop();
      if (msgTimerRef.current) clearInterval(msgTimerRef.current);
    };
  }, [reduceMotion, startBreathe, startRing, startMessages]);

  // ── Per-dot opacity (derived from ringProgress) ────────────────────────────
  // Each dot has a "peak" when ringProgress passes through i/DOT_COUNT.
  // We use interpolation with a narrow active window so only ~1 dot is bright
  // at a time, giving a clean sequential chase effect.
  const dotAnims = Array.from({ length: DOT_COUNT }, (_, i) => {
    if (reduceMotion) {
      // Static medium opacity — no motion, still visually present.
      return { opacity: 0.45 };
    }
    // The active phase is [i/N – 0.5/N, i/N + 0.5/N], wrapped.
    // We model this with a triangular pulse centered on i/N.
    const peak  = i / DOT_COUNT;
    const width = 1 / DOT_COUNT;  // full width of one dot's window

    // Build interpolation input range that wraps 0→1 smoothly.
    // Triangle: zero at ±width/2 away, full at peak.
    const inputRange  = [
      Math.max(0, peak - width),
      peak,
      Math.min(1, peak + width),
    ];
    const outputRange = [DOT_OFF_OPACITY, DOT_ON_OPACITY, DOT_OFF_OPACITY];

    return {
      opacity: ringProgress.interpolate({ inputRange, outputRange }),
    };
  });

  // ── Layout ────────────────────────────────────────────────────────────────
  // The ring "canvas" is a square whose side is 2*(RING_RADIUS + DOT_SIZE/2)
  // so dots don't clip. The image is absolutely centered inside it.
  const canvasSize = (RING_RADIUS + DOT_SIZE) * 2;

  return (
    <View style={[styles.container, style]}>
      {/* ── Ring + image composition ── */}
      <View style={[styles.canvas, { width: canvasSize, height: canvasSize }]}>
        {/* Dots around the ring */}
        {Array.from({ length: DOT_COUNT }, (_, i) => {
          const angleDeg = i * (360 / DOT_COUNT);
          return (
            <Animated.View
              key={i}
              style={[
                styles.dotWrapper,
                {
                  width: canvasSize,
                  height: canvasSize,
                  transform: [{ rotate: `${angleDeg}deg` }],
                },
                dotAnims[i],
              ]}
            >
              <View
                style={[
                  styles.dot,
                  {
                    width: DOT_SIZE,
                    height: DOT_SIZE,
                    borderRadius: DOT_SIZE / 2,
                    backgroundColor: colors.gold,
                    // Place the dot at the top of the translated axis.
                    marginTop: (canvasSize / 2) - RING_RADIUS - (DOT_SIZE / 2),
                    alignSelf: 'center',
                  },
                ]}
              />
            </Animated.View>
          );
        })}

        {/* Iris breathing image — centered absolutely */}
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
    gap: 32,
  },
  // The canvas holds both the dot ring and the image; everything is laid out
  // absolutely within it so the dots can rotate around a common centre.
  canvas: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Each dotWrapper is a full-canvas square, absolutely positioned at (0,0),
  // rotated around the canvas centre. The dot sits at the "top" of the
  // wrapper, which after rotation lands on the ring circumference.
  dotWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  irisImage: {
    position: 'absolute',
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    letterSpacing: 0.2,
    paddingHorizontal: 32,
  },
});
