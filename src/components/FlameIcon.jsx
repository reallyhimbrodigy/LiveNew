import React from 'react';
import Svg, { Path } from 'react-native-svg';

// Crafted flame icon (Lucide "flame" path) — replaces the 🔥 emoji, which
// renders inconsistently across platforms and can't be themed. Stroke-based so
// it matches the app's thin-line icon language and takes the brand gold.
export default function FlameIcon({ size = 18, color = '#c4a86c', strokeWidth = 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
