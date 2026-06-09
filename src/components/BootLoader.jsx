/**
 * BootLoader — full-screen cold-boot loading experience.
 *
 * Lifecycle:
 *  1. On mount: hide native splash, start breathing loop + bar fill.
 *  2. Outro fires when bars are done AND ready===true (whichever is slower).
 *  3. Outro: bling → zoom into Iris's face → fade → onFinish().
 *
 * All tunable numbers are named consts at the top of this file.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Image,
  Animated,
  Easing,
  StyleSheet,
  AccessibilityInfo,
  Dimensions,
} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';
import AppBackground from './AppBackground';
import { useTheme } from '../theme';

// ─── Tunable constants ──────────────────────────────────────────────────────

/** Asset path — one-line swap when iris-figure.png lands */
const IRIS_ASSET = require('../../assets/brand/iris-figure.png');

/** Source image dimensions (1024 × 710) */
const IMG_NATIVE_W = 1024;
const IMG_NATIVE_H = 710;

/**
 * Fractional position of Iris's face within the image.
 * x=0.50 (horizontal center), y=0.36 (36% from top).
 */
const FACE_X = 0.50;
const FACE_Y = 0.30;

// Breathing animation
const BREATHE_SCALE_MIN = 1.0;
const BREATHE_SCALE_MAX = 1.035;
const BREATHE_OPACITY_MIN = 0.92;
const BREATHE_OPACITY_MAX = 1.0;
const BREATHE_DURATION_MS = 3400;

// Loading bars
const BAR_COUNT = 6;
const BAR_FILL_DURATION_MS = 140; // per bar
const BAR_HEIGHT = 3;
const BAR_BORDER_RADIUS = 2;
const BAR_GAP = 6;
const BAR_WIDTH = 36;

// Minimum time the loader is visible (so fast hydrate still feels intentional)
const MIN_SHOW_MS = 1400;

// Outro
const BLING_DURATION_MS = 220;
const ZOOM_SCALE = 2.2;
const ZOOM_DURATION_MS = 650;
const FADE_DURATION_MS = 650;

// ─── Component ──────────────────────────────────────────────────────────────

export default function BootLoader({ ready, onFinish }) {
  const { colors } = useTheme();
  const { width: screenW, height: screenH } = Dimensions.get('window');

  // The image is rendered at a fixed width matching the screen width, so we
  // derive the rendered height from the native aspect ratio.
  const imgRenderedW = screenW * 0.75; // 75% of screen width looks balanced
  const imgRenderedH = imgRenderedW * (IMG_NATIVE_H / IMG_NATIVE_W);

  // ── Animated values ──────────────────────────────────────────────────────

  const breatheScale = useRef(new Animated.Value(1)).current;
  const breatheOpacity = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(null);

  // One Animated.Value per bar (0 = empty, 1 = filled)
  const barValues = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0))
  ).current;

  // Bling: a quick opacity flash over the bars
  const blingOpacity = useRef(new Animated.Value(0)).current;

  // Outro: the whole screen container
  const outroScale = useRef(new Animated.Value(1)).current;
  const outroTranslateY = useRef(new Animated.Value(0)).current;
  const outroOpacity = useRef(new Animated.Value(1)).current;

  // ── State flags ──────────────────────────────────────────────────────────

  const [barsDone, setBarsDone] = useState(false);
  const [minTimeDone, setMinTimeDone] = useState(false);
  const outroFired = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Reduce motion detection ──────────────────────────────────────────────

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotion(!!enabled);
    });
  }, []);

  // ── Hide native splash on first frame ────────────────────────────────────

  useEffect(() => {
    // Use requestAnimationFrame so the component is actually painted before
    // we drop the native splash — prevents a flash to a blank JS view.
    const raf = requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Start bar animations + min-timer on mount (run once) ────────────────

  const barsStarted = useRef(false);

  useEffect(() => {
    if (barsStarted.current) return;
    barsStarted.current = true;

    // ── Bar fill stagger ─────────────────────────────────────────────────
    Animated.stagger(
      BAR_FILL_DURATION_MS,
      barValues.map((val) =>
        Animated.timing(val, {
          toValue: 1,
          duration: BAR_FILL_DURATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false, // width animation needs false
        })
      )
    ).start(() => {
      setBarsDone(true);
    });

    // ── Minimum display time ─────────────────────────────────────────────
    const minTimer = setTimeout(() => setMinTimeDone(true), MIN_SHOW_MS);
    return () => clearTimeout(minTimer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally mount-only

  // ── Breathing loop — restarts only when reduceMotion changes ─────────────

  useEffect(() => {
    if (reduceMotion) {
      breatheAnim.current?.stop();
      return;
    }

    breatheAnim.current = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(breatheScale, {
            toValue: BREATHE_SCALE_MAX,
            duration: BREATHE_DURATION_MS / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breatheOpacity, {
            toValue: BREATHE_OPACITY_MAX,
            duration: BREATHE_DURATION_MS / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(breatheScale, {
            toValue: BREATHE_SCALE_MIN,
            duration: BREATHE_DURATION_MS / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breatheOpacity, {
            toValue: BREATHE_OPACITY_MIN,
            duration: BREATHE_DURATION_MS / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    breatheAnim.current.start();

    return () => {
      breatheAnim.current?.stop();
    };
  }, [reduceMotion]);

  // ── Outro: fires when ready + bars done + min time ───────────────────────

  const fireOutro = useCallback(() => {
    if (outroFired.current) return;
    outroFired.current = true;

    // Stop the breathing loop before the outro sequence
    breatheAnim.current?.stop();

    if (reduceMotion) {
      // No motion — just call finish directly
      onFinish();
      return;
    }

    // 1. Haptic bling
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    // 2. Bling flash on bar area (quick white-ish gold flash)
    Animated.sequence([
      Animated.timing(blingOpacity, {
        toValue: 1,
        duration: BLING_DURATION_MS / 2,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(blingOpacity, {
        toValue: 0,
        duration: BLING_DURATION_MS / 2,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    // 3. After a short bling pause, zoom into Iris's face + fade out
    setTimeout(() => {
      // We want to zoom so the face point stays centered on screen.
      //
      // The image is centered horizontally on screen. The face is at
      // (FACE_X, FACE_Y) within the image box.
      //
      // After scaling the container by ZOOM_SCALE:
      //   - The container anchors at its center (default transform origin).
      //   - The face is at offset from center: dy = (FACE_Y - 0.5) * imgRenderedH
      //   - After scale, to bring face to screen center we need to cancel
      //     the face's offset by translating:
      //       translateY = -(FACE_Y - 0.5) * imgRenderedH * ZOOM_SCALE
      //     (negative = move up when face is above center)
      //
      // This keeps the face roughly centered during the zoom-in fade.
      const faceOffsetY = (FACE_Y - 0.5) * imgRenderedH;
      const targetTranslateY = -faceOffsetY * ZOOM_SCALE;

      Animated.parallel([
        Animated.timing(outroScale, {
          toValue: ZOOM_SCALE,
          duration: ZOOM_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(outroTranslateY, {
          toValue: targetTranslateY,
          duration: ZOOM_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(outroOpacity, {
          toValue: 0,
          duration: FADE_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        onFinish();
      });
    }, BLING_DURATION_MS + 80);
  }, [reduceMotion, onFinish, imgRenderedH]);

  useEffect(() => {
    if (ready && barsDone && minTimeDone) {
      fireOutro();
    }
  }, [ready, barsDone, minTimeDone, fireOutro]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity: outroOpacity,
          transform: [
            { scale: outroScale },
            { translateY: outroTranslateY },
          ],
        },
      ]}
    >
      {/* Gradient background — same component the rest of the app uses */}
      <AppBackground />

      {/* Iris mark — breathing */}
      <View style={styles.center} pointerEvents="none">
        <Animated.View
          style={{
            transform: [{ scale: breatheScale }],
            opacity: breatheOpacity,
          }}
        >
          <Image
            source={IRIS_ASSET}
            style={{
              width: imgRenderedW,
              height: imgRenderedH,
            }}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Loading bars + bling overlay — wrapped in a relative container */}
        <View style={{ marginTop: 28 }}>
          <View style={styles.barsRow}>
            {barValues.map((val, i) => (
              <View
                key={i}
                style={[
                  styles.barTrack,
                  {
                    backgroundColor: colors.goldSoft,
                    borderColor: colors.line,
                    width: BAR_WIDTH,
                    height: BAR_HEIGHT,
                    borderRadius: BAR_BORDER_RADIUS,
                    marginHorizontal: BAR_GAP / 2,
                    overflow: 'hidden',
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.barFill,
                    {
                      backgroundColor: colors.gold,
                      borderRadius: BAR_BORDER_RADIUS,
                      height: BAR_HEIGHT,
                      // Animate width from 0 to BAR_WIDTH
                      width: val.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, BAR_WIDTH],
                      }),
                    },
                  ]}
                />
              </View>
            ))}
          </View>

          {/* Bling overlay — absolute over the bar row */}
          <Animated.View
            pointerEvents="none"
            style={{
              ...StyleSheet.absoluteFillObject,
              opacity: blingOpacity,
              backgroundColor: colors.gold,
              borderRadius: BAR_BORDER_RADIUS + 2,
            }}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTrack: {
    overflow: 'hidden',
  },
  barFill: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
