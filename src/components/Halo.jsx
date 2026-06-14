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
import { gemPalette } from '../domain/gems';

/**
 * Radiant halo token — premium redesign with luminous depth.
 *
 * Props (UNCHANGED — backward-compatible):
 *   gem      — a GEMS entry {id, name, day, tier, rarityPct, hue, flavor}
 *   earned   — bool
 *   size     — default 56
 *   onPress  — optional
 *
 * Visual model (bottom → top for earned halos):
 *   1. Atmospheric bloom  — 3 translucent radial-gradient circles at increasing
 *      radii giving a "glow from within" depth effect.
 *   2. Rays layer         — gradient rays (bright near ring → fade) + slow rotation
 *      for Epic/Legendary/Mythic. Varied lengths for Legendary/Mythic.
 *   3. Ring layer         — dimensional ring filled with a 4-stop gradient:
 *      bright sheen highlight → jewel mid → deep shadow → highlight arc.
 *      An inner bright ring adds more luminosity.
 *   4. Core glow          — a small radial gradient (near-white → jewel color →
 *      transparent) over the ring center for a lit-from-within look.
 *   5. Shine arc          — a soft specular highlight arc on the top of the ring.
 *   6. Sparkle dots       — twinkling small dots at various orbit radii.
 *
 * Locked state: NOT plain grey — a dark silhouette with a faint hint of the
 * gem's jewel color. The ring has a low-opacity jewel-colored stroke, a few
 * ghost rays, and a subtle inner glow, making it feel like a tantalizing tease.
 *
 * Animation:
 *   - All Animated.loop + useNativeDriver: true (transform + opacity only).
 *   - Loop refs are stopped on unmount and on earned/reduceMotion changes.
 *   - Reduce Motion → static, but still the full premium visual.
 *   - Sparkle twinkles start at Common (2 dots) and scale up by tier.
 */

// ── Animation constants ───────────────────────────────────────────────────────
const ANIM = {
  // Glow pulse — breathing opacity range and duration per tier
  COMMON_GLOW_DUR:    4000,
  UNCOMMON_GLOW_DUR:  3200,
  RARE_GLOW_DUR:      2800,
  EPIC_GLOW_DUR:      2600,
  LEGENDARY_GLOW_DUR: 2200,
  MYTHIC_GLOW_DUR:    2000,
  GLOW_MIN: 0.5,
  GLOW_MAX: 1.0,

  // Ray rotation (ms per full revolution)
  UNCOMMON_ROT_DUR:  42000,
  RARE_ROT_DUR:      32000,
  EPIC_ROT_DUR:      22000,
  LEGENDARY_ROT_DUR: 15000,
  MYTHIC_ROT_DUR:    10000,

  // Breathing scale
  LEGENDARY_BREATHE_MIN: 1.0,
  LEGENDARY_BREATHE_MAX: 1.032,
  LEGENDARY_BREATHE_DUR: 3000,
  MYTHIC_BREATHE_MIN:    1.0,
  MYTHIC_BREATHE_MAX:    1.044,
  MYTHIC_BREATHE_DUR:    2600,

  // Sparkle (dot count per tier, duration, stagger)
  SPARKLE_DUR:     900,
  SPARKLE_STAGGER: 130,
};

// Sparkle dot counts per tier
const SPARKLE_COUNTS = {
  Common:    2,
  Uncommon:  3,
  Rare:      4,
  Epic:      5,
  Legendary: 6,
  Mythic:    8,
};

// Ray counts and base lengths per tier
const TIER_CONFIG = {
  Common:    { rays: 8,  rayLenFrac: 0.13, altLen: false },
  Uncommon:  { rays: 10, rayLenFrac: 0.145, altLen: false },
  Rare:      { rays: 12, rayLenFrac: 0.155, altLen: false },
  Epic:      { rays: 14, rayLenFrac: 0.165, altLen: true },
  Legendary: { rays: 16, rayLenFrac: 0.18,  altLen: true },
  Mythic:    { rays: 20, rayLenFrac: 0.20,  altLen: true },
};

// Max sparkle count (for stable Animated.Value array)
const MAX_SPARKLE = 8;

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Animated values ────────────────────────────────────────────────────────
  const rotAnim     = useRef(new Animated.Value(0)).current;
  const glowAnim    = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
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

    const tier = gem.tier;
    const loops = [];

    // Glow pulse — all earned tiers breathe, just at different speeds
    const glowDur = (
      tier === 'Common'    ? ANIM.COMMON_GLOW_DUR    :
      tier === 'Uncommon'  ? ANIM.UNCOMMON_GLOW_DUR  :
      tier === 'Rare'      ? ANIM.RARE_GLOW_DUR      :
      tier === 'Epic'      ? ANIM.EPIC_GLOW_DUR      :
      tier === 'Legendary' ? ANIM.LEGENDARY_GLOW_DUR :
      /* Mythic */           ANIM.MYTHIC_GLOW_DUR
    );
    glowAnim.setValue(ANIM.GLOW_MAX);
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: ANIM.GLOW_MIN,
          duration: glowDur,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: ANIM.GLOW_MAX,
          duration: glowDur,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
      ])
    );
    glowLoop.start();
    loops.push(glowLoop);

    // Ray rotation — Uncommon and above
    const rotDur = (
      tier === 'Uncommon'  ? ANIM.UNCOMMON_ROT_DUR  :
      tier === 'Rare'      ? ANIM.RARE_ROT_DUR      :
      tier === 'Epic'      ? ANIM.EPIC_ROT_DUR      :
      tier === 'Legendary' ? ANIM.LEGENDARY_ROT_DUR :
      tier === 'Mythic'    ? ANIM.MYTHIC_ROT_DUR    : 0
    );
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
      loops.push(rotLoop);
    }

    // Breathing scale — Legendary and Mythic
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
      loops.push(breatheLoop);
    }

    // Sparkle twinkles — all tiers, count increases by tier
    const sparkleCount = SPARKLE_COUNTS[tier] ?? 2;
    sparkleAnims.slice(0, sparkleCount).forEach((anim, i) => {
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
    // Ensure unused sparkle anims stay at 0
    sparkleAnims.slice(sparkleCount).forEach((anim) => anim.setValue(0));

    loopRefs.current = loops;
    return () => {
      loops.forEach((l) => l.stop());
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

  // ── Palette + geometry ─────────────────────────────────────────────────────
  const pal = gemPalette(gem);
  const tier = gem.tier;
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.Common;

  const cx = size / 2;
  const cy = size / 2;

  const ringR           = size * 0.30;
  const ringStroke      = Math.max(2.0, size * 0.052);
  const innerRingStroke = Math.max(0.8, size * 0.016);

  // Atmospheric bloom radii (3 layers)
  const bloomR1 = size * 0.30;
  const bloomR2 = size * 0.40;
  const bloomR3 = size * 0.50;

  // Ray geometry — alternate long/short for higher tiers
  const rayInnerR = ringR + ringStroke * 0.5;
  const baseLen   = size * config.rayLenFrac;
  const rayLines = Array.from({ length: config.rays }, (_, i) => {
    const angle  = (2 * Math.PI * i) / config.rays - Math.PI / 2;
    const isAlt  = config.altLen && i % 2 === 1;
    const rayLen = isAlt ? baseLen * 0.62 : baseLen;
    return {
      x1: cx + Math.cos(angle) * rayInnerR,
      y1: cy + Math.sin(angle) * rayInnerR,
      x2: cx + Math.cos(angle) * (rayInnerR + rayLen),
      y2: cy + Math.sin(angle) * (rayInnerR + rayLen),
      isAlt,
    };
  });

  // Sparkle dot positions — orbit slightly beyond the farthest ray tips
  const sparkleCount = SPARKLE_COUNTS[tier] ?? 2;
  const sparkleOrbitR = rayInnerR + baseLen + size * 0.045;
  const sparkleSize   = Math.max(2, size * 0.046);
  const sparkleDots   = Array.from({ length: sparkleCount }, (_, i) => {
    // Distribute at slightly irregular angles for organic feel
    const baseAngle = (2 * Math.PI * i) / sparkleCount - Math.PI / 2;
    const jitter    = (i % 3 === 0 ? 0.08 : i % 3 === 1 ? -0.05 : 0.12);
    const angle     = baseAngle + jitter;
    return {
      x: cx + Math.cos(angle) * sparkleOrbitR,
      y: cy + Math.sin(angle) * sparkleOrbitR,
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
  const hasRotation   = shouldAnimate && tier !== 'Common';
  const hasBreathing  = shouldAnimate && (tier === 'Legendary' || tier === 'Mythic');
  const hasSparkle    = shouldAnimate;

  const rotateInterp = rotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

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
        {[0, Math.floor(config.rays / 2)].map((idx) => {
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
  const bloomSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outermost atmospheric bloom — largest, lowest opacity */}
      <Circle cx={cx} cy={cy} r={bloomR3} fill={pal.glow} fillOpacity={0.06} />
      {/* Mid bloom */}
      <Circle cx={cx} cy={cy} r={bloomR2} fill={pal.glow} fillOpacity={0.10} />
      {/* Inner bloom — tightest, most visible */}
      <Circle cx={cx} cy={cy} r={bloomR1} fill={pal.glow} fillOpacity={0.16} />
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
        {/* Core lit-from-within: near-white → jewel → transparent */}
        <SvgRadialGradient id={coreGradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0%"   stopColor={pal.core} stopOpacity="0.90" />
          <Stop offset="35%"  stopColor={pal.mid}  stopOpacity="0.50" />
          <Stop offset="70%"  stopColor={pal.mid}  stopOpacity="0.12" />
          <Stop offset="100%" stopColor={pal.mid}  stopOpacity="0" />
        </SvgRadialGradient>
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

      {/* Core lit-from-within glow — radial gradient over the ring center */}
      <Circle
        cx={cx} cy={cy} r={ringR * 0.88}
        fill={`url(#${coreGradId})`}
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

  // ── REDUCE MOTION — static premium render ─────────────────────────────────
  if (!shouldAnimate) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        {/* Bloom */}
        <View style={{ position: 'absolute', width: size, height: size }}>
          {bloomSvg}
        </View>
        {/* Rays */}
        <View style={{ position: 'absolute', width: size, height: size }}>
          {raySvg}
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
  //   1. Bloom       — Animated.View (opacity pulse via glowAnim)
  //   2. Rays        — Animated.View (rotation transform)
  //   3. Ring/core   — Animated.View (breathing scale for Legend/Mythic)
  //   4. Sparkles    — Animated.View per dot (twinkle opacity)

  const animated = (
    <View style={{ width: size, height: size }} accessibilityLabel={label}>

      {/* ── Layer 1: Atmospheric bloom (opacity pulse) ─────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, opacity: glowAnim }}
      >
        {bloomSvg}
      </Animated.View>

      {/* ── Layer 2: Rays (rotation) ───────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', width: size, height: size },
          hasRotation && { transform: [{ rotate: rotateInterp }] },
        ]}
      >
        {raySvg}
      </Animated.View>

      {/* ── Layer 3: Ring + core (breathing scale) ────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', width: size, height: size },
          hasBreathing && { transform: [{ scale: breatheAnim }] },
        ]}
      >
        {ringSvg}
      </Animated.View>

      {/* ── Layer 4: Sparkle dots (twinkling) ────────────────────────────── */}
      {sparkleDots.map((dot, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width:        sparkleSize,
            height:       sparkleSize,
            borderRadius: sparkleSize,
            backgroundColor: i % 2 === 0 ? pal.core : pal.sheen,
            left: dot.x - sparkleSize / 2,
            top:  dot.y - sparkleSize / 2,
            opacity: sparkleAnims[i],
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
