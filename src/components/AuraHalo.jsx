import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View, Text } from 'react-native';
import Svg, {
  Circle,
  Line,
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';

/**
 * AuraHalo — premium-exclusive iridescent halo, visually a tier above gold Halos.
 *
 * Props:
 *   aura     — an AURAS entry { id, name, condition, description, palette, unlock }
 *   earned   — bool
 *   size     — default 64
 *   onPress  — optional
 *
 * EARNED:
 *   - Hue-cycling: two layered SVG gradient rings cross-fade (opacity Animated
 *     loops) — palette forward then reversed — giving an oil-slick colour shift
 *     on native driver.
 *   - Aurora glow: two translucent coloured Animated.Views pulse independently
 *     behind the ring, producing a soft multi-hued aurora.
 *   - Ray rotation: a dense ring of rays (24) slowly rotates using transform.
 *   - Breathing scale: the whole assembly gently inhales/exhales.
 *   - Sparkle particles: 8 small dots orbit and twinkle — more numerous, more
 *     saturated, and faster than the gold Mythic sparkle.
 *
 * LOCKED (free user or not-yet-earned premium):
 *   - Dark silhouette ring with a faint iridescent edge shimmer.
 *   - A small 'PREMIUM' lock badge in the lower-right.
 *   - The locked state is NOT just greyed out — it teases the palette as a
 *     very soft hint so the user can imagine what earned looks like.
 *
 * Animation safety:
 *   - All animations use useNativeDriver: true (transform + opacity only).
 *   - mountedRef prevents set-state after unmount.
 *   - All loop refs are stopped on unmount and when earned/reduceMotion changes.
 *   - Reduce Motion → fully static.
 *   - Unique gradient ids via React.useId() to avoid cross-instance bleed.
 */

// ── Tunable animation constants ───────────────────────────────────────────────
const ANIM = {
  // Hue-shift: cross-fade between two gradient layers (ms per half-cycle)
  HUE_SHIFT_DUR: 3800,

  // Aurora glow pulse — two independent colours
  AURORA_A_DUR: 3200,
  AURORA_B_DUR: 4600,
  AURORA_OPACITY_MIN: 0.0,
  AURORA_OPACITY_MAX: 0.38,

  // Ray rotation (ms per full revolution)
  ROT_DUR: 14000,

  // Breathing scale
  BREATHE_MIN: 1.0,
  BREATHE_MAX: 1.045,
  BREATHE_DUR: 2800,

  // Sparkles
  SPARKLE_COUNT: 8,
  SPARKLE_DUR: 750,
  SPARKLE_STAGGER: 95,
};

// Number of rays on the iridescent ring (denser than gold halos)
const RAY_COUNT = 24;

export default function AuraHalo({ aura, earned, size = 64, onPress }) {
  const { colors, fonts } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Animated values ────────────────────────────────────────────────────────
  // Cross-fade: gradA at 1 → gradB at 1 (hue-shift illusion)
  const gradAOpacity = useRef(new Animated.Value(1)).current;
  const gradBOpacity = useRef(new Animated.Value(0)).current;

  // Aurora glow layers — two independent pulses
  const auroraA = useRef(new Animated.Value(0)).current;
  const auroraB = useRef(new Animated.Value(0)).current;

  // Rotation of ray ring
  const rotAnim = useRef(new Animated.Value(0)).current;

  // Breathing scale
  const breatheAnim = useRef(new Animated.Value(1)).current;

  // Sparkle opacity values
  const sparkleAnims = useRef(
    Array.from({ length: ANIM.SPARKLE_COUNT }, () => new Animated.Value(0))
  ).current;

  // All running loop refs — stopped on cleanup
  const loopRefs = useRef([]);

  // ── Reduce Motion detection ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (cancelled) return;
      if (mountedRef.current) setReduceMotion(on);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Animation setup ────────────────────────────────────────────────────────
  useEffect(() => {
    loopRefs.current.forEach((l) => l.stop());
    loopRefs.current = [];

    if (!earned || reduceMotion) return;

    const loops = [];

    // ── Hue-shift: gradA fades out while gradB fades in, then back ───────────
    gradAOpacity.setValue(1);
    gradBOpacity.setValue(0);
    const hueLoop = Animated.loop(
      Animated.sequence([
        // A fades out / B fades in
        Animated.parallel([
          Animated.timing(gradAOpacity, {
            toValue: 0,
            duration: ANIM.HUE_SHIFT_DUR,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
          Animated.timing(gradBOpacity, {
            toValue: 1,
            duration: ANIM.HUE_SHIFT_DUR,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
        ]),
        // B fades out / A fades in
        Animated.parallel([
          Animated.timing(gradAOpacity, {
            toValue: 1,
            duration: ANIM.HUE_SHIFT_DUR,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
          Animated.timing(gradBOpacity, {
            toValue: 0,
            duration: ANIM.HUE_SHIFT_DUR,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    hueLoop.start();
    loops.push(hueLoop);

    // ── Aurora A pulse ────────────────────────────────────────────────────────
    auroraA.setValue(0);
    const auroraALoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auroraA, {
          toValue: ANIM.AURORA_OPACITY_MAX,
          duration: ANIM.AURORA_A_DUR,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
        Animated.timing(auroraA, {
          toValue: ANIM.AURORA_OPACITY_MIN,
          duration: ANIM.AURORA_A_DUR,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
      ])
    );
    auroraALoop.start();
    loops.push(auroraALoop);

    // ── Aurora B pulse (offset phase, different colour stop) ─────────────────
    auroraB.setValue(ANIM.AURORA_OPACITY_MAX * 0.5);
    const auroraBLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auroraB, {
          toValue: ANIM.AURORA_OPACITY_MIN,
          duration: ANIM.AURORA_B_DUR,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
        Animated.timing(auroraB, {
          toValue: ANIM.AURORA_OPACITY_MAX,
          duration: ANIM.AURORA_B_DUR,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
      ])
    );
    auroraBLoop.start();
    loops.push(auroraBLoop);

    // ── Ray rotation ──────────────────────────────────────────────────────────
    rotAnim.setValue(0);
    const rotLoop = Animated.loop(
      Animated.timing(rotAnim, {
        toValue: 1,
        duration: ANIM.ROT_DUR,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    rotLoop.start();
    loops.push(rotLoop);

    // ── Breathing scale ───────────────────────────────────────────────────────
    breatheAnim.setValue(ANIM.BREATHE_MIN);
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: ANIM.BREATHE_MAX,
          duration: ANIM.BREATHE_DUR,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: ANIM.BREATHE_MIN,
          duration: ANIM.BREATHE_DUR,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
      ])
    );
    breatheLoop.start();
    loops.push(breatheLoop);

    // ── Sparkle twinkles ──────────────────────────────────────────────────────
    sparkleAnims.forEach((anim, i) => {
      anim.setValue(0);
      const sparkleLoop = Animated.loop(
        Animated.sequence([
          Animated.delay(i * ANIM.SPARKLE_STAGGER),
          Animated.timing(anim, {
            toValue: 1,
            duration: ANIM.SPARKLE_DUR,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: ANIM.SPARKLE_DUR,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      sparkleLoop.start();
      loops.push(sparkleLoop);
    });

    loopRefs.current = loops;
    return () => {
      loops.forEach((l) => l.stop());
    };
  }, [earned, reduceMotion]);

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loopRefs.current.forEach((l) => l.stop());
    };
  }, []);

  // ── Geometry ───────────────────────────────────────────────────────────────
  const cx = size / 2;
  const cy = size / 2;

  const ringR = size * 0.32;
  const ringStrokeWidth = Math.max(1.8, size * 0.038); // thicker than gold halos

  const glowR = size * 0.48;
  const rayLen = size * 0.19;
  const rayInnerR = ringR + ringStrokeWidth * 0.5;
  const rayOuterR = rayInnerR + rayLen;
  const rayStrokeWidth = Math.max(0.9, size * 0.022);

  const sparkleR = rayOuterR + size * 0.05;
  const sparkleSize = Math.max(2.5, size * 0.055);

  // Pre-compute ray endpoints
  const rayLines = Array.from({ length: RAY_COUNT }, (_, i) => {
    const angle = (2 * Math.PI * i) / RAY_COUNT - Math.PI / 2;
    return {
      x1: cx + Math.cos(angle) * rayInnerR,
      y1: cy + Math.sin(angle) * rayInnerR,
      x2: cx + Math.cos(angle) * rayOuterR,
      y2: cy + Math.sin(angle) * rayOuterR,
    };
  });

  // Sparkle dot orbit positions
  const sparkleDots = Array.from({ length: ANIM.SPARKLE_COUNT }, (_, i) => {
    const angle = (2 * Math.PI * i) / ANIM.SPARKLE_COUNT - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * sparkleR,
      y: cy + Math.sin(angle) * sparkleR,
      // Color cycles through palette
      color: aura.palette[i % aura.palette.length],
    };
  });

  // ── Gradient IDs — unique per instance ────────────────────────────────────
  const uid = React.useId().replace(/:/g, '');
  const gradAId = `aura-grad-a-${aura.id}-${uid}`;
  const gradBId = `aura-grad-b-${aura.id}-${uid}`;
  const lockedGradId = `aura-locked-${aura.id}-${uid}`;
  const auroraAGradId = `aurora-a-${aura.id}-${uid}`;
  const auroraBGradId = `aurora-b-${aura.id}-${uid}`;

  // Palette for hue-shift: gradA = palette forward, gradB = palette reversed
  const pal = aura.palette;
  const palRev = [...pal].reverse();

  // ── Accessibility label ────────────────────────────────────────────────────
  const label = earned
    ? `${aura.name}, earned — ${aura.description}`
    : `${aura.name}, locked — ${aura.condition}`;

  // ── Rotation interpolation ─────────────────────────────────────────────────
  const rotateInterpolated = rotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── LOCKED render ─────────────────────────────────────────────────────────
  if (!earned) {
    // Dark silhouette with a faint iridescent edge + PREMIUM badge
    const lockedContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} opacity={0.72}>
          <Defs>
            {/* Faint iridescent ring — just enough to tease */}
            <SvgLinearGradient id={lockedGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              {pal.map((color, i) => (
                <Stop
                  key={i}
                  offset={`${Math.round((i / (pal.length - 1)) * 100)}%`}
                  stopColor={color}
                  stopOpacity="0.25"
                />
              ))}
            </SvgLinearGradient>
          </Defs>

          {/* Ghost glow — very faint iridescent bloom */}
          <Circle
            cx={cx}
            cy={cy}
            r={glowR}
            fill={pal[0]}
            fillOpacity={0.04}
          />

          {/* Ghost rays — 2 opposite ones only, barely visible */}
          {[0, Math.floor(RAY_COUNT / 2)].map((idx) => {
            const r = rayLines[idx];
            return (
              <Line
                key={idx}
                x1={r.x1}
                y1={r.y1}
                x2={r.x2}
                y2={r.y2}
                stroke={pal[1]}
                strokeWidth={rayStrokeWidth}
                strokeOpacity={0.12}
                strokeLinecap="round"
              />
            );
          })}

          {/* Dark silhouette ring with iridescent edge */}
          <Circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={`url(#${lockedGradId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={0.6}
          />

          {/* Dark fill circle — makes it feel like a silhouette */}
          <Circle
            cx={cx}
            cy={cy}
            r={ringR - ringStrokeWidth * 0.5}
            fill={colors.bg}
            fillOpacity={0.85}
          />
        </Svg>

        {/* PREMIUM lock badge — lower-right corner */}
        <View
          style={{
            position: 'absolute',
            bottom: size * 0.04,
            right: size * 0.04,
            backgroundColor: 'rgba(30,22,14,0.92)',
            borderRadius: 4,
            paddingHorizontal: Math.max(3, size * 0.06),
            paddingVertical: Math.max(1, size * 0.025),
            borderWidth: 0.8,
            borderColor: pal[2] + '60',
          }}
        >
          <Text
            style={{
              color: pal[2],
              fontSize: Math.max(5, size * 0.1),
              fontWeight: '700',
              letterSpacing: 0.6,
            }}
            allowFontScaling={false}
          >
            PREMIUM
          </Text>
        </View>
      </View>
    );

    if (onPress) {
      return (
        <Pressable
          onPress={onPress}
          hitSlop={6}
          accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}
        >
          {lockedContent}
        </Pressable>
      );
    }
    return lockedContent;
  }

  // ── EARNED + Reduce Motion → static ───────────────────────────────────────
  if (reduceMotion) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgLinearGradient id={gradAId} x1="0%" y1="0%" x2="100%" y2="100%">
              {pal.map((color, i) => (
                <Stop
                  key={i}
                  offset={`${Math.round((i / (pal.length - 1)) * 100)}%`}
                  stopColor={color}
                  stopOpacity="1"
                />
              ))}
            </SvgLinearGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={glowR} fill={pal[0]} fillOpacity={0.18} />
          {rayLines.map((r, i) => (
            <Line
              key={i}
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke={pal[i % pal.length]}
              strokeWidth={rayStrokeWidth}
              strokeOpacity={0.65}
              strokeLinecap="round"
            />
          ))}
          <Circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={`url(#${gradAId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={1}
          />
        </Svg>
      </View>
    );

    if (onPress) {
      return (
        <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          {staticContent}
        </Pressable>
      );
    }
    return staticContent;
  }

  // ── EARNED + ANIMATED ─────────────────────────────────────────────────────
  // Layer stack (bottom → top):
  //   1. Aurora glow A (Animated.View — opacity pulse, radialGrad colour 1)
  //   2. Aurora glow B (Animated.View — opacity pulse, radialGrad colour 2)
  //   3. Rays (Animated.View — slow rotation)
  //   4. Gradient ring — layer A (Animated.View — cross-fade opacity)
  //   5. Gradient ring — layer B (Animated.View — cross-fade opacity, reversed palette)
  //   6. Breathing wrapper (Animated.View — scale)
  //   7. Sparkle dots (Animated.View per dot — twinkle)

  const animated = (
    <Animated.View
      style={{
        width: size,
        height: size,
        transform: [{ scale: breatheAnim }],
      }}
      accessibilityLabel={label}
    >
      {/* ── Layer 1: Aurora glow A ──────────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: auroraA }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgRadialGradient id={auroraAGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0%" stopColor={pal[0]} stopOpacity="1" />
              <Stop offset="60%" stopColor={pal[1]} stopOpacity="0.5" />
              <Stop offset="100%" stopColor={pal[2]} stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={glowR} fill={`url(#${auroraAGradId})`} />
        </Svg>
      </Animated.View>

      {/* ── Layer 2: Aurora glow B ──────────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: auroraB }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgRadialGradient id={auroraBGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0%" stopColor={pal[3] || pal[2]} stopOpacity="1" />
              <Stop offset="60%" stopColor={pal[2]} stopOpacity="0.4" />
              <Stop offset="100%" stopColor={pal[1]} stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={glowR} fill={`url(#${auroraBGradId})`} />
        </Svg>
      </Animated.View>

      {/* ── Layer 3: Rays (rotating) ────────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          transform: [{ rotate: rotateInterpolated }],
        }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {rayLines.map((r, i) => (
            <Line
              key={i}
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke={pal[i % pal.length]}
              strokeWidth={rayStrokeWidth}
              strokeOpacity={0.55}
              strokeLinecap="round"
            />
          ))}
        </Svg>
      </Animated.View>

      {/* ── Layers 4 + 5: Cross-fading iridescent ring ─────────────────────── */}
      {/* Layer 4 — gradient A (forward palette) */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: gradAOpacity }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgLinearGradient id={gradAId} x1="0%" y1="0%" x2="100%" y2="100%">
              {pal.map((color, i) => (
                <Stop
                  key={i}
                  offset={`${Math.round((i / (pal.length - 1)) * 100)}%`}
                  stopColor={color}
                  stopOpacity="1"
                />
              ))}
            </SvgLinearGradient>
          </Defs>
          <Circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={`url(#${gradAId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={1}
          />
        </Svg>
      </Animated.View>

      {/* Layer 5 — gradient B (reversed palette = different hue phase) */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: gradBOpacity }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgLinearGradient id={gradBId} x1="0%" y1="0%" x2="100%" y2="100%">
              {palRev.map((color, i) => (
                <Stop
                  key={i}
                  offset={`${Math.round((i / (palRev.length - 1)) * 100)}%`}
                  stopColor={color}
                  stopOpacity="1"
                />
              ))}
            </SvgLinearGradient>
          </Defs>
          <Circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={`url(#${gradBId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={1}
          />
        </Svg>
      </Animated.View>

      {/* ── Layer 7: Sparkle dots ───────────────────────────────────────────── */}
      {sparkleDots.map((dot, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: sparkleSize,
            height: sparkleSize,
            borderRadius: sparkleSize,
            backgroundColor: dot.color,
            left: dot.x - sparkleSize / 2,
            top: dot.y - sparkleSize / 2,
            opacity: sparkleAnims[i],
          }}
        />
      ))}
    </Animated.View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        {animated}
      </Pressable>
    );
  }
  return animated;
}
