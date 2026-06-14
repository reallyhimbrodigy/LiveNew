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
 * AuraHalo — premium-exclusive iridescent halo, visually a tier above gem Halos.
 *
 * Props (UNCHANGED):
 *   aura     — an AURAS entry { id, name, condition, description, palette, unlock }
 *   earned   — bool
 *   size     — default 64
 *   onPress  — optional
 *
 * EARNED — depth + luminosity upgrades:
 *   - Atmospheric bloom: 3 concentric radial-gradient circles pulse behind the
 *     ring for an oil-slick halo-of-light effect.
 *   - Hue-cycling ring: two layered SVG gradient rings cross-fade (opacity
 *     Animated loops) — palette forward then reversed — giving an oil-slick
 *     colour shift on native driver. Ring is now WIDER with an inner bright
 *     ring + outer soft glow for a dimensional tube look.
 *   - Aurora glow: two translucent coloured Animated.Views pulse independently.
 *   - Ray rotation: 24 rays with alternating long/short lengths for visual
 *     complexity. Rays use palette colors cycling per ray.
 *   - Breathing scale: the whole assembly gently inhales/exhales.
 *   - Sparkle particles: 8 small dots at jittered orbit positions; colors
 *     cycle through palette. Slightly faster twinkle than gem halos.
 *   - Specular shine arc: a static bright arc on the top-left of the ring
 *     simulating a premium light source.
 *
 * LOCKED (free user or not-yet-earned premium):
 *   - Dark silhouette ring with a rich iridescent edge shimmer (more color than
 *     before — the locked state should make you WANT to earn it).
 *   - 4 ghost rays instead of 2.
 *   - A small 'PREMIUM' lock badge in the lower-right.
 *
 * Animation safety:
 *   - All animations use useNativeDriver: true (transform + opacity only).
 *   - mountedRef prevents set-state after unmount.
 *   - All loop refs are stopped on unmount and when earned/reduceMotion changes.
 *   - Reduce Motion → fully static but still the full premium visual.
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

// Ray counts — 24 primary + 12 shorter alternates = visual richness
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

  // Ring — wider stroke than gem halos for premium AuraHalo feel
  const ringR          = size * 0.30;
  const ringStrokeWidth = Math.max(2.2, size * 0.054);
  const innerRingStroke = Math.max(0.9, size * 0.018);

  // Atmospheric bloom radii
  const bloomR1 = size * 0.30;
  const bloomR2 = size * 0.40;
  const bloomR3 = size * 0.52;

  // Ray geometry — alternating long/short for every other ray
  const baseRayLen  = size * 0.195;
  const shortRayLen = baseRayLen * 0.58;
  const rayInnerR   = ringR + ringStrokeWidth * 0.5;

  // Outer radius used for sparkle orbit
  const rayOuterR    = rayInnerR + baseRayLen;
  const rayStrokeWidth = Math.max(0.9, size * 0.022);

  const sparkleOrbitR = rayOuterR + size * 0.05;
  const sparkleSize   = Math.max(2.5, size * 0.055);

  // Pre-compute ray endpoints — alternate long/short
  const rayLines = Array.from({ length: RAY_COUNT }, (_, i) => {
    const angle  = (2 * Math.PI * i) / RAY_COUNT - Math.PI / 2;
    const isAlt  = i % 2 === 1;
    const rayLen = isAlt ? shortRayLen : baseRayLen;
    return {
      x1: cx + Math.cos(angle) * rayInnerR,
      y1: cy + Math.sin(angle) * rayInnerR,
      x2: cx + Math.cos(angle) * (rayInnerR + rayLen),
      y2: cy + Math.sin(angle) * (rayInnerR + rayLen),
      isAlt,
      color: aura.palette[i % aura.palette.length],
    };
  });

  // Sparkle dot orbit positions — jittered angles for organic feel
  const sparkleDots = Array.from({ length: ANIM.SPARKLE_COUNT }, (_, i) => {
    const baseAngle = (2 * Math.PI * i) / ANIM.SPARKLE_COUNT - Math.PI / 2;
    const jitter    = (i % 3 === 0 ? 0.10 : i % 3 === 1 ? -0.06 : 0.14);
    const angle     = baseAngle + jitter;
    return {
      x: cx + Math.cos(angle) * sparkleOrbitR,
      y: cy + Math.sin(angle) * sparkleOrbitR,
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
  // Rich locked state — NOT just greyed out. Dark silhouette with a more
  // visible iridescent edge, 4 ghost rays, faint bloom — making it feel like
  // something beautiful just out of reach. PREMIUM badge teases.
  if (!earned) {
    const lockedContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            {/* Iridescent ring stroke — richer tease than before */}
            <SvgLinearGradient id={lockedGradId} x1="0%" y1="0%" x2="100%" y2="100%">
              {pal.map((color, i) => (
                <Stop
                  key={i}
                  offset={`${Math.round((i / (pal.length - 1)) * 100)}%`}
                  stopColor={color}
                  stopOpacity="0.40"
                />
              ))}
            </SvgLinearGradient>
          </Defs>

          {/* Faint iridescent bloom — bigger bloom hint */}
          <Circle cx={cx} cy={cy} r={bloomR3} fill={pal[0]} fillOpacity={0.06} />
          <Circle cx={cx} cy={cy} r={bloomR2} fill={pal[1]} fillOpacity={0.04} />

          {/* Ghost rays — 4 at cardinal angles, enticing */}
          {[0, Math.floor(RAY_COUNT / 4), Math.floor(RAY_COUNT / 2), Math.floor(RAY_COUNT * 3 / 4)].map((idx) => {
            const r = rayLines[idx];
            return (
              <Line
                key={idx}
                x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
                stroke={pal[idx % pal.length]}
                strokeWidth={rayStrokeWidth}
                strokeOpacity={0.16}
                strokeLinecap="round"
              />
            );
          })}

          {/* Dark silhouette fill inside the ring */}
          <Circle
            cx={cx} cy={cy} r={ringR - ringStrokeWidth * 0.35}
            fill={colors.bg ?? '#18140e'}
            fillOpacity={0.90}
          />

          {/* Iridescent ring edge — richer than before */}
          <Circle
            cx={cx} cy={cy} r={ringR}
            fill="none"
            stroke={`url(#${lockedGradId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={0.70}
          />

          {/* Outer soft halo glow on the ring */}
          <Circle
            cx={cx} cy={cy} r={ringR + ringStrokeWidth * 0.65}
            fill="none"
            stroke={pal[0]}
            strokeWidth={ringStrokeWidth * 1.2}
            strokeOpacity={0.08}
          />
        </Svg>

        {/* PREMIUM lock badge — lower-right corner */}
        <View
          style={{
            position: 'absolute',
            bottom: size * 0.04,
            right: size * 0.04,
            backgroundColor: 'rgba(18,14,26,0.94)',
            borderRadius: 4,
            paddingHorizontal: Math.max(3, size * 0.06),
            paddingVertical: Math.max(1, size * 0.025),
            borderWidth: 0.8,
            borderColor: pal[2] + '70',
          }}
        >
          <Text
            style={{
              color: pal[2],
              fontSize: Math.max(5, size * 0.10),
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

  // ── EARNED + Reduce Motion → static but full premium visual ──────────────
  if (reduceMotion) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
             accessibilityLabel={label}>
          <Defs>
            {/* Forward palette ring */}
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
            {/* Aurora bloom */}
            <SvgRadialGradient id={auroraAGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0%"   stopColor={pal[0]} stopOpacity="0.22" />
              <Stop offset="50%"  stopColor={pal[1]} stopOpacity="0.10" />
              <Stop offset="100%" stopColor={pal[2]} stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>

          {/* Atmospheric bloom — 3 layers */}
          <Circle cx={cx} cy={cy} r={bloomR3} fill={pal[0]} fillOpacity={0.06} />
          <Circle cx={cx} cy={cy} r={bloomR2} fill={pal[1]} fillOpacity={0.10} />
          <Circle cx={cx} cy={cy} r={bloomR1} fill={`url(#${auroraAGradId})`} />

          {/* Rays — alternating length and palette colors */}
          {rayLines.map((r, i) => (
            <Line
              key={i}
              x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
              stroke={r.color}
              strokeWidth={r.isAlt ? rayStrokeWidth * 0.75 : rayStrokeWidth}
              strokeOpacity={r.isAlt ? 0.45 : 0.70}
              strokeLinecap="round"
            />
          ))}

          {/* Outer soft glow ring */}
          <Circle
            cx={cx} cy={cy} r={ringR + ringStrokeWidth * 0.7}
            fill="none"
            stroke={pal[0]}
            strokeWidth={ringStrokeWidth * 1.5}
            strokeOpacity={0.20}
          />

          {/* Main iridescent ring */}
          <Circle
            cx={cx} cy={cy} r={ringR}
            fill="none"
            stroke={`url(#${gradAId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={1}
          />

          {/* Inner bright ring */}
          <Circle
            cx={cx} cy={cy} r={ringR - ringStrokeWidth * 0.18}
            fill="none"
            stroke="#ffffff"
            strokeWidth={innerRingStroke}
            strokeOpacity={0.45}
          />

          {/* Specular shine arc */}
          <Circle
            cx={cx} cy={cy} r={ringR}
            fill="none"
            stroke="#ffffff"
            strokeWidth={ringStrokeWidth * 0.5}
            strokeOpacity={0.60}
            strokeLinecap="round"
            strokeDasharray={`${ringR * 0.55} ${ringR * 10}`}
            strokeDashoffset={ringR * 0.28}
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
  // Layer stack (bottom → top), all inside breathing Animated.View:
  //   1. Aurora glow A  — radialGrad pulse (auroraA opacity)
  //   2. Aurora glow B  — radialGrad pulse (auroraB opacity), offset phase
  //   3. Static bloom   — 3 concentric opacity circles for constant depth
  //   4. Rays           — rotating, alternating length, palette-colored
  //   5. Ring layer A   — forward palette, cross-fading (gradAOpacity)
  //   6. Ring layer B   — reversed palette, cross-fading (gradBOpacity)
  //   7. Inner ring     — static bright inner ring for luminosity
  //   8. Shine arc      — static specular highlight
  //   9. Sparkle dots   — twinkling per-dot opacity

  const animated = (
    <Animated.View
      style={{
        width: size,
        height: size,
        transform: [{ scale: breatheAnim }],
      }}
      accessibilityLabel={label}
    >
      {/* ── Layer 1: Aurora glow A (opacity-pulsed radial gradient) ─────────── */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: auroraA }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgRadialGradient id={auroraAGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0%"   stopColor={pal[0]} stopOpacity="0.32" />
              <Stop offset="45%"  stopColor={pal[1]} stopOpacity="0.14" />
              <Stop offset="100%" stopColor={pal[2]} stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={bloomR3} fill={`url(#${auroraAGradId})`} />
        </Svg>
      </Animated.View>

      {/* ── Layer 2: Aurora glow B (independent phase, different palette stop) ── */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: auroraB }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgRadialGradient id={auroraBGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0%"   stopColor={pal[3] ?? pal[2]} stopOpacity="0.28" />
              <Stop offset="45%"  stopColor={pal[2]}           stopOpacity="0.12" />
              <Stop offset="100%" stopColor={pal[1]}           stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={bloomR3} fill={`url(#${auroraBGradId})`} />
        </Svg>
      </Animated.View>

      {/* ── Layer 3: Static atmospheric bloom for constant depth ──────────────── */}
      <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={cx} cy={cy} r={bloomR3} fill={pal[0]} fillOpacity={0.05} />
          <Circle cx={cx} cy={cy} r={bloomR2} fill={pal[1]} fillOpacity={0.08} />
          <Circle cx={cx} cy={cy} r={bloomR1} fill={pal[0]} fillOpacity={0.12} />
        </Svg>
      </View>

      {/* ── Layer 4: Rays (slow rotation, alternating length) ─────────────────── */}
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
              x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
              stroke={r.color}
              strokeWidth={r.isAlt ? rayStrokeWidth * 0.72 : rayStrokeWidth}
              strokeOpacity={r.isAlt ? 0.42 : 0.68}
              strokeLinecap="round"
            />
          ))}
        </Svg>
      </Animated.View>

      {/* ── Layers 5 + 6: Cross-fading iridescent ring with outer soft glow ──── */}
      {/* Static outer glow ring — constant depth behind the cross-fade */}
      <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx} cy={cy} r={ringR + ringStrokeWidth * 0.7}
            fill="none"
            stroke={pal[0]}
            strokeWidth={ringStrokeWidth * 1.5}
            strokeOpacity={0.18}
          />
        </Svg>
      </View>

      {/* Layer 5 — gradient A (forward palette) */}
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
            cx={cx} cy={cy} r={ringR}
            fill="none"
            stroke={`url(#${gradAId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={1}
          />
        </Svg>
      </Animated.View>

      {/* Layer 6 — gradient B (reversed palette = different hue phase) */}
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
            cx={cx} cy={cy} r={ringR}
            fill="none"
            stroke={`url(#${gradBId})`}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={1}
          />
        </Svg>
      </Animated.View>

      {/* ── Layer 7: Inner bright ring — luminosity inside the tube ─────────── */}
      <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx} cy={cy} r={ringR - ringStrokeWidth * 0.18}
            fill="none"
            stroke="#ffffff"
            strokeWidth={innerRingStroke}
            strokeOpacity={0.50}
          />
        </Svg>
      </View>

      {/* ── Layer 8: Specular shine arc — top-left light source ─────────────── */}
      <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx} cy={cy} r={ringR}
            fill="none"
            stroke="#ffffff"
            strokeWidth={ringStrokeWidth * 0.52}
            strokeOpacity={0.65}
            strokeLinecap="round"
            strokeDasharray={`${ringR * 0.55} ${ringR * 10}`}
            strokeDashoffset={ringR * 0.28}
          />
        </Svg>
      </View>

      {/* ── Layer 9: Sparkle dots ────────────────────────────────────────────── */}
      {sparkleDots.map((dot, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width:        sparkleSize,
            height:       sparkleSize,
            borderRadius: sparkleSize,
            backgroundColor: dot.color,
            left: dot.x - sparkleSize / 2,
            top:  dot.y - sparkleSize / 2,
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
