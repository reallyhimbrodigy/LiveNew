import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View } from 'react-native';
import Svg, {
  Circle,
  Line,
  Defs,
  RadialGradient as SvgGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';

/**
 * Radiant halo token — visual replacement for the old Gem component.
 *
 * Props:
 *   gem      — a GEMS entry {id, name, day, tier, rarityPct, hue, flavor}
 *   earned   — bool
 *   size     — default 56
 *   onPress  — optional
 *
 * The underlying data model still uses "gem" naming; this component is the
 * product-facing visual: a ring of light with radiating rays that escalates
 * with rarity tier, matching the radiant halo above the meditating figure
 * in the LiveNew logo.
 *
 * Animation is tier-gated and only runs for earned halos. Locked halos are
 * always static. All loops use useNativeDriver: true (transforms + opacity
 * only) so they run on the native thread and don't block JS. Reduce Motion
 * skips all looping animations.
 */

// ── Tunable animation constants ───────────────────────────────────────────────
const ANIM = {
  // Glow pulse: opacity range and duration (ms) per tier
  UNCOMMON_GLOW_MIN: 0.55,
  UNCOMMON_GLOW_MAX: 1.0,
  UNCOMMON_GLOW_DUR: 3200,

  RARE_GLOW_MIN: 0.5,
  RARE_GLOW_MAX: 1.0,
  RARE_GLOW_DUR: 2800,

  EPIC_GLOW_MIN: 0.5,
  EPIC_GLOW_MAX: 1.0,
  EPIC_GLOW_DUR: 2800,

  LEGENDARY_GLOW_MIN: 0.45,
  LEGENDARY_GLOW_MAX: 1.0,
  LEGENDARY_GLOW_DUR: 2200,

  MYTHIC_GLOW_MIN: 0.45,
  MYTHIC_GLOW_MAX: 1.0,
  MYTHIC_GLOW_DUR: 2200,

  // Ray rotation duration (ms per full revolution) — lower = faster
  EPIC_ROT_DUR: 22000,
  LEGENDARY_ROT_DUR: 15000,
  MYTHIC_ROT_DUR: 11000,

  // Breathing scale ranges and duration
  LEGENDARY_BREATHE_MIN: 1.0,
  LEGENDARY_BREATHE_MAX: 1.03,
  LEGENDARY_BREATHE_DUR: 3000,

  MYTHIC_BREATHE_MIN: 1.0,
  MYTHIC_BREATHE_MAX: 1.04,
  MYTHIC_BREATHE_DUR: 2600,

  // Mythic sparkle: number of dots, stagger delay (ms), twinkle duration (ms)
  MYTHIC_SPARKLE_COUNT: 6,
  MYTHIC_SPARKLE_DUR: 900,
  MYTHIC_SPARKLE_STAGGER: 140,
};

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Animated values ────────────────────────────────────────────────────────
  const rotAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
  // Sparkle opacity values for Mythic
  const sparkleAnims = useRef(
    Array.from({ length: ANIM.MYTHIC_SPARKLE_COUNT }, () => new Animated.Value(0))
  ).current;

  // Loop refs for cleanup
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
    // Stop any running loops
    loopRefs.current.forEach((l) => l.stop());
    loopRefs.current = [];

    // Only animate earned halos when reduce motion is off
    if (!earned || reduceMotion) return;

    const tier = gem.tier;
    const newLoops = [];

    // ── Ray rotation (Epic, Legendary, Mythic) ─────────────────────────────
    const rotDur =
      tier === 'Epic' ? ANIM.EPIC_ROT_DUR :
      tier === 'Legendary' ? ANIM.LEGENDARY_ROT_DUR :
      tier === 'Mythic' ? ANIM.MYTHIC_ROT_DUR : 0;

    if (rotDur > 0) {
      rotAnim.setValue(0);
      const rotLoop = Animated.loop(
        Animated.timing(rotAnim, {
          toValue: 1,
          duration: rotDur,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      rotLoop.start();
      newLoops.push(rotLoop);
    }

    // ── Glow pulse (Uncommon, Rare, Epic, Legendary, Mythic) ───────────────
    let glowMin, glowMax, glowDur;
    if (tier === 'Uncommon') {
      glowMin = ANIM.UNCOMMON_GLOW_MIN; glowMax = ANIM.UNCOMMON_GLOW_MAX; glowDur = ANIM.UNCOMMON_GLOW_DUR;
    } else if (tier === 'Rare') {
      glowMin = ANIM.RARE_GLOW_MIN; glowMax = ANIM.RARE_GLOW_MAX; glowDur = ANIM.RARE_GLOW_DUR;
    } else if (tier === 'Epic') {
      glowMin = ANIM.EPIC_GLOW_MIN; glowMax = ANIM.EPIC_GLOW_MAX; glowDur = ANIM.EPIC_GLOW_DUR;
    } else if (tier === 'Legendary') {
      glowMin = ANIM.LEGENDARY_GLOW_MIN; glowMax = ANIM.LEGENDARY_GLOW_MAX; glowDur = ANIM.LEGENDARY_GLOW_DUR;
    } else if (tier === 'Mythic') {
      glowMin = ANIM.MYTHIC_GLOW_MIN; glowMax = ANIM.MYTHIC_GLOW_MAX; glowDur = ANIM.MYTHIC_GLOW_DUR;
    }

    if (glowMin !== undefined) {
      glowAnim.setValue(glowMax);
      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: glowMin,
            duration: glowDur,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: glowMax,
            duration: glowDur,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
        ])
      );
      glowLoop.start();
      newLoops.push(glowLoop);
    }

    // ── Breathing scale (Legendary, Mythic) ────────────────────────────────
    let breatheMin, breatheMax, breatheDur;
    if (tier === 'Legendary') {
      breatheMin = ANIM.LEGENDARY_BREATHE_MIN; breatheMax = ANIM.LEGENDARY_BREATHE_MAX; breatheDur = ANIM.LEGENDARY_BREATHE_DUR;
    } else if (tier === 'Mythic') {
      breatheMin = ANIM.MYTHIC_BREATHE_MIN; breatheMax = ANIM.MYTHIC_BREATHE_MAX; breatheDur = ANIM.MYTHIC_BREATHE_DUR;
    }

    if (breatheMin !== undefined) {
      breatheAnim.setValue(breatheMin);
      const breatheLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: breatheMax,
            duration: breatheDur,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
            toValue: breatheMin,
            duration: breatheDur,
            easing: Easing.inOut(Easing.sine),
            useNativeDriver: true,
          }),
        ])
      );
      breatheLoop.start();
      newLoops.push(breatheLoop);
    }

    // ── Mythic sparkle twinkle ─────────────────────────────────────────────
    if (tier === 'Mythic') {
      sparkleAnims.forEach((anim, i) => {
        anim.setValue(0);
        const sparkleLoop = Animated.loop(
          Animated.sequence([
            Animated.delay(i * ANIM.MYTHIC_SPARKLE_STAGGER),
            Animated.timing(anim, {
              toValue: 1,
              duration: ANIM.MYTHIC_SPARKLE_DUR,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: ANIM.MYTHIC_SPARKLE_DUR,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        );
        sparkleLoop.start();
        newLoops.push(sparkleLoop);
      });
    }

    loopRefs.current = newLoops;

    return () => {
      newLoops.forEach((l) => l.stop());
    };
  }, [earned, reduceMotion, gem.tier]);

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loopRefs.current.forEach((l) => l.stop());
    };
  }, []);

  // ── Ray count + length by tier ─────────────────────────────────────────────
  const TIER_CONFIG = {
    Common:    { rays: 8,  rayLength: 0.14 },
    Uncommon:  { rays: 10, rayLength: 0.15 },
    Rare:      { rays: 12, rayLength: 0.16 },
    Epic:      { rays: 14, rayLength: 0.17 },
    Legendary: { rays: 16, rayLength: 0.19 },
    Mythic:    { rays: 20, rayLength: 0.21 },
  };
  const config = TIER_CONFIG[gem.tier] || TIER_CONFIG.Common;
  const { rays: RAY_COUNT, rayLength: RAY_LEN_FRAC } = config;

  // ── Geometry ───────────────────────────────────────────────────────────────
  const cx = size / 2;
  const cy = size / 2;

  const ringR = size * 0.32;
  const ringStrokeWidth = Math.max(1.2, size * 0.028);

  const glowR = size * 0.46;
  const isHighTier = gem.tier === 'Legendary' || gem.tier === 'Mythic';
  const glowBaseOpacity = earned ? (isHighTier ? 0.28 : 0.18) : 0;

  const rayInnerR = ringR + ringStrokeWidth * 0.6;
  const rayOuterR = ringR + size * RAY_LEN_FRAC + ringStrokeWidth * 0.6;
  const rayStrokeWidth = Math.max(0.8, size * 0.02);

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

  // ── Colors ─────────────────────────────────────────────────────────────────
  const hue = gem.hue;

  // Unique gradient id per instance
  const uid = React.useId();
  const gradId = `halo-grad-${gem.id}-${uid.replace(/:/g, '')}`;

  const ringColor = earned ? `url(#${gradId})` : colors.line;
  const ringOpacity = earned ? 1 : 0.5;
  const haloOpacity = earned ? 1 : 0.45;

  const rayColor = earned ? lightenHex(hue, 0.3) : colors.dim;
  const rayOpacity = earned ? 0.75 : 0;
  const lockedGhostRayOpacity = 0.18;

  // ── Accessibility ──────────────────────────────────────────────────────────
  const label = earned
    ? `${gem.name} halo, earned`
    : `${gem.name} halo, locked`;

  // ── Determine which animations are active ─────────────────────────────────
  const shouldAnimate = earned && !reduceMotion;
  const tier = gem.tier;
  const hasRotation = shouldAnimate && (tier === 'Epic' || tier === 'Legendary' || tier === 'Mythic');
  const hasGlow = shouldAnimate && tier !== 'Common';
  const hasBreathing = shouldAnimate && (tier === 'Legendary' || tier === 'Mythic');
  const hasSparkle = shouldAnimate && tier === 'Mythic';

  // ── Sparkle dot positions (Mythic only) — orbit slightly beyond the ray tips
  const sparkleR = rayOuterR + size * 0.04;
  const sparkleDots = hasSparkle
    ? Array.from({ length: ANIM.MYTHIC_SPARKLE_COUNT }, (_, i) => {
        const angle = (2 * Math.PI * i) / ANIM.MYTHIC_SPARKLE_COUNT - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * sparkleR,
          y: cy + Math.sin(angle) * sparkleR,
        };
      })
    : [];

  // ── Rotation interpolation (0→1 → 0deg→360deg) ────────────────────────────
  const rotateInterpolated = rotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── Static glow circle (non-animated fallback, or Common/locked) ───────────
  const glowCircle = (
    <Circle
      cx={cx}
      cy={cy}
      r={glowR}
      fill={hue}
      fillOpacity={glowBaseOpacity}
    />
  );

  // ── The core static ring SVG (used in the ring/core layer) ────────────────
  const ringAndDefs = (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      accessibilityLabel={label}
      opacity={haloOpacity}
    >
      <Defs>
        <SvgGradient id={gradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0" stopColor={lightenHex(hue, 0.4)} stopOpacity="1" />
          <Stop offset="1" stopColor={hue} stopOpacity="1" />
        </SvgGradient>
      </Defs>

      {/* Glow — static version for non-animated tiers */}
      {!hasGlow && glowCircle}

      {/* Rays — only rendered here when NOT rotating (Common, Uncommon, Rare locked) */}
      {!hasRotation && (
        earned
          ? rayLines.map((r, i) => (
              <Line
                key={i}
                x1={r.x1}
                y1={r.y1}
                x2={r.x2}
                y2={r.y2}
                stroke={rayColor}
                strokeWidth={rayStrokeWidth}
                strokeOpacity={rayOpacity}
                strokeLinecap="round"
              />
            ))
          : [0, Math.floor(RAY_COUNT / 2)].map((idx) => {
              const r = rayLines[idx];
              return (
                <Line
                  key={idx}
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  stroke={colors.dim}
                  strokeWidth={rayStrokeWidth}
                  strokeOpacity={lockedGhostRayOpacity}
                  strokeLinecap="round"
                />
              );
            })
      )}

      {/* Halo ring */}
      <Circle
        cx={cx}
        cy={cy}
        r={ringR}
        fill="none"
        stroke={ringColor}
        strokeWidth={ringStrokeWidth}
        strokeOpacity={ringOpacity}
      />
    </Svg>
  );

  // ── Static render (no animation — Common earned, locked, reduce-motion) ────
  if (!shouldAnimate || tier === 'Common') {
    const content = (
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        accessibilityLabel={label}
        opacity={haloOpacity}
      >
        <Defs>
          <SvgGradient id={gradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0" stopColor={lightenHex(hue, 0.4)} stopOpacity="1" />
            <Stop offset="1" stopColor={hue} stopOpacity="1" />
          </SvgGradient>
        </Defs>

        {/* Glow */}
        <Circle
          cx={cx}
          cy={cy}
          r={glowR}
          fill={hue}
          fillOpacity={glowBaseOpacity}
        />

        {/* Rays */}
        {earned
          ? rayLines.map((r, i) => (
              <Line
                key={i}
                x1={r.x1}
                y1={r.y1}
                x2={r.x2}
                y2={r.y2}
                stroke={rayColor}
                strokeWidth={rayStrokeWidth}
                strokeOpacity={rayOpacity}
                strokeLinecap="round"
              />
            ))
          : [0, Math.floor(RAY_COUNT / 2)].map((idx) => {
              const r = rayLines[idx];
              return (
                <Line
                  key={idx}
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  stroke={colors.dim}
                  strokeWidth={rayStrokeWidth}
                  strokeOpacity={lockedGhostRayOpacity}
                  strokeLinecap="round"
                />
              );
            })}

        {/* Ring */}
        <Circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke={ringColor}
          strokeWidth={ringStrokeWidth}
          strokeOpacity={ringOpacity}
        />
      </Svg>
    );

    if (onPress) {
      return (
        <Pressable
          onPress={onPress}
          hitSlop={6}
          accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          {content}
        </Pressable>
      );
    }
    return content;
  }

  // ── Animated render — earned && !reduceMotion && tier !== Common ───────────
  // Layer order (bottom → top):
  //   1. Glow layer (Animated.View — opacity pulse)
  //   2. Rays layer (Animated.View — rotation, contains its own Svg)
  //   3. Ring/core layer (Animated.View — breathing scale)
  //   4. Sparkle dots (Mythic only, Animated.View per dot)

  const sparkleSize = Math.max(2.5, size * 0.05);

  const animated = (
    <View
      style={{ width: size, height: size }}
      accessibilityLabel={label}
    >
      {/* ── Layer 1: Glow (opacity pulse) ─────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          opacity: hasGlow ? glowAnim : glowBaseOpacity,
        }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx}
            cy={cy}
            r={glowR}
            fill={hue}
            fillOpacity={glowBaseOpacity}
          />
        </Svg>
      </Animated.View>

      {/* ── Layer 2: Rays (rotation) ───────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
          },
          hasRotation && {
            transform: [{ rotate: rotateInterpolated }],
          },
        ]}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {rayLines.map((r, i) => (
            <Line
              key={i}
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke={rayColor}
              strokeWidth={rayStrokeWidth}
              strokeOpacity={rayOpacity}
              strokeLinecap="round"
            />
          ))}
        </Svg>
      </Animated.View>

      {/* ── Layer 3: Ring/core (breathing scale) ──────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
          },
          hasBreathing && {
            transform: [{ scale: breatheAnim }],
          },
        ]}
      >
        <Svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          opacity={haloOpacity}
        >
          <Defs>
            <SvgGradient id={gradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0" stopColor={lightenHex(hue, 0.4)} stopOpacity="1" />
              <Stop offset="1" stopColor={hue} stopOpacity="1" />
            </SvgGradient>
          </Defs>
          <Circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={ringColor}
            strokeWidth={ringStrokeWidth}
            strokeOpacity={ringOpacity}
          />
        </Svg>
      </Animated.View>

      {/* ── Layer 4: Mythic sparkle dots ────────────────────────────────────── */}
      {hasSparkle &&
        sparkleDots.map((dot, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: sparkleSize,
              height: sparkleSize,
              borderRadius: sparkleSize,
              backgroundColor: lightenHex(hue, 0.55),
              // Centre the dot on its orbit position
              left: dot.x - sparkleSize / 2,
              top: dot.y - sparkleSize / 2,
              opacity: sparkleAnims[i],
            }}
          />
        ))}
    </View>
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

// ── Utility ───────────────────────────────────────────────────────────────────
/**
 * Lighten a hex color by blending toward white by `amount` [0–1].
 * Pure JS, no library.
 */
function lightenHex(hex, amount) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr},${lg},${lb})`;
}
