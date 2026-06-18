import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View } from 'react-native';
import Svg, {
  Circle,
  Ellipse,
  Polygon,
  Line,
  Defs,
  RadialGradient as SvgRadialGradient,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';
import { gemPalette, gemRank, maxGemRank } from '../domain/gems';

/**
 * Gem token — a real, front-view faceted GEMSTONE (table + crown + a pointed
 * pavilion that fans to a culet), glowing and animated. NOT a flat disc, and
 * unmistakably different from the auras' rings of light.
 *
 * Props (UNCHANGED — backward-compatible with every call site):
 *   gem      — a GEMS entry {id, name, day, tier, hue, flavor, ...}
 *   earned   — bool
 *   size     — default 56
 *   onPress  — optional
 *
 * Each gem gets its own CUT (round / pear / marquise / emerald) so they're
 * slightly different shapes, and the rarer the gem the cooler it looks:
 *   • pavilion facets   4 → 10
 *   • aura bloom        shallow → deep, slow → fast pulse
 *   • breathing scale   gentle → pronounced
 *   • sparkles          1 → 6, plus a glint that falls through the stone
 *   • prismatic fire    the apex gem (the_year) shifts through a rainbow
 *
 * Animation: Animated.loop + useNativeDriver:true (opacity/transform only).
 * Easing.sin only. Loops stop on unmount / when earned|reduceMotion|gem change.
 */

const LADDER = {
  // Pavilion facets across (more = more brilliant cut).
  FACETS_R0: 4,
  FACETS_R7: 10,
  // Aura bloom opacity breath.
  GLOW_DUR_R0: 4200, GLOW_DUR_R7: 1900,
  GLOW_MIN_R0: 0.55, GLOW_MIN_R7: 0.32, GLOW_MAX: 1.0,
  // Gentle breathing scale (all ranks; amplitude grows with rank).
  BREATHE_MIN: 1.0, BREATHE_MAX_R0: 1.02, BREATHE_MAX_R7: 1.055,
  BREATHE_DUR_R0: 3800, BREATHE_DUR_R7: 2400,
  // Falling glint (a bright spark travelling table → culet).
  GLINT_FROM: 2,           // rank ≥ this gets the glint
  GLINT_DUR_R2: 3200, GLINT_DUR_R7: 1700,
  // Sparkles.
  SPARKLES_R0: 1, SPARKLES_R7: 6, SPARKLE_DUR: 900, SPARKLE_STAGGER: 130,
  // Prismatic table fire (the_year only).
  PRISM_RANK: 7, PRISM_DUR: 2600,
};
const MAX_SPARKLE = 6;

// Cut profiles — wf/hf are fractions of `size`, twf = table half / girdle half.
const CUTS = {
  round:    { wf: 0.42, hf: 0.80, twf: 0.50 },
  pear:     { wf: 0.40, hf: 0.88, twf: 0.46 },
  marquise: { wf: 0.30, hf: 0.94, twf: 0.42 },
  emerald:  { wf: 0.40, hf: 0.78, twf: 0.74 },
};
function cutForRank(rank) {
  // Variety across the eight, rarer ones distinct. Apex = round brilliant.
  return (['round', 'round', 'pear', 'pear', 'marquise', 'marquise', 'emerald', 'round'][
    Math.max(0, Math.min(7, rank))
  ]) || 'round';
}

const lerp = (a, b, t) => a + (b - a) * t;
function progT(rank) {
  const max = maxGemRank() || 1;
  return Math.max(0, Math.min(max, rank)) / max;
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
  return `rgb(${Math.round(A.r + (B.r - A.r) * t)},${Math.round(A.g + (B.g - A.g) * t)},${Math.round(A.b + (B.b - A.b) * t)})`;
}
function facetKForRank(rank) {
  const t = progT(rank);
  return Math.max(4, Math.min(10, Math.round(lerp(LADDER.FACETS_R0, LADDER.FACETS_R7, t))));
}
function sparkleCountForRank(rank) {
  const t = progT(rank);
  return Math.max(1, Math.min(MAX_SPARKLE, Math.round(lerp(LADDER.SPARKLES_R0, LADDER.SPARKLES_R7, t))));
}

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  const glowAnim    = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const glintAnim   = useRef(new Animated.Value(0)).current; // 0=table .. 1=culet
  const prismAnim   = useRef(new Animated.Value(0)).current;
  const sparkleAnims = useRef(Array.from({ length: MAX_SPARKLE }, () => new Animated.Value(0))).current;
  const loopRefs = useRef([]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled && mountedRef.current) setReduceMotion(on);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loopRefs.current.forEach((l) => l.stop());
    loopRefs.current = [];
    if (!earned || reduceMotion) return;

    const rank = gemRank(gem);
    const t = progT(rank);
    const loops = [];

    // Aura bloom pulse.
    const glowDur = Math.round(lerp(LADDER.GLOW_DUR_R0, LADDER.GLOW_DUR_R7, t));
    const glowMin = lerp(LADDER.GLOW_MIN_R0, LADDER.GLOW_MIN_R7, t);
    glowAnim.setValue(LADDER.GLOW_MAX);
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: glowMin, duration: glowDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: LADDER.GLOW_MAX, duration: glowDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    glowLoop.start(); loops.push(glowLoop);

    // Gentle breathing (all ranks; bigger as rank climbs).
    const breatheMax = lerp(LADDER.BREATHE_MAX_R0, LADDER.BREATHE_MAX_R7, t);
    const breatheDur = Math.round(lerp(LADDER.BREATHE_DUR_R0, LADDER.BREATHE_DUR_R7, t));
    breatheAnim.setValue(LADDER.BREATHE_MIN);
    const breatheLoop = Animated.loop(Animated.sequence([
      Animated.timing(breatheAnim, { toValue: breatheMax, duration: breatheDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breatheAnim, { toValue: LADDER.BREATHE_MIN, duration: breatheDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    breatheLoop.start(); loops.push(breatheLoop);

    // Falling glint (rank ≥ GLINT_FROM).
    if (rank >= LADDER.GLINT_FROM) {
      const glintDur = Math.round(lerp(LADDER.GLINT_DUR_R2, LADDER.GLINT_DUR_R7, t));
      glintAnim.setValue(0);
      const glintLoop = Animated.loop(Animated.sequence([
        Animated.timing(glintAnim, { toValue: 1, duration: glintDur, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(glintDur * 0.6),
      ]));
      glintLoop.start(); loops.push(glintLoop);
    }

    // Prismatic fire (apex gem).
    if (rank >= LADDER.PRISM_RANK) {
      prismAnim.setValue(0);
      const prismLoop = Animated.loop(Animated.sequence([
        Animated.timing(prismAnim, { toValue: 1, duration: LADDER.PRISM_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(prismAnim, { toValue: 0, duration: LADDER.PRISM_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      prismLoop.start(); loops.push(prismLoop);
    } else {
      prismAnim.setValue(0);
    }

    // Sparkle twinkles.
    const sc = sparkleCountForRank(rank);
    sparkleAnims.slice(0, sc).forEach((anim, i) => {
      anim.setValue(0);
      const sparkleLoop = Animated.loop(Animated.sequence([
        Animated.delay(i * LADDER.SPARKLE_STAGGER),
        Animated.timing(anim, { toValue: 1, duration: LADDER.SPARKLE_DUR, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: LADDER.SPARKLE_DUR, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      sparkleLoop.start(); loops.push(sparkleLoop);
    });
    sparkleAnims.slice(sc).forEach((a) => a.setValue(0));

    loopRefs.current = loops;
    return () => loops.forEach((l) => l.stop());
  }, [earned, reduceMotion, gem?.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; loopRefs.current.forEach((l) => l.stop()); };
  }, []);

  if (!gem) return null;

  // ── Palette + progression ──────────────────────────────────────────────────
  const pal  = gemPalette(gem);
  const rank = gemRank(gem);
  const t    = progT(rank);
  const isPrism = rank >= LADDER.PRISM_RANK;
  const prism = pal.prism;

  // ── Gem geometry (front-view brilliant) ────────────────────────────────────
  const cut = isPrism ? 'round' : cutForRank(rank);
  const C  = CUTS[cut] || CUTS.round;
  const cx = size / 2, cy = size / 2;
  const W  = size * C.wf;           // girdle half-width
  const Hh = size * C.hf;           // total height
  const tw = W * C.twf;             // table half-width
  const gw = W;
  const yTable  = cy - Hh * 0.42;
  const yGirdle = cy - Hh * 0.12;
  const yCulet  = cy + Hh * 0.46;
  const K = facetKForRank(rank);

  const girdle = Array.from({ length: K + 1 }, (_, i) => ({ x: cx - gw + 2 * gw * (i / K), y: yGirdle }));
  const culet  = { x: cx, y: yCulet };
  const tableL = { x: cx - tw, y: yTable }, tableR = { x: cx + tw, y: yTable };
  const toTX = (gx) => { const f = (gx - cx) / gw; return cx + Math.max(-tw, Math.min(tw, f * tw * 1.05)); };

  const ptStr = (pts) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  // Shading: left-lit directional, pavilion facets alternate bright/dark so the
  // cut sparkles. Shadows pushed toward black for dramatic, rocky depth.
  const facetDeep = mix(pal.deep, '#000000', 0.34);
  const shade = (x, alt) => {
    let b = 0.5 + 0.45 * ((cx - x) / gw);
    b = Math.max(0, Math.min(1, b));
    if (alt) b = Math.max(0, Math.min(1, b * 0.55 + (alt > 0 ? 0.4 : 0)));
    if (b < 0.34) return mix(facetDeep, pal.mid, b / 0.34);
    if (b < 0.66) return mix(pal.mid, pal.sheen, (b - 0.34) / 0.32);
    return mix(pal.sheen, pal.core, (b - 0.66) / 0.34);
  };

  const facets = [];
  for (let i = 0; i < K; i++) {
    const g0 = girdle[i], g1 = girdle[i + 1];
    const t0 = { x: toTX(g0.x), y: yTable }, t1 = { x: toTX(g1.x), y: yTable };
    facets.push({ pts: [t0, t1, g1, g0], fill: shade((t0.x + g1.x) / 2, 0) });        // crown
    facets.push({ pts: [g0, g1, culet], fill: shade((g0.x + g1.x) / 2, i % 2 === 0 ? 1 : -1) }); // pavilion
  }
  const tableFacet = [tableL, tableR, { x: toTX(gw), y: yTable }, { x: toTX(-gw), y: yTable }];
  const outline = [tableL, tableR, girdle[K], culet, girdle[0]];

  // 4-point sparkle star
  const starPts = (sx, sy, r) => {
    const r2 = r * 0.26;
    return [[0, -r], [r2, -r2], [r, 0], [r2, r2], [0, r], [-r2, r2], [-r, 0], [-r2, -r2]]
      .map(([dx, dy]) => `${(sx + dx).toFixed(1)},${(sy + dy).toFixed(1)}`).join(' ');
  };

  // Twinkle sparkle positions — sprinkled over the facets.
  const sparkleCount = sparkleCountForRank(rank);
  const sparkleSize = Math.max(2, size * 0.05);
  const sparkleDots = Array.from({ length: sparkleCount }, (_, i) => {
    const gp = girdle[Math.min(girdle.length - 1, Math.round((i + 0.5) * (girdle.length - 1) / sparkleCount))];
    const dy = (i % 2 === 0) ? (yGirdle - yTable) * 0.4 : (yCulet - yGirdle) * 0.35;
    const color = (isPrism && Array.isArray(prism) && prism.length) ? prism[i % prism.length] : (i % 2 === 0 ? pal.core : pal.sheen);
    return { x: gp.x * 0.6 + cx * 0.4, y: yGirdle + (i % 2 === 0 ? -dy : dy), color };
  });

  const uid = React.useId().replace(/:/g, '');
  const tableId = `gem-t-${gem.id}-${uid}`;
  const fireId  = `gem-f-${gem.id}-${uid}`;
  const bloomId = `gem-b-${gem.id}-${uid}`;
  const prismId = `gem-p-${gem.id}-${uid}`;

  const label = earned ? `${gem.name} gem, earned` : `${gem.name} gem, locked`;

  // ── LOCKED — dark gem silhouette with a faint jewel tease ───────────────────
  if (!earned) {
    const lockedContent = (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
        <Defs>
          <SvgRadialGradient id={bloomId} cx="50%" cy="45%" r="55%">
            <Stop offset="0%" stopColor={pal.mid} stopOpacity="0.10" />
            <Stop offset="100%" stopColor={pal.mid} stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Ellipse cx={cx} cy={cy} rx={W * 1.5} ry={Hh * 0.7} fill={`url(#${bloomId})`} />
        <Polygon points={ptStr(outline)} fill={colors.bg ?? '#18140e'} fillOpacity={0.92} />
        {facets.map((f, i) => (<Polygon key={i} points={ptStr(f.pts)} fill={pal.mid} fillOpacity={0.07} />))}
        <Polygon points={ptStr(outline)} fill="none" stroke={pal.mid} strokeOpacity={0.35} strokeWidth={Math.max(1, size * 0.018)} strokeLinejoin="round" />
        <Line x1={cx} y1={yTable} x2={cx} y2={yCulet} stroke={pal.mid} strokeOpacity={0.18} strokeWidth={0.7} />
      </Svg>
    );
    if (onPress) {
      return (
        <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{lockedContent}</Pressable>
      );
    }
    return lockedContent;
  }

  // ── Aura bloom (pulses behind the stone) ───────────────────────────────────
  const bloomMult = lerp(1.0, 1.6, t);
  const bloomSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={bloomId} cx="50%" cy="44%" r="55%">
          <Stop offset="0%"   stopColor={pal.glow} stopOpacity={Math.min(0.62, 0.42 * bloomMult)} />
          <Stop offset="55%"  stopColor={pal.glow} stopOpacity={Math.min(0.2, 0.13 * bloomMult)} />
          <Stop offset="100%" stopColor={pal.glow} stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Ellipse cx={cx} cy={cy} rx={W * 1.75} ry={Hh * 0.78} fill={`url(#${bloomId})`} />
    </Svg>
  );

  // ── Gem body ───────────────────────────────────────────────────────────────
  const gemBodySvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
      <Defs>
        <SvgLinearGradient id={tableId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={pal.core} />
          <Stop offset="100%" stopColor={pal.sheen} />
        </SvgLinearGradient>
        <SvgRadialGradient id={fireId} cx="46%" cy="38%" r="60%">
          <Stop offset="0%"   stopColor="#ffffff"  stopOpacity="0.5" />
          <Stop offset="42%"  stopColor={pal.sheen} stopOpacity="0.22" />
          <Stop offset="100%" stopColor={pal.glow}  stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>

      {/* Facets */}
      {facets.map((f, i) => (<Polygon key={i} points={ptStr(f.pts)} fill={f.fill} />))}
      {/* Bright table top */}
      <Polygon points={ptStr(tableFacet)} fill={`url(#${tableId})`} />
      {/* Inner fire glow */}
      <Circle cx={cx} cy={cy - Hh * 0.16} r={W * 0.6} fill={`url(#${fireId})`} />
      {/* Crisp luminous outline + center seam */}
      <Polygon points={ptStr(outline)} fill="none" stroke={pal.sheen} strokeOpacity={0.7} strokeWidth={Math.max(0.9, size * 0.013)} strokeLinejoin="round" />
      <Line x1={cx} y1={yTable} x2={cx} y2={yCulet} stroke={facetDeep} strokeOpacity={0.4} strokeWidth={0.6} />
      {/* Static sparkle on the table */}
      <Polygon points={starPts(cx - tw * 0.35, yTable + (yGirdle - yTable) * 0.35, W * 0.22)} fill="#ffffff" fillOpacity={0.95} />
    </Svg>
  );

  // Prismatic sheen overlay (apex gem) — cross-faded rainbow over the silhouette.
  const prismSvg = isPrism ? (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgLinearGradient id={prismId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%"   stopColor={(prism && prism[0]) || pal.core} stopOpacity="0.8" />
          <Stop offset="45%"  stopColor={(prism && prism[2]) || pal.mid}  stopOpacity="0.6" />
          <Stop offset="100%" stopColor={(prism && prism[4]) || pal.glow} stopOpacity="0.7" />
        </SvgLinearGradient>
      </Defs>
      <Polygon points={ptStr(outline)} fill={`url(#${prismId})`} />
    </Svg>
  ) : null;

  const shouldAnimate = earned && !reduceMotion;
  const sparkleScaleInterps = sparkleAnims.map((a) => a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1.1, 0.4] }));
  // Falling glint travels table → culet.
  const glintY = glintAnim.interpolate({ inputRange: [0, 1], outputRange: [yTable + 2, yCulet - 2] });
  const glintOpacity = glintAnim.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.9, 0.9, 0] });
  const glintSize = Math.max(2, size * 0.05);
  const hasGlint = shouldAnimate && rank >= LADDER.GLINT_FROM;

  // ── STATIC (reduce motion) ─────────────────────────────────────────────────
  if (!shouldAnimate) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <View style={{ position: 'absolute', width: size, height: size }}>{bloomSvg}</View>
        <View style={{ position: 'absolute', width: size, height: size }}>{gemBodySvg}</View>
        {prismSvg ? <View style={{ position: 'absolute', width: size, height: size, opacity: 0.45 }}>{prismSvg}</View> : null}
      </View>
    );
    if (onPress) {
      return (
        <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{staticContent}</Pressable>
      );
    }
    return staticContent;
  }

  // ── ANIMATED ───────────────────────────────────────────────────────────────
  const animated = (
    <View style={{ width: size, height: size }} accessibilityLabel={label}>
      {/* Aura (opacity pulse) */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, opacity: glowAnim }}>
        {bloomSvg}
      </Animated.View>
      {/* Gem body (breathing scale) */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, transform: [{ scale: breatheAnim }] }}>
        {gemBodySvg}
        {prismSvg ? (
          <Animated.View style={{ position: 'absolute', width: size, height: size, opacity: prismAnim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.55] }) }}>
            {prismSvg}
          </Animated.View>
        ) : null}
      </Animated.View>
      {/* Falling glint */}
      {hasGlint ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', width: glintSize, height: glintSize, borderRadius: glintSize, backgroundColor: '#ffffff', left: cx - glintSize / 2, top: -glintSize / 2, opacity: glintOpacity, transform: [{ translateY: glintY }] }} />
      ) : null}
      {/* Twinkle sparkles */}
      {sparkleDots.map((dot, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute', width: sparkleSize, height: sparkleSize, borderRadius: sparkleSize,
            backgroundColor: dot.color, left: dot.x - sparkleSize / 2, top: dot.y - sparkleSize / 2,
            opacity: sparkleAnims[i], transform: [{ scale: sparkleScaleInterps[i] }],
          }}
        />
      ))}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{animated}</Pressable>
    );
  }
  return animated;
}
