import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Animated, Easing, AccessibilityInfo, View } from 'react-native';
import Svg, {
  Ellipse, Polygon, Defs,
  RadialGradient as SvgRadialGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme';
import { gemPalette, gemRank, maxGemRank } from '../domain/gems';

/**
 * Gem token — a raw CRYSTAL CLUSTER: glossy faceted crystal points radiating
 * from a center, each with a lit face + a shadow face (real-mineral look), a
 * coloured glow behind, and twinkling speculars. NOT a flat cut diamond, and
 * unmistakably different from the auras' rings of light.
 *
 * Props (UNCHANGED): gem, earned, size=56, onPress
 *
 * Each cluster is SEEDED off gem.id so it's stable and unique. Rarity ramps the
 * number of crystal points, the aura pulse, breathing, sparkles and (apex gem)
 * a prismatic shimmer.
 */

const LADDER = {
  N_R0: 6, N_R7: 11,                 // crystal points
  GLOW_DUR_R0: 4200, GLOW_DUR_R7: 1900, GLOW_MIN_R0: 0.55, GLOW_MIN_R7: 0.32, GLOW_MAX: 1.0,
  BREATHE_MAX_R0: 1.02, BREATHE_MAX_R7: 1.05, BREATHE_DUR_R0: 3800, BREATHE_DUR_R7: 2400,
  SPARKLES_R0: 2, SPARKLES_R7: 6, SPARKLE_DUR: 850, SPARKLE_STAGGER: 150,
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
function nForRank(rank) { return Math.max(6, Math.min(11, Math.round(lerp(LADDER.N_R0, LADDER.N_R7, progT(rank))))); }
function sparkleCountForRank(rank) { return Math.max(1, Math.min(MAX_SPARKLE, Math.round(lerp(LADDER.SPARKLES_R0, LADDER.SPARKLES_R7, progT(rank))))); }

export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();
  const mountedRef = useRef(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  const glowAnim    = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
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
        Animated.delay(LADDER.SPARKLE_DUR),
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

  // ── Crystal cluster geometry (seeded off gem.id → stable + unique) ──────────
  const r = makeRng(hashStr(gem.id));
  const cx = size / 2, cy = size / 2 + size * 0.05;
  const R = size * 0.30;
  const LA = -2.2; // light direction (upper-left)
  const facetDeep = mix(pal.deep, '#000000', 0.30);
  const N = nForRank(rank);

  const shards = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const ang = -Math.PI * 1.15 + Math.PI * 1.3 * u + (r() - 0.5) * 0.4;
    const len = R * (0.85 + r() * 0.7);
    const w = len * (0.15 + r() * 0.06);
    const baseDist = R * 0.18 * r();
    shards.push({ ang, len, w, baseDist });
  }
  shards.sort((a, b) => Math.sin(a.ang) - Math.sin(b.ang)); // back → front

  const ptStr = (pts) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const faceColor = (faceNormal) => {
    let b = Math.max(0, Math.cos(faceNormal - LA));
    b = 0.18 + 0.82 * b;
    if (b < 0.45) return mix(facetDeep, pal.mid, b / 0.45);
    if (b < 0.80) return mix(pal.mid, pal.sheen, (b - 0.45) / 0.35);
    return mix(pal.sheen, pal.core, (b - 0.80) / 0.20);
  };

  const shardEls = [];
  const tipPts = []; // for sparkles
  shards.forEach((s, idx) => {
    const d = { x: Math.cos(s.ang), y: Math.sin(s.ang) };
    const pp = { x: -Math.sin(s.ang), y: Math.cos(s.ang) };
    const base = { x: cx + d.x * s.baseDist, y: cy + d.y * s.baseDist };
    const tip = { x: cx + d.x * s.len, y: cy + d.y * s.len };
    const sh = 0.62;
    const sL = { x: base.x + d.x * s.len * sh - pp.x * s.w, y: base.y + d.y * s.len * sh - pp.y * s.w };
    const sR = { x: base.x + d.x * s.len * sh + pp.x * s.w, y: base.y + d.y * s.len * sh + pp.y * s.w };
    const bL = { x: base.x - pp.x * s.w * 0.7, y: base.y - pp.y * s.w * 0.7 };
    const bR = { x: base.x + pp.x * s.w * 0.7, y: base.y + pp.y * s.w * 0.7 };
    const bLit = Math.max(0, Math.cos((s.ang - Math.PI / 2) - LA));
    const rLit = Math.max(0, Math.cos((s.ang + Math.PI / 2) - LA));
    shardEls.push({
      left: ptStr([bL, sL, tip, base]), leftFill: faceColor(s.ang - Math.PI / 2),
      right: ptStr([bR, sR, tip, base]), rightFill: faceColor(s.ang + Math.PI / 2),
      gloss: ptStr(bLit > rLit ? [sL, tip, base] : [sR, tip, base]),
    });
    tipPts.push(tip);
  });

  const uid = React.useId().replace(/:/g, '');
  const bloomId = `gem-b-${gem.id}-${uid}`;
  const prismId = `gem-p-${gem.id}-${uid}`;
  const seamColor = mix(pal.deep, '#000000', 0.45);
  const seamW = Math.max(0.4, size * 0.008);
  const label = earned ? `${gem.name} gem, earned` : `${gem.name} gem, locked`;

  // ── LOCKED — dark crystal-cluster silhouette ────────────────────────────────
  if (!earned) {
    const lockedContent = (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
        <Defs>
          <SvgRadialGradient id={bloomId} cx="50%" cy="48%" r="55%">
            <Stop offset="0%" stopColor={pal.mid} stopOpacity="0.10" />
            <Stop offset="100%" stopColor={pal.mid} stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Ellipse cx={cx} cy={cy} rx={R * 1.8} ry={R * 1.8} fill={`url(#${bloomId})`} />
        {shardEls.map((s, i) => (
          <React.Fragment key={i}>
            <Polygon points={s.left} fill={colors.bg ?? '#18140e'} fillOpacity={0.9} stroke={pal.mid} strokeOpacity={0.22} strokeWidth={seamW} strokeLinejoin="round" />
            <Polygon points={s.right} fill={colors.bg ?? '#18140e'} fillOpacity={0.82} stroke={pal.mid} strokeOpacity={0.22} strokeWidth={seamW} strokeLinejoin="round" />
          </React.Fragment>
        ))}
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
        <SvgRadialGradient id={bloomId} cx="50%" cy="46%" r="55%">
          <Stop offset="0%"   stopColor={pal.glow} stopOpacity={Math.min(0.6, 0.4 * bloomMult)} />
          <Stop offset="55%"  stopColor={pal.glow} stopOpacity={Math.min(0.18, 0.12 * bloomMult)} />
          <Stop offset="100%" stopColor={pal.glow} stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Ellipse cx={cx} cy={cy} rx={R * 2.0} ry={R * 2.0} fill={`url(#${bloomId})`} />
    </Svg>
  );

  // ── The crystal cluster ─────────────────────────────────────────────────────
  const clusterSvg = (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={label}>
      {shardEls.map((s, i) => (
        <React.Fragment key={i}>
          <Polygon points={s.left} fill={s.leftFill} stroke={seamColor} strokeOpacity={0.5} strokeWidth={seamW} strokeLinejoin="round" />
          <Polygon points={s.right} fill={s.rightFill} stroke={seamColor} strokeOpacity={0.5} strokeWidth={seamW} strokeLinejoin="round" />
          <Polygon points={s.gloss} fill={pal.core} fillOpacity={0.28} />
        </React.Fragment>
      ))}
    </Svg>
  );

  const prismSvg = isPrism ? (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgRadialGradient id={prismId} cx="48%" cy="44%" r="58%">
          <Stop offset="0%"   stopColor={(prism && prism[0]) || pal.core} stopOpacity="0.55" />
          <Stop offset="50%"  stopColor={(prism && prism[2]) || pal.mid}  stopOpacity="0.4" />
          <Stop offset="100%" stopColor={(prism && prism[4]) || pal.glow} stopOpacity="0.45" />
        </SvgRadialGradient>
      </Defs>
      <Ellipse cx={cx} cy={cy} rx={R * 1.7} ry={R * 1.7} fill={`url(#${prismId})`} />
    </Svg>
  ) : null;

  const shouldAnimate = earned && !reduceMotion;
  const sparkleScaleInterps = sparkleAnims.map((a) => a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.3] }));
  const sparkleCount = sparkleCountForRank(rank);
  const sparkleSize = Math.max(2, size * 0.04);
  const sparkleDots = Array.from({ length: sparkleCount }, (_, i) => {
    const p = tipPts[(i * 2 + 1) % tipPts.length] || { x: cx, y: cy };
    return { x: p.x, y: p.y, color: (isPrism && Array.isArray(prism) && prism.length) ? prism[i % prism.length] : pal.core };
  });

  if (!shouldAnimate) {
    const staticContent = (
      <View style={{ width: size, height: size }} accessibilityLabel={label}>
        <View style={{ position: 'absolute', width: size, height: size }}>{bloomSvg}</View>
        <View style={{ position: 'absolute', width: size, height: size }}>{clusterSvg}</View>
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
        {clusterSvg}
        {prismSvg ? (
          <Animated.View style={{ position: 'absolute', width: size, height: size, opacity: prismAnim.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.42] }) }}>
            {prismSvg}
          </Animated.View>
        ) : null}
      </Animated.View>
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
