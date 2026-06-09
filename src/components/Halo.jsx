import React from 'react';
import { Pressable } from 'react-native';
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
 */
export default function Halo({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();

  // ── Ray count + length by tier ─────────────────────────────────────────────
  // Rarer halos look more radiant — more rays, slightly longer reach.
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

  // The halo ring sits at ~38% of size radius (inner circle)
  const ringR = size * 0.32;
  const ringStrokeWidth = Math.max(1.2, size * 0.028);

  // Glow circle behind the ring
  const glowR = size * 0.46;
  const isHighTier = gem.tier === 'Legendary' || gem.tier === 'Mythic';
  const glowOpacity = earned ? (isHighTier ? 0.28 : 0.18) : 0;

  // Ray geometry: start just outside the ring, end further out
  const rayInnerR = ringR + ringStrokeWidth * 0.6;
  const rayOuterR = ringR + size * RAY_LEN_FRAC + ringStrokeWidth * 0.6;
  const rayStrokeWidth = Math.max(0.8, size * 0.02);

  // Pre-compute ray endpoints
  const rayLines = Array.from({ length: RAY_COUNT }, (_, i) => {
    const angle = (2 * Math.PI * i) / RAY_COUNT - Math.PI / 2; // start at top
    return {
      x1: cx + Math.cos(angle) * rayInnerR,
      y1: cy + Math.sin(angle) * rayInnerR,
      x2: cx + Math.cos(angle) * rayOuterR,
      y2: cy + Math.sin(angle) * rayOuterR,
    };
  });

  // ── Colors ─────────────────────────────────────────────────────────────────
  const hue = gem.hue;

  // Unique gradient id per instance (avoids SVG id collisions in grid + modal)
  const uid = React.useId();
  const gradId = `halo-grad-${gem.id}-${uid.replace(/:/g, '')}`;

  const ringColor = earned ? `url(#${gradId})` : colors.line;
  const ringOpacity = earned ? 1 : 0.5;
  const haloOpacity = earned ? 1 : 0.45;

  // Earned ray color: lighter tint of hue. Locked: very faint, 2 ghost rays only.
  const rayColor = earned ? lightenHex(hue, 0.3) : colors.dim;
  const rayOpacity = earned ? 0.75 : 0;
  const lockedGhostRayOpacity = 0.18;

  // ── Accessibility ──────────────────────────────────────────────────────────
  const label = earned
    ? `${gem.name} halo, earned`
    : `${gem.name} halo, locked`;

  // ── SVG ────────────────────────────────────────────────────────────────────
  const svgContent = (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      accessibilityLabel={label}
      opacity={haloOpacity}
    >
      <Defs>
        {/* Radial gradient: lighter center → richer outer hue */}
        <SvgGradient id={gradId} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <Stop offset="0" stopColor={lightenHex(hue, 0.4)} stopOpacity="1" />
          <Stop offset="1" stopColor={hue} stopOpacity="1" />
        </SvgGradient>
      </Defs>

      {/* Soft glow behind ring — earned only */}
      <Circle
        cx={cx}
        cy={cy}
        r={glowR}
        fill={hue}
        fillOpacity={glowOpacity}
      />

      {/* Rays — earned: full gold rays; locked: 2 ghost stubs */}
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
        : /* Two ghost ray stubs at top and bottom for locked state */
          [0, Math.floor(RAY_COUNT / 2)].map((idx) => {
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

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        {svgContent}
      </Pressable>
    );
  }

  return svgContent;
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
