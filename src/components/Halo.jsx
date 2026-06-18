import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View } from 'react-native';
import Svg, {
  Circle, Ellipse, Polygon, Defs,
  RadialGradient as SvgRadialGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';
import { gemPalette, gemRank, maxGemRank } from '../domain/gems';

/**
 * Gem token — a richly faceted, glowing GEMSTONE (front view: table → crown
 * rows → pavilion converging to a culet), with the alternating bright/dark
 * facet sparkle of a real cut stone and slight per-gem irregularity so no two
 * are the same and none read as a cheap even diamond. Unmistakably different
 * from the auras' rings of light.
 *
 * Props (UNCHANGED): gem, earned, size=56, onPress
 *
 * Rarity ramps: more facets (24 → 36), deeper/faster aura pulse, stronger
 * breathing, a glint that falls through the stone, more sparkles, and prismatic
 * fire on the apex gem (the_year). Irregularity is SEEDED off gem.id so each
 * stone has a stable unique shape.
 */

const LADDER = {
  K_R0: 6, K_R7: 9,                 // facet columns (×4 rows ≈ 24 → 36 facets)
  GLOW_DUR_R0: 4200, GLOW_DUR_R7: 1900, GLOW_MIN_R0: 0.55, GLOW_MIN_R7: 0.32, GLOW_MAX: 1.0,
  BREATHE_MAX_R0: 1.02, BREATHE_MAX_R7: 1.055, BREATHE_DUR_R0: 3800, BREATHE_DUR_R7: 2400,
  GLINT_FROM: 2, GLINT_DUR_R2: 3200, GLINT_DUR_R7: 1700,
  SPARKLES_R0: 1, SPARKLES_R7: 6, SPARKLE_DUR: 900, SPARKLE_STAGGER: 130,
  PRISM_RANK: 7, PRISM_DUR: 2600,
};
const MAX_SPARKLE = 6;

const lerp = (a, b, t) => a + (b - a) * t;
function progT(rank) { const max = maxGemRank() || 1; return Math.max(0, Math.min(max, rank)) / max; }
function hexToRgb(h) {
  if (typeof h !== 'string') return { r: 255, g: 255, b: 255 };
  const m = h.replace('#', ''); const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const i = parseInt(n, 16); if (Number.isNaN(i)) return { r: 255, g: 255, b: 255 };
  return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255 };
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(A.r + (B.r - A.r) * t)},${Math.round(A.g + (B.g - A.g) * t)},${Math.round(A.b + (B.b - A.b) * t)})`;
}
function hashStr(s) { let h = 2166136261; const str = String(s || 'gem'); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function makeRng(seed) { let x = seed || 123456789; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function kForRank(rank) { return Math.max(6, Math.min(9, Math.round(lerp(LADDER.K_R0, LADDER.K_R7, progT(rank))))); }
function sparkleCountForRank(rank) { return Math.max(1, Math.min(MAX_SPARKLE, Math.round(lerp(LADDER.SPARKLES_R0, LADDER.SPARKLES_R7, progT(rank))))); }

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  const glowAnim    = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const glintAnim   = useRef(new Animated.Value(0)).current;
  const prismAnim   = useRef(new Animated.Value(0)).current;
  const sparkleAnims = useRef(Array.from({ length: MAX_SPARKLE }, () => new Animated.Value(0))).current;
  const loopRefs = useRef([]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (!cancelled && mountedRef.current) setReduceMotion(on); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loopRefs.current.forEach((l) => l.stop());
    loopRefs.current = [];
    if (!earned || reduceMotion) return;
    const rank = gemRank(gem); const t = progT(rank); const loops = [];

    const glowDur = Math.round(lerp(LADDER.GLOW_DUR_R0, LADDER.GLOW_DUR_R7, t));
    const glowMin = lerp(LADDER.GLOW_MIN_R0, LADDER.GLOW_MIN_R7, t);
    glowAnim.setValue(LADDER.GLOW_MAX);
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: glowMin, duration: glowDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: LADDER.GLOW_MAX, duration: glowDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    glowLoop.start(); loops.push(glowLoop);

    const breatheMax = lerp(LADDER.BREATHE_MAX_R0, LADDER.BREATHE_MAX_R7, t);
    const breatheDur = Math.round(lerp(LADDER.BREATHE_DUR_R0, LADDER.BREATHE_DUR_R7, t));
    breatheAnim.setValue(1);
    const breatheLoop = Animated.loop(Animated.sequence([
      Animated.timing(breatheAnim, { toValue: breatheMax, duration: breatheDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breatheAnim, { toValue: 1, duration: breatheDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    breatheLoop.start(); loops.push(breatheLoop);

    if (rank >= LADDER.GLINT_FROM) {
      const glintDur = Math.round(lerp(LADDER.GLINT_DUR_R2, LADDER.GLINT_DUR_R7, t));
      glintAnim.setValue(0);
      const glintLoop = Animated.loop(Animated.sequence([
        Animated.timing(glintAnim, { toValue: 1, duration: glintDur, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(glintDur * 0.7),
      ]));
      glintLoop.start(); loops.push(glintLoop);
    }

    if (rank >= LADDER.PRISM_RANK) {
      prismAnim.setValue(0);
      const prismLoop = Animated.loop(Animated.sequence([
        Animated.timing(prismAnim, { toValue: 1, duration: LADDER.PRISM_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(prismAnim, { toValue: 0, duration: LADDER.PRISM_DUR, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      prismLoop.start(); loops.push(prismLoop);
    } else { prismAnim.setValue(0); }

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

  const pal  = gemPalette(gem);
  const rank = gemRank(gem);
  const t    = progT(rank);
  const isPrism = rank >= LADDER.PRISM_RANK;
  const prism = pal.prism;

  // ── Geometry — seeded off gem.id so each stone has a stable, unique shape ───
  const r = makeRng(hashStr(gem.id));
  const cx = size / 2, cy = size / 2 + size * 0.02;
  const gw = size * 0.40;
  const yTable = cy - size * 0.36, yCrown = cy - size * 0.16, yGirdle = cy - size * 0.02,
        yMid = cy + size * 0.18, yCulet = cy + size * 0.44;
  const tw = gw * 0.42, cw = gw * 0.80;
  const K = kForRank(rank);

  // Column x-fractions across [-1,1] with slight jitter (irregular, not even).
  const xf = [];
  for (let i = 0; i <= K; i++) {
    const base = -1 + 2 * (i / K);
    const j = (i === 0 || i === K) ? 0 : (r() - 0.5) * (1.2 / K);
    xf.push(Math.max(-1, Math.min(1, base + j)));
  }
  const jY = (y) => y + (r() - 0.5) * size * 0.025;
  const tRow = xf.map((f) => ({ x: cx + f * tw, y: yTable }));
  const cRow = xf.map((f) => ({ x: cx + f * cw, y: jY(yCrown) }));
  const gRow = xf.map((f) => ({ x: cx + f * gw, y: jY(yGirdle) }));
  const mRow = xf.map((f) => ({ x: cx + f * (gw * 0.62), y: jY(yMid) }));
  const culet = { x: cx + (r() - 0.5) * gw * 0.18, y: yCulet };

  const facetDeep = mix(pal.deep, '#000000', 0.40);
  const LIGHT = { x: -0.62, y: -0.5 };
  const shade = (c, alt) => {
    const nx = (c.x - cx) / gw, ny = (c.y - cy) / (size * 0.4);
    let b = 0.5 + 0.5 * (-(nx * LIGHT.x + ny * LIGHT.y));
    b = Math.max(0, Math.min(1, b));
    b = b * 0.72 + (alt > 0 ? 0.28 : 0);
    b = Math.max(0, Math.min(1, b));
    if (b < 0.32) return mix(facetDeep, pal.mid, b / 0.32);
    if (b < 0.62) return mix(pal.mid, pal.sheen, (b - 0.32) / 0.30);
    return mix(pal.sheen, pal.core, (b - 0.62) / 0.38);
  };
  const ptStr = (pts) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const cen = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

  const facets = [];
  for (let i = 0; i < K; i++) {
    facets.push({ pts: [tRow[i], tRow[i + 1], cRow[i + 1], cRow[i]], alt: i % 2 ? 1 : -1 }); // crown row 1
    facets.push({ pts: [cRow[i], cRow[i + 1], gRow[i + 1], gRow[i]], alt: i % 2 ? -1 : 1 }); // crown row 2
    facets.push({ pts: [gRow[i], gRow[i + 1], mRow[i + 1], mRow[i]], alt: i % 2 ? 1 : -1 }); // pavilion row 1
    facets.push({ pts: [mRow[i], mRow[i + 1], culet], alt: i % 2 ? -1 : 1 });               // pavilion row 2 → culet
  }
  const facetEls = facets.map((f) => ({ pts: ptStr(f.pts), fill: shade(cen(f.pts), f.alt) }));
  const outline = [...tRow, cRow[K], gRow[K], mRow[K], culet, mRow[0], gRow[0], cRow[0]];
  const apex = { x: cx - tw * 0.4, y: yTable + size * 0.10 };

  const starPts = (sx, sy, rr) => {
    const r2 = rr * 0.26;
    return [[0, -rr], [r2, -r2], [rr, 0], [r2, r2], [0, rr], [-r2, r2], [-rr, 0], [-r2, -r2]]
      .map(([dx, dy]) => `${(sx + dx).toFixed(1)},${(sy + dy).toFixed(1)}`).join(' ');
  };

  const sparkleCount = sparkleCountForRank(rank);
  const sparkleSize = Math.max(2, size * 0.05);
  const sparkleDots = Array.from({ length: sparkleCount }, (_, i) => {
    const row = i % 2 === 0 ? cRow : mRow;
    const p = row[Math.min(row.length - 1, 1 + ((i * 2) % Math.max(1, row.length - 2)))];
    const color = (isPrism && Array.isArray(prism) && prism.length) ? prism[i % prism.length] : (i % 2 === 0 ? pal.core : pal.sheen);
    return { x: p.x, y: p.y, color };
  });

  const uid = React.useId().replace(/:/g, '');
  const bloomId = `gem-b-${gem.id}-${uid}`;
  const fireId  = `gem-f-${gem.id}-${uid}`;
  const prismId = `gem-p-${gem.id}-${uid}`;
  const label = earned ? `${gem.name} gem, earned` : `${gem.name} gem, locked`;

  // ── LOCKED — dark gem silhouette tease ──────────────────────────────────────
  if (!earned) {
    const lockedContent = (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
        <Defs>
          <SvgRadialGradient id={bloomId} cx="48%" cy="42%" r="55%">
            <Stop offset="0%" stopColor={pal.mid} stopOpacity="0.10" />
            <Stop offset="100%" stopColor={pal.mid} stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Ellipse cx={cx} cy={cy} rx={gw * 1.5} ry={size * 0.5} fill={`url(#${bloomId})`} />
        <Polygon points={ptStr(outline)} fill={colors.bg ?? '#18140e'} fillOpacity={0.92} />
        {facetEls.map((f, i) => (<Polygon key={i} points={f.pts} fill={pal.mid} fillOpacity={0.06} />))}
        <Polygon points={ptStr(outline)} fill="none" stroke={pal.mid} strokeOpacity={0.35} strokeWidth={Math.max(1, size * 0.016)} strokeLinejoin="round" />
      </Svg>
    );
    return onPress
      ? (<Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{lockedContent}</Pressable>)
      : lockedContent;
  }

  // ── Aura bloom ──────────────────────────────────────────────────────────────
  const bloomMult = lerp(1.0, 1.6, t);
  const bloomSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={bloomId} cx="46%" cy="40%" r="55%">
          <Stop offset="0%"   stopColor={pal.glow} stopOpacity={Math.min(0.62, 0.42 * bloomMult)} />
          <Stop offset="55%"  stopColor={pal.glow} stopOpacity={Math.min(0.18, 0.12 * bloomMult)} />
          <Stop offset="100%" stopColor={pal.glow} stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Ellipse cx={cx} cy={cy} rx={gw * 1.7} ry={size * 0.55} fill={`url(#${bloomId})`} />
    </Svg>
  );

  // ── Gem body ────────────────────────────────────────────────────────────────
  const seamW = Math.max(0.4, size * 0.006);
  const gemBodySvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
      <Defs>
        <SvgRadialGradient id={fireId} cx="42%" cy="32%" r="52%">
          <Stop offset="0%"   stopColor="#ffffff"  stopOpacity="0.45" />
          <Stop offset="50%"  stopColor={pal.sheen} stopOpacity="0.15" />
          <Stop offset="100%" stopColor={pal.glow}  stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      {facetEls.map((f, i) => (
        <Polygon key={i} points={f.pts} fill={f.fill} stroke={facetDeep} strokeOpacity={0.28} strokeWidth={seamW} strokeLinejoin="round" />
      ))}
      <Polygon points={ptStr(outline)} fill="none" stroke={pal.sheen} strokeOpacity={0.7} strokeWidth={Math.max(0.9, size * 0.012)} strokeLinejoin="round" />
      <Circle cx={apex.x} cy={apex.y} r={gw * 0.5} fill={`url(#${fireId})`} />
      <Polygon points={starPts(apex.x, apex.y - size * 0.02, gw * 0.4)} fill="#ffffff" fillOpacity={0.92} />
    </Svg>
  );

  const prismSvg = isPrism ? (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={prismId} cx="44%" cy="36%" r="60%">
          <Stop offset="0%"   stopColor={(prism && prism[0]) || pal.core} stopOpacity="0.7" />
          <Stop offset="50%"  stopColor={(prism && prism[2]) || pal.mid}  stopOpacity="0.5" />
          <Stop offset="100%" stopColor={(prism && prism[4]) || pal.glow} stopOpacity="0.55" />
        </SvgRadialGradient>
      </Defs>
      <Polygon points={ptStr(outline)} fill={`url(#${prismId})`} />
    </Svg>
  ) : null;

  const shouldAnimate = earned && !reduceMotion;
  const sparkleScaleInterps = sparkleAnims.map((a) => a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1.1, 0.4] }));
  const glintY = glintAnim.interpolate({ inputRange: [0, 1], outputRange: [yTable + 2, yCulet - 2] });
  const glintOpacity = glintAnim.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.9, 0.9, 0] });
  const glintSize = Math.max(2, size * 0.045);
  const hasGlint = shouldAnimate && rank >= LADDER.GLINT_FROM;

  if (!shouldAnimate) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <View style={{ position: 'absolute', width: size, height: size }}>{bloomSvg}</View>
        <View style={{ position: 'absolute', width: size, height: size }}>{gemBodySvg}</View>
        {prismSvg ? <View style={{ position: 'absolute', width: size, height: size, opacity: 0.4 }}>{prismSvg}</View> : null}
      </View>
    );
    return onPress
      ? (<Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{staticContent}</Pressable>)
      : staticContent;
  }

  const animated = (
    <View style={{ width: size, height: size }} accessibilityLabel={label}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, opacity: glowAnim }}>
        {bloomSvg}
      </Animated.View>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, transform: [{ scale: breatheAnim }] }}>
        {gemBodySvg}
        {prismSvg ? (
          <Animated.View style={{ position: 'absolute', width: size, height: size, opacity: prismAnim.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.5] }) }}>
            {prismSvg}
          </Animated.View>
        ) : null}
      </Animated.View>
      {hasGlint ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', width: glintSize, height: glintSize, borderRadius: glintSize, backgroundColor: '#ffffff', left: cx - glintSize / 2, top: -glintSize / 2, opacity: glintOpacity, transform: [{ translateY: glintY }] }} />
      ) : null}
      {sparkleDots.map((dot, i) => (
        <Animated.View key={i} pointerEvents="none" style={{
          position: 'absolute', width: sparkleSize, height: sparkleSize, borderRadius: sparkleSize,
          backgroundColor: dot.color, left: dot.x - sparkleSize / 2, top: dot.y - sparkleSize / 2,
          opacity: sparkleAnims[i], transform: [{ scale: sparkleScaleInterps[i] }],
        }} />
      ))}
    </View>
  );

  return onPress
    ? (<Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{animated}</Pressable>)
    : animated;
}
