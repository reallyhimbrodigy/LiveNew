import React from 'react';
import { Pressable } from 'react-native';
import Svg, {
  Polygon,
  Polyline,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Circle,
} from 'react-native-svg';
import { useTheme } from '../theme';

/**
 * Faceted SVG gem.
 *
 * Props:
 *   gem      — a GEMS entry {id, name, day, tier, rarityPct, hue, flavor}
 *   earned   — bool
 *   size     — default 56
 *   onPress  — optional
 */
export default function Gem({ gem, earned, size = 56, onPress }) {
  const { colors } = useTheme();

  // ── Geometry ────────────────────────────────────────────────────────────────
  // Classic cut-gem shape: a wide hexagonal "diamond" with a flat top,
  // widest across the girdle (equator), tapering to a point at the bottom.
  // All coordinates are in a [0, size] box.
  //
  //          top-left (tl)  top-right (tr)
  //     far-left (fl)               far-right (fr)
  //          bottom-left (bl)  bottom-right (br)
  //                    culet (cu)  ← bottom point
  //
  // Crown (upper half) sits above the girdle; pavilion (lower) tapers below.

  const cx = size / 2;
  const cy = size / 2;

  const crown = 0.22 * size;   // flat table top y
  const girdle = 0.52 * size;  // widest equator y
  const bottom = 0.95 * size;  // culet (bottom point) y

  const tableHalf = 0.27 * size;  // half-width of the flat top facet
  const girdleHalf = 0.44 * size; // half-width at equator

  // Outer gem silhouette — 5 points
  const outline = [
    [cx - tableHalf, crown],     // table-left (TL)
    [cx + tableHalf, crown],     // table-right (TR)
    [cx + girdleHalf, girdle],   // girdle-right (GR)
    [cx, bottom],                // culet (C)
    [cx - girdleHalf, girdle],   // girdle-left (GL)
  ].map(([x, y]) => `${x},${y}`).join(' ');

  // Crown internal facet lines (star / main crown facets)
  // Table edge (already defined by top two outer points — implicit)
  // Two "main crown facets" from girdle corners up to near-center-top
  const crownFacetLines = [
    // left girdle corner → table-left
    [[cx - girdleHalf, girdle], [cx - tableHalf, crown]],
    // right girdle corner → table-right
    [[cx + girdleHalf, girdle], [cx + tableHalf, crown]],
    // girdle-left → culet (pavilion main facet)
    [[cx - girdleHalf, girdle], [cx, bottom]],
    // girdle-right → culet
    [[cx + girdleHalf, girdle], [cx, bottom]],
    // center vertical accent: table-midpoint → culet
    [[cx, crown], [cx, girdle]],
  ];

  const uid = React.useId();
  const gradId = `gem-grad-${gem.id}-${uid}`;

  // ── Colors ──────────────────────────────────────────────────────────────────
  const hue = gem.hue;

  // Earned fill: gradient from a lighter tint → hue
  // Locked: very dark surface fill at low opacity
  const fillUrl = earned ? `url(#${gradId})` : colors.surface;
  const strokeColor = earned ? hue : colors.dim;
  const strokeOpacity = earned ? 1 : 0.5;
  const gemOpacity = earned ? 1 : 0.5;

  // Facet line color: slightly lighter than stroke for earned; dim for locked
  const facetStroke = earned ? lightenHex(hue, 0.25) : colors.dim;

  // ── Glow ring (earned only) ─────────────────────────────────────────────────
  // A larger, semi-transparent circle behind the gem, reads as ambient glow.
  const glowR = size * 0.52;

  // ── Component ───────────────────────────────────────────────────────────────
  const label = earned
    ? `${gem.name} gem, earned`
    : `${gem.name} gem, locked`;

  const svgContent = (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      accessibilityLabel={label}
    >
      <Defs>
        <SvgGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lightenHex(hue, 0.35)} stopOpacity="1" />
          <Stop offset="1" stopColor={hue} stopOpacity="1" />
        </SvgGradient>
      </Defs>

      {/* Glow — earned only */}
      {earned && (
        <Circle
          cx={cx}
          cy={cy}
          r={glowR}
          fill={hue}
          fillOpacity={0.18}
        />
      )}

      {/* Gem body */}
      <Polygon
        points={outline}
        fill={fillUrl}
        fillOpacity={earned ? 1 : 0.12}
        stroke={strokeColor}
        strokeWidth={earned ? 1.2 : 1}
        strokeOpacity={strokeOpacity}
        opacity={gemOpacity}
      />

      {/* Internal facet lines */}
      {crownFacetLines.map(([[x1, y1], [x2, y2]], i) => (
        <Polyline
          key={i}
          points={`${x1},${y1} ${x2},${y2}`}
          fill="none"
          stroke={facetStroke}
          strokeWidth={earned ? 0.7 : 0.5}
          strokeOpacity={earned ? 0.55 : 0.3}
          opacity={gemOpacity}
        />
      ))}
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

// ── Utility ──────────────────────────────────────────────────────────────────
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
