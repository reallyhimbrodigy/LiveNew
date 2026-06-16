import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View } from 'react-native';
import Svg, {
  Circle,
  Line,
  Defs,
  RadialGradient as SvgRadialGradient,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';
import { gemPalette, gemRank, maxGemRank } from '../domain/gems';

/**
 * Radiant halo token — premium redesign with a PROGRESSIVE VISUAL LADDER.
 *
 * Props (UNCHANGED — backward-compatible):
 *   gem      — a GEMS entry {id, name, day, tier, rarityPct, hue, flavor}
 *   earned   — bool
 *   size     — default 56
 *   onPress  — optional
 *
 * THE LADDER (the key idea):
 *   Every visual dimension scales off the gem's PROGRESSION RANK (gemRank: 0 for
 *   first_light … 7 for the_year), NOT off its tier band. So each of the 8 halos
 *   is a distinct, monotonically-cooler rung — and same-tier pairs that used to
 *   render identically (first_light/foundation, the_month/steadfast) now clearly
 *   differ: foundation has more rays, a faint rotation, an extra sparkle and a
 *   slightly hotter glow than first_light; steadfast out-elaborates the_month on
 *   every axis. the_year (rank 7) is unmistakably the spectacle: the most rays,
 *   the fastest rotation, a counter-rotating second ray layer, the strongest
 *   glow, breathing, the densest + prismatic sparkles.
 *
 *   Per-rank scaling (all interpolated 0→7 by progFor()):
 *     • ray count        8 → 22
 *     • ray length       0.12 → 0.21 of size
 *     • rotation speed   none at rank 0 → very fast at rank 7
 *     • glow depth/min   shallow slow breath → deep fast breath
 *     • core pulse speed slow → fast
 *     • sparkle count    1 → 8
 *     • flourishes unlocked by rank:
 *         rank ≥ 1  rotation (foundation gets a faint turn first_light lacks)
 *         rank ≥ 3  alternating long/short rays
 *         rank ≥ 5  breathing scale + outer secondary ray ring
 *         rank ≥ 6  counter-rotating inner ray layer
 *         rank = 7  prismatic multi-hue sparkles + extra dense rays
 *
 * Visual model (bottom → top for earned halos):
 *   1. Atmospheric bloom  — 3 translucent radial circles; opacity pulse depth
 *      grows with rank.
 *   2. Rays layer(s)      — gradient rays + rotation (rank ≥ 1). High ranks add a
 *      counter-rotating secondary ray layer for living, layered motion.
 *   3. Ring layer         — dimensional ring filled with a 4-stop gradient;
 *      breathing scale at high ranks.
 *   4. Core glow          — radial gradient lit-from-within, pulses on a phase
 *      offset from the bloom.
 *   5. Shine arc          — specular highlight arc on the ring.
 *   6. Sparkle dots       — twinkling dots; count + density grow with rank,
 *      prismatic hues at the top rank.
 *
 * Locked state: NOT plain grey — a dark silhouette with a faint hint of the
 * gem's jewel color (ghost rays + low-opacity jewel ring), a tantalizing tease.
 *
 * Animation:
 *   - All Animated.loop + useNativeDriver: true (transform + opacity only).
 *   - ONLY Easing.sin is used for sinusoidal eases (Easing.sine crashes RN).
 *   - Loop refs are stopped on unmount and whenever earned/reduceMotion/rank change.
 *   - Reduce Motion → static, but still the full premium visual for the rank.
 *   - Renders correctly at small (44) and large (120/140) sizes.
 */

// ── Ladder ramp constants ───────────────────────────────────────────────────
// Animation timings/intensities are computed by lerping along the rank 0..7.
const LADDER = {
  // Glow (bloom) opacity breath — faster + deeper as rank climbs.
  GLOW_DUR_R0: 4200,   // slow, calm first_light breath
  GLOW_DUR_R7: 1700,   // fast, vivid the_year breath
  GLOW_MIN_R0: 0.52,   // shallow breath at the bottom (subtle)
  GLOW_MIN_R7: 0.30,   // deep breath at the top (dramatic)
  GLOW_MAX:    1.0,

  // Core lit-from-within pulse — phase-offset from the bloom.
  CORE_DUR_R0: 4800,
  CORE_DUR_R7: 1900,
  CORE_MIN:        0.55,
  CORE_MAX:        1.0,
  CORE_SCALE_MIN:  0.94,
  CORE_SCALE_MAX:  1.06,

  // Ray rotation (ms per full revolution). Rank 0 = no rotation; from rank 1
  // (foundation) up it spins, accelerating toward the top.
  ROT_DUR_R1: 64000,   // foundation: a faint, slow turn first_light doesn't have
  ROT_DUR_R7: 8500,    // the_year: fastest sweep
  // Counter-rotating secondary ray layer (high ranks) — opposite direction,
  // a touch slower so the two layers shear past each other.
  COUNTER_ROT_DUR_R6: 16000,
  COUNTER_ROT_DUR_R7: 11000,

  // Breathing scale (rank ≥ 5).
  BREATHE_MIN: 1.0,
  BREATHE_MAX_R5: 1.028,
  BREATHE_MAX_R7: 1.05,
  BREATHE_DUR_R5: 3200,
  BREATHE_DUR_R7: 2400,

  // Ray geometry.
  RAYS_R0:        8,
  RAYS_R7:        22,
  RAY_LEN_R0:     0.12,
  RAY_LEN_R7:     0.21,

  // Glow/bloom static intensity multiplier (bloom circle opacities) by rank.
  BLOOM_MULT_R0:  0.85,
  BLOOM_MULT_R7:  1.5,

  // Sparkle.
  SPARKLES_R0:    1,
  SPARKLES_R7:    8,
  SPARKLE_DUR:    900,
  SPARKLE_STAGGER: 120,

  // Rank thresholds for unlocking flourishes.
  ALT_RAYS_FROM:     3,   // alternating long/short rays
  BREATHE_FROM:      5,   // breathing scale
  SECONDARY_RING_FROM: 5, // a faint outer secondary ray ring
  COUNTER_ROT_FROM:  6,   // counter-rotating inner ray layer
  PRISM_SPARKLE_RANK: 7,  // prismatic sparkle hues (the_year only)
};

// Max sparkle count (for stable Animated.Value array sizing).
const MAX_SPARKLE = 8;

// ── Ladder math ─────────────────────────────────────────────────────────────
// Normalized progression t in [0,1] for a rank, then linear interpolation.
const lerp = (a, b, t) => a + (b - a) * t;

/** progression t in [0,1] from a rank (0..maxRank). */
function progT(rank) {
  const max = maxGemRank() || 1;
  const r = Math.max(0, Math.min(max, rank));
  return r / max;
}

/** Sparkle dot count for a rank: 1 (first_light) → 8 (the_year), monotonic. */
function sparkleCountForRank(rank) {
  const t = progT(rank);
  const n = Math.round(lerp(LADDER.SPARKLES_R0, LADDER.SPARKLES_R7, t));
  return Math.max(1, Math.min(MAX_SPARKLE, n));
}

/** Ray count for a rank: 8 → 22, monotonic and always even for symmetry. */
function rayCountForRank(rank) {
  const t = progT(rank);
  let n = Math.round(lerp(LADDER.RAYS_R0, LADDER.RAYS_R7, t));
  if (n % 2 !== 0) n += 1; // keep even so alternating long/short stays balanced
  return n;
}

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Animated values ────────────────────────────────────────────────────────
  const rotAnim        = useRef(new Animated.Value(0)).current;
  const counterRotAnim = useRef(new Animated.Value(0)).current;
  const glowAnim       = useRef(new Animated.Value(1)).current;
  const coreAnim       = useRef(new Animated.Value(1)).current;
  const breatheAnim    = useRef(new Animated.Value(1)).current;
  const sparkleAnims = useRef(
    Array.from({ length: MAX_SPARKLE }, () => new Animated.Value(0))
  ).current;

  const loopRefs = useRef([]);

  // ── Reduce Motion ──────────────────────────────────────────────────────────
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

    // Everything ramps off the gem's PROGRESSION RANK (0..7), not its tier band.
    const rank = gemRank(gem);
    const t    = progT(rank);          // 0 (first_light) .. 1 (the_year)
    const loops = [];

    // Glow (bloom) pulse — faster + deeper breath as rank climbs.
    const glowDur = Math.round(lerp(LADDER.GLOW_DUR_R0, LADDER.GLOW_DUR_R7, t));
    const glowMin = lerp(LADDER.GLOW_MIN_R0, LADDER.GLOW_MIN_R7, t);
    glowAnim.setValue(LADDER.GLOW_MAX);
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: glowMin,
          duration: glowDur,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: LADDER.GLOW_MAX,
          duration: glowDur,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    glowLoop.start();
    loops.push(glowLoop);

    // Core glow pulse — luminous center breathes on a phase offset from the
    // bloom (it starts from CORE_MIN while the bloom starts from GLOW_MAX), so
    // the halo's center reads as "breathing with light," not a static disc.
    const coreDur = Math.round(lerp(LADDER.CORE_DUR_R0, LADDER.CORE_DUR_R7, t));
    coreAnim.setValue(LADDER.CORE_MIN);
    const coreLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(coreAnim, {
          toValue: LADDER.CORE_MAX,
          duration: coreDur,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(coreAnim, {
          toValue: LADDER.CORE_MIN,
          duration: coreDur,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    coreLoop.start();
    loops.push(coreLoop);

    // Ray rotation — rank 0 (first_light) does NOT rotate, so the very first
    // halo reads as calm/subtle; from rank 1 (foundation) up it rotates, and the
    // sweep accelerates monotonically toward the_year. This is the single most
    // obvious differentiator between first_light and foundation.
    if (rank >= 1) {
      // Interpolate duration along ranks 1..max (rank 1 = slowest spin).
      const max  = maxGemRank() || 1;
      const tRot = (rank - 1) / Math.max(1, max - 1); // 0 at rank1 .. 1 at max
      const rotDur = Math.round(lerp(LADDER.ROT_DUR_R1, LADDER.ROT_DUR_R7, tRot));
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
      loops.push(rotLoop);
    }

    // Counter-rotating secondary ray layer — high ranks only. Spins the opposite
    // direction (handled in the transform) so the two ray layers shear past each
    // other, giving the top halos a layered, alive depth nothing below has.
    if (rank >= LADDER.COUNTER_ROT_FROM) {
      const counterDur = rank >= maxGemRank()
        ? LADDER.COUNTER_ROT_DUR_R7
        : LADDER.COUNTER_ROT_DUR_R6;
      counterRotAnim.setValue(0);
      const counterLoop = Animated.loop(
        Animated.timing(counterRotAnim, {
          toValue: 1,
          duration: counterDur,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      counterLoop.start();
      loops.push(counterLoop);
    }

    // Breathing scale — rank ≥ 5 (steadfast/century/the_year). Amplitude + speed
    // both grow with rank so the_year breathes biggest and fastest.
    if (rank >= LADDER.BREATHE_FROM) {
      const max    = maxGemRank() || 1;
      const tBr    = (rank - LADDER.BREATHE_FROM) / Math.max(1, max - LADDER.BREATHE_FROM);
      const breatheMax = lerp(LADDER.BREATHE_MAX_R5, LADDER.BREATHE_MAX_R7, tBr);
      const breatheDur = Math.round(lerp(LADDER.BREATHE_DUR_R5, LADDER.BREATHE_DUR_R7, tBr));
      breatheAnim.setValue(LADDER.BREATHE_MIN);
      const breatheLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: breatheMax,
            duration: breatheDur,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
            toValue: LADDER.BREATHE_MIN,
            duration: breatheDur,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      breatheLoop.start();
      loops.push(breatheLoop);
    } else {
      breatheAnim.setValue(LADDER.BREATHE_MIN);
    }

    // Sparkle twinkles — count grows with rank (1 at first_light → 8 at the_year).
    const sparkleCount = sparkleCountForRank(rank);
    sparkleAnims.slice(0, sparkleCount).forEach((anim, i) => {
      anim.setValue(0);
      const sparkleLoop = Animated.loop(
        Animated.sequence([
          Animated.delay(i * LADDER.SPARKLE_STAGGER),
          Animated.timing(anim, {
            toValue: 1,
            duration: LADDER.SPARKLE_DUR,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: LADDER.SPARKLE_DUR,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      sparkleLoop.start();
      loops.push(sparkleLoop);
    });
    // Ensure unused sparkle anims stay at 0
    sparkleAnims.slice(sparkleCount).forEach((anim) => anim.setValue(0));

    loopRefs.current = loops;
    return () => {
      loops.forEach((l) => l.stop());
    };
  }, [earned, reduceMotion, gem?.id]);

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loopRefs.current.forEach((l) => l.stop());
    };
  }, []);

  // Defensive: every current caller passes a real gem, but guard anyway so a
  // future null/undefined caller renders nothing instead of crashing.
  if (!gem) return null;

  // ── Palette + progression ──────────────────────────────────────────────────
  const pal  = gemPalette(gem);
  const rank = gemRank(gem);          // 0 (first_light) .. 7 (the_year)
  const t    = progT(rank);           // 0..1 progression

  // Rank-derived flourish gates (geometry + static render use these too).
  const altRays        = rank >= LADDER.ALT_RAYS_FROM;      // alternating long/short rays
  const hasSecondary   = rank >= LADDER.SECONDARY_RING_FROM; // a 2nd interleaved ray ring
  const hasCounterRot  = rank >= LADDER.COUNTER_ROT_FROM;    // 2nd ring counter-rotates
  const isPrismSparkle = rank >= LADDER.PRISM_SPARKLE_RANK;  // the_year only

  const cx = size / 2;
  const cy = size / 2;

  const ringR           = size * 0.30;
  const ringStroke      = Math.max(2.0, size * 0.052);
  const innerRingStroke = Math.max(0.8, size * 0.016);

  // Atmospheric bloom radii (3 layers). Bloom opacity scales with rank so the
  // top halos glow noticeably stronger than the entry-level ones.
  const bloomR1 = size * 0.30;
  const bloomR2 = size * 0.40;
  const bloomR3 = size * 0.50;
  const bloomMult = lerp(LADDER.BLOOM_MULT_R0, LADDER.BLOOM_MULT_R7, t);

  // Ray geometry — count + length both ramp with rank; alternating long/short
  // rays unlock at rank ≥ 3.
  const rayCount   = rayCountForRank(rank);
  const rayLenFrac = lerp(LADDER.RAY_LEN_R0, LADDER.RAY_LEN_R7, t);
  const rayInnerR  = ringR + ringStroke * 0.5;
  // Clamp the longest ray so its tip stays inside the size×size box (with a
  // small margin) even at small sizes like 44 — the secondary layer is the
  // longest at 1.12×, so size baseLen around that. The top halos have the
  // longest rays AND the secondary layer, so this guarantees no edge clipping.
  const SECONDARY_RAY_MULT = 1.12;
  const longestMult = hasSecondary ? SECONDARY_RAY_MULT : 1;
  const maxRayTip   = size * 0.5 - Math.max(1.5, size * 0.02);
  const maxBaseLen  = Math.max(2, (maxRayTip - rayInnerR) / longestMult);
  const baseLen     = Math.min(size * rayLenFrac, maxBaseLen);
  const rayLines = Array.from({ length: rayCount }, (_, i) => {
    const angle  = (2 * Math.PI * i) / rayCount - Math.PI / 2;
    const isAlt  = altRays && i % 2 === 1;
    const rayLen = isAlt ? baseLen * 0.62 : baseLen;
    return {
      x1: cx + Math.cos(angle) * rayInnerR,
      y1: cy + Math.sin(angle) * rayInnerR,
      x2: cx + Math.cos(angle) * (rayInnerR + rayLen),
      y2: cy + Math.sin(angle) * (rayInnerR + rayLen),
      isAlt,
    };
  });

  // Secondary ray layer — offset by half a ray-gap and a little longer, so it
  // interleaves with the primary rays. Appears from rank 5 (steadfast), and from
  // rank 6 it counter-rotates so the two layers shear past each other. Only
  // built for ranks that use it (keeps lower halos cheap).
  const secondaryRayLines = hasSecondary
    ? Array.from({ length: rayCount }, (_, i) => {
        const angle  = (2 * Math.PI * (i + 0.5)) / rayCount - Math.PI / 2;
        const rayLen = baseLen * SECONDARY_RAY_MULT;
        return {
          x1: cx + Math.cos(angle) * rayInnerR,
          y1: cy + Math.sin(angle) * rayInnerR,
          x2: cx + Math.cos(angle) * (rayInnerR + rayLen),
          y2: cy + Math.sin(angle) * (rayInnerR + rayLen),
        };
      })
    : [];

  // Sparkle dot positions — orbit nestled among the ray tips (reads as part of
  // the halo, not detached satellites). Clamped to stay inside the size×size box
  // with margin so dots never clip the edge, even at small sizes (e.g. 44).
  const sparkleCount  = sparkleCountForRank(rank);
  const sparkleSize   = Math.max(2, size * 0.046);
  const sparkleOrbitR = Math.min(
    rayInnerR + baseLen * 0.6,
    size * 0.5 - sparkleSize
  );
  // Prismatic palette for the_year's sparkles (cycles multi-hue); other ranks
  // alternate core/sheen as before.
  const prism = pal.prism;
  const sparkleDots   = Array.from({ length: sparkleCount }, (_, i) => {
    // Distribute at slightly irregular angles for organic feel. With only 1–2
    // dots, jitter would make them visibly asymmetric, so symmetrize.
    const baseAngle = (2 * Math.PI * i) / sparkleCount - Math.PI / 2;
    const jitter    = sparkleCount <= 2
      ? 0
      : (i % 3 === 0 ? 0.08 : i % 3 === 1 ? -0.05 : 0.12);
    const angle     = baseAngle + jitter;
    const color = (isPrismSparkle && Array.isArray(prism) && prism.length)
      ? prism[i % prism.length]
      : (i % 2 === 0 ? pal.core : pal.sheen);
    return {
      x: cx + Math.cos(angle) * sparkleOrbitR,
      y: cy + Math.sin(angle) * sparkleOrbitR,
      color,
    };
  });

  // ── Gradient IDs (unique per instance) ────────────────────────────────────
  // Use React.useId() to ensure IDs are unique across concurrent instances.
  const uid        = React.useId().replace(/:/g, '');
  // Locked-state gradient IDs
  const lockedRingGradId = `halo-lr-${gem.id}-${uid}`;
  const lockedBloomId    = `halo-lb-${gem.id}-${uid}`;
  // Earned-state gradient IDs (used inline in ringSvg via -local convention)
  const ringGradId  = `halo-rg-${gem.id}-${uid}`;
  const coreGradId  = `halo-cg-${gem.id}-${uid}`;

  // ── Animation flags ────────────────────────────────────────────────────────
  const shouldAnimate = earned && !reduceMotion;
  const hasRotation   = shouldAnimate && rank >= 1; // rank 0 (first_light) is calm/static rays
  const hasBreathing  = shouldAnimate && rank >= LADDER.BREATHE_FROM;
  const hasCounterAnim = shouldAnimate && hasCounterRot;

  const rotateInterp = rotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  // Counter-rotation: opposite direction.
  const counterRotateInterp = counterRotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-360deg'],
  });

  // Core glow: a tiny scale that tracks the opacity pulse for a "breathing
  // light" feel (CORE_MIN opacity → CORE_SCALE_MIN, CORE_MAX → CORE_SCALE_MAX).
  const coreScaleInterp = coreAnim.interpolate({
    inputRange: [LADDER.CORE_MIN, LADDER.CORE_MAX],
    outputRange: [LADDER.CORE_SCALE_MIN, LADDER.CORE_SCALE_MAX],
  });

  // Sparkle twinkle "pop": dots scale up as they fade in (0 → 1 anim value).
  const sparkleScaleInterps = sparkleAnims.map((a) =>
    a.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 1.1, 0.6],
    })
  );

  // ── Accessibility ──────────────────────────────────────────────────────────
  const label = earned ? `${gem.name} halo, earned` : `${gem.name} halo, locked`;

  // ── LOCKED STATE ──────────────────────────────────────────────────────────
  // Not just grey: dark desaturated silhouette with a faint jewel-hued edge
  // and a whisper of glow to make it enticing.
  if (!earned) {
    const lockedContent = (
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        accessibilityLabel={label}
      >
        <Defs>
          {/* Very faint jewel-tinted bloom behind the ring */}
          <SvgRadialGradient id={lockedBloomId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%"   stopColor={pal.mid} stopOpacity="0.10" />
            <Stop offset="55%"  stopColor={pal.mid} stopOpacity="0.05" />
            <Stop offset="100%" stopColor={pal.mid} stopOpacity="0" />
          </SvgRadialGradient>
          {/* Jewel-tinted desaturated ring stroke */}
          <SvgLinearGradient id={lockedRingGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%"   stopColor={pal.mid}  stopOpacity="0.30" />
            <Stop offset="50%"  stopColor={pal.core} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={pal.mid}  stopOpacity="0.22" />
          </SvgLinearGradient>
        </Defs>

        {/* Faint bloom */}
        <Circle cx={cx} cy={cy} r={bloomR3} fill={`url(#${lockedBloomId})`} />

        {/* Two ghost rays — barely visible enticing hints */}
        {[0, Math.floor(rayCount / 2)].map((idx) => {
          const r = rayLines[idx];
          return (
            <Line
              key={idx}
              x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
              stroke={pal.mid}
              strokeWidth={Math.max(0.8, size * 0.018)}
              strokeOpacity={0.14}
              strokeLinecap="round"
            />
          );
        })}

        {/* Dark silhouette fill inside the ring */}
        <Circle
          cx={cx} cy={cy} r={ringR - ringStroke * 0.35}
          fill={colors.bg ?? '#18140e'}
          fillOpacity={0.88}
        />

        {/* Jewel-tinted ring outline — the enticing tease */}
        <Circle
          cx={cx} cy={cy} r={ringR}
          fill="none"
          stroke={`url(#${lockedRingGradId})`}
          strokeWidth={ringStroke}
          strokeOpacity={0.7}
        />
      </Svg>
    );

    if (onPress) {
      return (
        <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          {lockedContent}
        </Pressable>
      );
    }
    return lockedContent;
  }

  // ── Bloom layer SVG ────────────────────────────────────────────────────────
  // Base opacities are scaled by bloomMult (rank), then clamped so the top
  // halos read as a stronger glow without blowing out.
  const bloomOp = (base, cap) => Math.min(cap, base * bloomMult);
  const bloomSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outermost atmospheric bloom — largest, lowest opacity */}
      <Circle cx={cx} cy={cy} r={bloomR3} fill={pal.glow} fillOpacity={bloomOp(0.06, 0.12)} />
      {/* Mid bloom */}
      <Circle cx={cx} cy={cy} r={bloomR2} fill={pal.glow} fillOpacity={bloomOp(0.10, 0.20)} />
      {/* Inner bloom — tightest, most visible */}
      <Circle cx={cx} cy={cy} r={bloomR1} fill={pal.glow} fillOpacity={bloomOp(0.16, 0.30)} />
    </Svg>
  );

  // ── Ray SVG (used inside the rotating layer) ───────────────────────────────
  const raySvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rayLines.map((r, i) => (
        <Line
          key={i}
          x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
          stroke={r.isAlt ? pal.mid : pal.sheen}
          strokeWidth={r.isAlt
            ? Math.max(0.7, size * 0.016)
            : Math.max(0.9, size * 0.022)
          }
          strokeOpacity={r.isAlt ? 0.55 : 0.80}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );

  // ── Secondary ray SVG (interleaved layer, rank ≥ 5) ────────────────────────
  // Thinner, dimmer, jewel-glow rays interleaved between the primary rays. Empty
  // for ranks below SECONDARY_RING_FROM so lower halos pay nothing for it.
  const secondaryRaySvg = hasSecondary ? (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {secondaryRayLines.map((r, i) => (
        <Line
          key={i}
          x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
          stroke={pal.glow}
          strokeWidth={Math.max(0.6, size * 0.013)}
          strokeOpacity={0.45}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  ) : null;

  // ── Ring + core + shine SVG ────────────────────────────────────────────────
  const ringSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
         accessibilityLabel={label}>
      <Defs>
        {/* Dimensional ring gradient: bright sheen → jewel mid → deep shadow → mid */}
        <SvgLinearGradient id={ringGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%"   stopColor={pal.sheen} stopOpacity="0.95" />
          <Stop offset="25%"  stopColor={pal.mid}   stopOpacity="1" />
          <Stop offset="65%"  stopColor={pal.deep}  stopOpacity="1" />
          <Stop offset="100%" stopColor={pal.mid}   stopOpacity="0.9" />
        </SvgLinearGradient>
      </Defs>

      {/* Outer soft glow ring — slightly larger, very low opacity */}
      <Circle
        cx={cx} cy={cy} r={ringR + ringStroke * 0.7}
        fill="none"
        stroke={pal.glow}
        strokeWidth={ringStroke * 1.4}
        strokeOpacity={0.22}
      />

      {/* Main dimensional ring — the jewel tube */}
      <Circle
        cx={cx} cy={cy} r={ringR}
        fill="none"
        stroke={`url(#${ringGradId})`}
        strokeWidth={ringStroke}
        strokeOpacity={1}
      />

      {/* Inner bright ring — adds luminosity inside the tube */}
      <Circle
        cx={cx} cy={cy} r={ringR - ringStroke * 0.18}
        fill="none"
        stroke={pal.core}
        strokeWidth={innerRingStroke}
        strokeOpacity={0.55}
      />

      {/* Specular shine arc — short bright arc on the upper-left of the ring
          simulating a light source from the top-left. Drawn as a stroked circle
          with a dash offset so only the top ~80° is visible. */}
      <Circle
        cx={cx} cy={cy} r={ringR}
        fill="none"
        stroke={pal.core}
        strokeWidth={ringStroke * 0.55}
        strokeOpacity={0.70}
        strokeLinecap="round"
        strokeDasharray={`${ringR * 0.55} ${ringR * 10}`}
        strokeDashoffset={ringR * 0.28}
      />
    </Svg>
  );

  // ── Core lit-from-within glow SVG (own layer so it can pulse independently) ─
  const coreSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        {/* Core lit-from-within: near-white → jewel → transparent */}
        <SvgRadialGradient id={coreGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0%"   stopColor={pal.core} stopOpacity="0.90" />
          <Stop offset="35%"  stopColor={pal.mid}  stopOpacity="0.50" />
          <Stop offset="70%"  stopColor={pal.mid}  stopOpacity="0.12" />
          <Stop offset="100%" stopColor={pal.mid}  stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={ringR * 0.88} fill={`url(#${coreGradId})`} />
    </Svg>
  );

  // ── REDUCE MOTION — static premium render ─────────────────────────────────
  if (!shouldAnimate) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        {/* Bloom (rank-scaled opacity baked in) */}
        <View style={{ position: 'absolute', width: size, height: size }}>
          {bloomSvg}
        </View>
        {/* Secondary ray ring (high ranks only — keeps elaboration visible even
            with reduce motion on) */}
        {secondaryRaySvg && (
          <View style={{ position: 'absolute', width: size, height: size }}>
            {secondaryRaySvg}
          </View>
        )}
        {/* Rays */}
        <View style={{ position: 'absolute', width: size, height: size }}>
          {raySvg}
        </View>
        {/* Core glow (static) */}
        <View style={{ position: 'absolute', width: size, height: size }}>
          {coreSvg}
        </View>
        {/* Ring */}
        <View style={{ position: 'absolute', width: size, height: size }}>
          {ringSvg}
        </View>
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

  // ── ANIMATED render ────────────────────────────────────────────────────────
  // Layer stack (bottom → top):
  //   1. Bloom            — Animated.View (opacity pulse via glowAnim)
  //   2. Secondary rays   — Animated.View (COUNTER-rotation, high ranks only)
  //   3. Primary rays     — Animated.View (rotation transform, rank ≥ 1)
  //   4. Core glow        — Animated.View (opacity + tiny scale pulse)
  //   5. Ring             — Animated.View (breathing scale, rank ≥ 5)
  //   6. Sparkles         — Animated.View per dot (twinkle opacity + pop)

  const animated = (
    <View style={{ width: size, height: size }} accessibilityLabel={label}>

      {/* ── Layer 1: Atmospheric bloom (opacity pulse) ─────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: glowAnim }}
      >
        {bloomSvg}
      </Animated.View>

      {/* ── Layer 2: Secondary rays (rank ≥ 5; counter-rotate from rank 6) ──── */}
      {hasSecondary && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', width: size, height: size },
            hasCounterAnim && { transform: [{ rotate: counterRotateInterp }] },
          ]}
        >
          {secondaryRaySvg}
        </Animated.View>
      )}

      {/* ── Layer 3: Primary rays (rotation; rank ≥ 1) ─────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', width: size, height: size },
          hasRotation && { transform: [{ rotate: rotateInterp }] },
        ]}
      >
        {raySvg}
      </Animated.View>

      {/* ── Layer 4: Core glow (opacity + tiny scale pulse, offset from bloom) ─ */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          opacity: coreAnim,
          transform: [{ scale: coreScaleInterp }],
        }}
      >
        {coreSvg}
      </Animated.View>

      {/* ── Layer 5: Ring (breathing scale; rank ≥ 5) ─────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', width: size, height: size },
          hasBreathing && { transform: [{ scale: breatheAnim }] },
        ]}
      >
        {ringSvg}
      </Animated.View>

      {/* ── Layer 6: Sparkle dots (twinkling opacity + scale "pop") ───────── */}
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
            transform: [{ scale: sparkleScaleInterps[i] }],
          }}
        />
      ))}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        {animated}
      </Pressable>
    );
  }
  return animated;
}
