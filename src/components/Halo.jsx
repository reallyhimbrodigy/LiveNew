import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View } from 'react-native';
import Svg, {
  Circle,
  Polygon,
  Defs,
  RadialGradient as SvgRadialGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';
import { gemPalette, gemRank, maxGemRank } from '../domain/gems';

/**
 * Gem token — a faceted, brilliant-cut JEWEL (NOT a ring of light).
 *
 * This is the deliberate visual fork from AuraHalo: auras are ethereal,
 * iridescent RINGS of light; halos are solid, faceted GEMSTONES that catch the
 * light. Same metaphor as the data (the milestones are literally "gems"), and
 * unmistakably different from an aura so the two prestige tiers never read as
 * the same cheap token.
 *
 * Props (UNCHANGED — backward-compatible with every call site):
 *   gem      — a GEMS entry {id, name, day, tier, hue, flavor, ...}
 *   earned   — bool
 *   size     — default 56
 *   onPress  — optional
 *
 * The cut (top-down brilliant): a bright flat "table" in the centre, ringed by
 * an antiprism crown of triangular facets. Each facet is shaded by its angle to
 * a fixed top-left light, so the stone reads as a 3-D cut catching light — not a
 * flat disc. A specular glint travels the girdle; a soft jewel bloom pulses
 * behind it; sparkles twinkle at the rim.
 *
 * PROGRESSIVE LADDER (rank 0 first_light … 7 the_year), so same-tier pairs are
 * clearly distinct and each rung is richer than the last:
 *   • facet count       6 → 14   (more facets = more brilliant cut)
 *   • glint speed       slow drift → fast sweep
 *   • bloom breath      shallow/slow → deep/fast
 *   • breathing scale   unlocked at rank ≥ 5
 *   • sparkles          0 → 6
 *   • prismatic "fire"  rank 7 only — the table cross-fades through a rainbow
 *
 * Animation: all Animated.loop + useNativeDriver:true (opacity/transform only).
 * Easing.sin only (Easing.sine crashes RN). Loops stop on unmount and whenever
 * earned/reduceMotion/gem change. Reduce Motion → full static gem for the rank.
 * Correct at small (40-44) and large (120-140) sizes.
 */

// ── Ladder ramp constants ───────────────────────────────────────────────────
const LADDER = {
  FACETS_R0: 6,
  FACETS_R7: 14,

  // Bloom (jewel glow) opacity breath.
  GLOW_DUR_R0: 4200,
  GLOW_DUR_R7: 1900,
  GLOW_MIN_R0: 0.55,
  GLOW_MIN_R7: 0.34,
  GLOW_MAX:    1.0,

  // Specular glint travelling the girdle (ms per full lap).
  GLINT_DUR_R0: 9000,   // slow drift on the first gem
  GLINT_DUR_R7: 3000,   // fast sweep on the_year

  // Breathing scale (rank ≥ 5).
  BREATHE_FROM:   5,
  BREATHE_MIN:    1.0,
  BREATHE_MAX_R5: 1.03,
  BREATHE_MAX_R7: 1.055,
  BREATHE_DUR_R5: 3200,
  BREATHE_DUR_R7: 2400,

  // Sparkles.
  SPARKLES_R0: 0,
  SPARKLES_R7: 6,
  SPARKLE_DUR: 950,
  SPARKLE_STAGGER: 140,

  // Prismatic table cross-fade (the_year only).
  PRISM_RANK: 7,
  PRISM_DUR:  2600,
};

const MAX_SPARKLE = 6;

// ── Small helpers ────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;

function progT(rank) {
  const max = maxGemRank() || 1;
  const r = Math.max(0, Math.min(max, rank));
  return r / max;
}

function hexToRgb(h) {
  if (typeof h !== 'string') return { r: 255, g: 255, b: 255 };
  const m = h.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const i = parseInt(n, 16);
  if (Number.isNaN(i)) return { r: 255, g: 255, b: 255 };
  return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255 };
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = Math.round(A.r + (B.r - A.r) * t);
  const g = Math.round(A.g + (B.g - A.g) * t);
  const bl = Math.round(A.b + (B.b - A.b) * t);
  return `rgb(${r},${g},${bl})`;
}

function facetCountForRank(rank) {
  const t = progT(rank);
  let n = Math.round(lerp(LADDER.FACETS_R0, LADDER.FACETS_R7, t));
  if (n % 2 !== 0) n += 1; // even reads as a more symmetric cut
  return Math.max(6, Math.min(14, n));
}
function sparkleCountForRank(rank) {
  const t = progT(rank);
  return Math.max(0, Math.min(MAX_SPARKLE, Math.round(lerp(LADDER.SPARKLES_R0, LADDER.SPARKLES_R7, t))));
}

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Animated values ────────────────────────────────────────────────────────
  const glintAnim   = useRef(new Animated.Value(0)).current;
  const glowAnim    = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const prismAnim   = useRef(new Animated.Value(0)).current; // 0=base table, 1=prism table
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

    const rank = gemRank(gem);
    const t = progT(rank);
    const loops = [];

    // Jewel bloom pulse — deeper + faster breath as rank climbs.
    const glowDur = Math.round(lerp(LADDER.GLOW_DUR_R0, LADDER.GLOW_DUR_R7, t));
    const glowMin = lerp(LADDER.GLOW_MIN_R0, LADDER.GLOW_MIN_R7, t);
    glowAnim.setValue(LADDER.GLOW_MAX);
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: glowMin, duration: glowDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: LADDER.GLOW_MAX, duration: glowDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    glowLoop.start();
    loops.push(glowLoop);

    // Specular glint travels the girdle. The gem body is static (a solid jewel);
    // only the highlight orbits — light playing across the stone, NOT the stone
    // spinning. That's the key motion difference from the rotating aura ring.
    const glintDur = Math.round(lerp(LADDER.GLINT_DUR_R0, LADDER.GLINT_DUR_R7, t));
    glintAnim.setValue(0);
    const glintLoop = Animated.loop(
      Animated.timing(glintAnim, { toValue: 1, duration: glintDur, easing: Easing.linear, useNativeDriver: true })
    );
    glintLoop.start();
    loops.push(glintLoop);

    // Breathing scale (rank ≥ 5).
    if (rank >= LADDER.BREATHE_FROM) {
      const max = maxGemRank() || 1;
      const tBr = (rank - LADDER.BREATHE_FROM) / Math.max(1, max - LADDER.BREATHE_FROM);
      const breatheMax = lerp(LADDER.BREATHE_MAX_R5, LADDER.BREATHE_MAX_R7, tBr);
      const breatheDur = Math.round(lerp(LADDER.BREATHE_DUR_R5, LADDER.BREATHE_DUR_R7, tBr));
      breatheAnim.setValue(LADDER.BREATHE_MIN);
      const breatheLoop = Animated.loop(Animated.sequence([
        Animated.timing(breatheAnim, { toValue: breatheMax, duration: breatheDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breatheAnim, { toValue: LADDER.BREATHE_MIN, duration: breatheDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      breatheLoop.start();
      loops.push(breatheLoop);
    } else {
      breatheAnim.setValue(LADDER.BREATHE_MIN);
    }

    // Prismatic table "fire" — the_year only: the flat top cross-fades through a
    // rainbow, so the apex gem shimmers with shifting colour the others can't.
    if (rank >= LADDER.PRISM_RANK) {
      prismAnim.setValue(0);
      const prismLoop = Animated.loop(Animated.sequence([
        Animated.timing(prismAnim, { toValue: 1, duration: LADDER.PRISM_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(prismAnim, { toValue: 0, duration: LADDER.PRISM_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      prismLoop.start();
      loops.push(prismLoop);
    } else {
      prismAnim.setValue(0);
    }

    // Sparkles.
    const sparkleCount = sparkleCountForRank(rank);
    sparkleAnims.slice(0, sparkleCount).forEach((anim, i) => {
      anim.setValue(0);
      const sparkleLoop = Animated.loop(Animated.sequence([
        Animated.delay(i * LADDER.SPARKLE_STAGGER),
        Animated.timing(anim, { toValue: 1, duration: LADDER.SPARKLE_DUR, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: LADDER.SPARKLE_DUR, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      sparkleLoop.start();
      loops.push(sparkleLoop);
    });
    sparkleAnims.slice(sparkleCount).forEach((anim) => anim.setValue(0));

    loopRefs.current = loops;
    return () => { loops.forEach((l) => l.stop()); };
  }, [earned, reduceMotion, gem?.id]);

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loopRefs.current.forEach((l) => l.stop());
    };
  }, []);

  if (!gem) return null;

  // ── Palette + progression ──────────────────────────────────────────────────
  const pal  = gemPalette(gem);
  const rank = gemRank(gem);
  const t    = progT(rank);
  const isPrism = rank >= LADDER.PRISM_RANK;

  const cx = size / 2;
  const cy = size / 2;
  const R  = size * 0.40;          // girdle (outer) radius
  const rT = R * 0.50;             // table (flat top) radius
  const N  = facetCountForRank(rank);

  // Light comes from the top-left; facets facing it are brightest.
  const LIGHT = -Math.PI * 0.75;

  // Girdle + table vertices (table rotated half a step → brilliant kite facets).
  const girdle = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * i) / N - Math.PI / 2;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
  });
  const table = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * (i + 0.5)) / N - Math.PI / 2;
    return { x: cx + Math.cos(a) * rT, y: cy + Math.sin(a) * rT };
  });

  const ptStr = (pts) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  // Crown facets — the antiprism band between table and girdle. Two triangle
  // families perfectly tile the ring; each shaded by its centroid's angle to
  // the light so the cut reads as 3-D.
  const facetFill = (cxx, cyy) => {
    const ang = Math.atan2(cyy - cy, cxx - cx);
    const b = 0.5 + 0.5 * Math.cos(ang - LIGHT); // 0 (shadow) .. 1 (lit)
    return b < 0.5 ? mix(pal.deep, pal.mid, b * 2) : mix(pal.mid, pal.sheen, (b - 0.5) * 2);
  };
  const facets = [];
  for (let i = 0; i < N; i++) {
    const Gi = girdle[i], Gi1 = girdle[(i + 1) % N];
    const Ti = table[i],  Ti1 = table[(i + 1) % N];
    // outer-scallop facet (apex inward at table vertex Ti)
    let c1x = (Gi.x + Gi1.x + Ti.x) / 3, c1y = (Gi.y + Gi1.y + Ti.y) / 3;
    facets.push({ pts: ptStr([Gi, Gi1, Ti]), fill: facetFill(c1x, c1y) });
    // inner-scallop facet (apex outward at girdle vertex Gi1)
    let c2x = (Ti.x + Ti1.x + Gi1.x) / 3, c2y = (Ti.y + Ti1.y + Gi1.y) / 3;
    facets.push({ pts: ptStr([Ti, Ti1, Gi1]), fill: facetFill(c2x, c2y) });
  }

  // Glint position travels the girdle just outside the rim.
  const glintR = R * 0.96;
  const glintSize = Math.max(2.5, size * 0.07);

  // Sparkle dot positions — sit just outside the girdle vertices.
  const sparkleCount = sparkleCountForRank(rank);
  const sparkleSize  = Math.max(2, size * 0.044);
  const sparkleOrbitR = Math.min(R + sparkleSize * 1.1, size * 0.5 - sparkleSize);
  const prism = pal.prism;
  const sparkleDots = Array.from({ length: sparkleCount }, (_, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, sparkleCount) - Math.PI / 2 + 0.18;
    const color = (isPrism && Array.isArray(prism) && prism.length)
      ? prism[i % prism.length]
      : (i % 2 === 0 ? pal.core : pal.sheen);
    return { x: cx + Math.cos(a) * sparkleOrbitR, y: cy + Math.sin(a) * sparkleOrbitR, color };
  });

  const uid = React.useId().replace(/:/g, '');
  const bloomId = `gem-bloom-${gem.id}-${uid}`;
  const tableId = `gem-table-${gem.id}-${uid}`;
  const tablePrismId = `gem-tableP-${gem.id}-${uid}`;
  const glintId = `gem-glint-${gem.id}-${uid}`;

  const label = earned ? `${gem.name} gem, earned` : `${gem.name} gem, locked`;

  // ── LOCKED STATE — dark faceted silhouette with a faint jewel tease ─────────
  if (!earned) {
    const lockedContent = (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
        <Defs>
          <SvgRadialGradient id={bloomId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={pal.mid} stopOpacity="0.10" />
            <Stop offset="60%" stopColor={pal.mid} stopOpacity="0.04" />
            <Stop offset="100%" stopColor={pal.mid} stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={R * 1.25} fill={`url(#${bloomId})`} />
        {/* faceted silhouette */}
        <Polygon points={ptStr(girdle)} fill={colors.bg ?? '#18140e'} fillOpacity={0.9} />
        {facets.map((f, i) => (
          <Polygon key={i} points={f.pts} fill={pal.mid} fillOpacity={0.07} />
        ))}
        {/* faint girdle outline + table — the enticing tease */}
        <Polygon points={ptStr(girdle)} fill="none" stroke={pal.mid} strokeOpacity={0.35} strokeWidth={Math.max(1, size * 0.02)} />
        <Polygon points={ptStr(table)} fill={pal.mid} fillOpacity={0.06} stroke={pal.core} strokeOpacity={0.12} strokeWidth={Math.max(0.6, size * 0.01)} />
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

  // ── Jewel bloom (pulses behind the stone) ──────────────────────────────────
  const bloomMult = lerp(0.85, 1.5, t);
  const bloomSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={bloomId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%"   stopColor={pal.glow} stopOpacity={Math.min(0.5, 0.30 * bloomMult)} />
          <Stop offset="45%"  stopColor={pal.glow} stopOpacity={Math.min(0.22, 0.14 * bloomMult)} />
          <Stop offset="100%" stopColor={pal.glow} stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={R * 1.35} fill={`url(#${bloomId})`} />
    </Svg>
  );

  // ── The gem body (static facets) + table ───────────────────────────────────
  const gemBodySvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
      <Defs>
        <SvgRadialGradient id={tableId} cx="37%" cy="30%" r="60%">
          <Stop offset="0%"   stopColor={pal.core}  stopOpacity="0.92" />
          <Stop offset="30%"  stopColor={pal.sheen} stopOpacity="0.92" />
          <Stop offset="100%" stopColor={pal.mid}   stopOpacity="0.95" />
        </SvgRadialGradient>
      </Defs>

      {/* Crown facets — angle-shaded for the 3-D cut */}
      {facets.map((f, i) => (
        <Polygon key={i} points={f.pts} fill={f.fill} fillOpacity={0.98} />
      ))}

      {/* Thin facet seams (girdle) to crisp the edges */}
      <Polygon points={ptStr(girdle)} fill="none" stroke={pal.deep} strokeOpacity={0.5} strokeWidth={Math.max(0.5, size * 0.008)} strokeLinejoin="round" />

      {/* The bright flat table (catches the most light) */}
      <Polygon points={ptStr(table)} fill={`url(#${tableId})`} stroke={pal.core} strokeOpacity={0.5} strokeWidth={Math.max(0.5, size * 0.008)} strokeLinejoin="round" />

      {/* Crisp luminous girdle outline */}
      <Polygon points={ptStr(girdle)} fill="none" stroke={pal.sheen} strokeOpacity={0.55} strokeWidth={Math.max(0.8, size * 0.014)} strokeLinejoin="round" />
    </Svg>
  );

  // Prismatic table overlay (the_year) — cross-faded on top of the base table.
  const prismTableSvg = isPrism ? (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={tablePrismId} cx="42%" cy="38%" r="68%">
          <Stop offset="0%"   stopColor={(prism && prism[0]) || pal.core} stopOpacity="0.95" />
          <Stop offset="45%"  stopColor={(prism && prism[2]) || pal.sheen} stopOpacity="0.85" />
          <Stop offset="100%" stopColor={(prism && prism[3]) || pal.mid} stopOpacity="0.7" />
        </SvgRadialGradient>
      </Defs>
      <Polygon points={ptStr(table)} fill={`url(#${tablePrismId})`} />
    </Svg>
  ) : null;

  // Glint highlight (a soft bright spark at the top of the girdle; the wrapping
  // layer rotates so it travels the rim).
  const glintSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={glintId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%"   stopColor={pal.core} stopOpacity="0.95" />
          <Stop offset="55%"  stopColor={pal.sheen} stopOpacity="0.45" />
          <Stop offset="100%" stopColor={pal.sheen} stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy - glintR} r={glintSize} fill={`url(#${glintId})`} />
    </Svg>
  );

  const shouldAnimate = earned && !reduceMotion;
  const glintRotate = glintAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const sparkleScaleInterps = sparkleAnims.map((a) =>
    a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1.1, 0.5] })
  );

  // ── STATIC (reduce motion) ─────────────────────────────────────────────────
  if (!shouldAnimate) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <View style={{ position: 'absolute', width: size, height: size }}>{bloomSvg}</View>
        <View style={{ position: 'absolute', width: size, height: size }}>{gemBodySvg}</View>
        {prismTableSvg ? <View style={{ position: 'absolute', width: size, height: size, opacity: 0.5 }}>{prismTableSvg}</View> : null}
        <View style={{ position: 'absolute', width: size, height: size }}>{glintSvg}</View>
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

  // ── ANIMATED ───────────────────────────────────────────────────────────────
  const animated = (
    <View style={{ width: size, height: size }} accessibilityLabel={label}>
      {/* Jewel bloom (opacity pulse) */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, opacity: glowAnim }}>
        {bloomSvg}
      </Animated.View>

      {/* Gem body + table (breathing scale at high ranks) */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, { transform: [{ scale: breatheAnim }] }]}>
        {gemBodySvg}
        {/* Prismatic table cross-fade (the_year) */}
        {prismTableSvg ? (
          <Animated.View style={{ position: 'absolute', width: size, height: size, opacity: prismAnim }}>
            {prismTableSvg}
          </Animated.View>
        ) : null}
      </Animated.View>

      {/* Travelling glint */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, transform: [{ rotate: glintRotate }] }}>
        {glintSvg}
      </Animated.View>

      {/* Sparkles */}
      {sparkleDots.map((dot, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: sparkleSize, height: sparkleSize, borderRadius: sparkleSize,
            backgroundColor: dot.color,
            left: dot.x - sparkleSize / 2, top: dot.y - sparkleSize / 2,
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
