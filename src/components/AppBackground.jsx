import React, { useEffect, useState } from 'react';
import { View, StyleSheet, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, getCircadianGradient } from '../theme';

// Single, app-wide background. Rendered once behind the whole navigator so
// every screen sits on the same warm, circadian-shifting gradient instead of
// flat black. Screens keep transparent surfaces so this shows through; the
// gradient also gives navigation transitions a stable backdrop to slide over.
export default function AppBackground() {
  const { scheme, colors } = useTheme();
  const [hour, setHour] = useState(() => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  });

  // Re-evaluate the hour when the app returns to the foreground and on a slow
  // timer, so the background drifts with the day without a per-frame cost.
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setHour(d.getHours() + d.getMinutes() / 60);
    };
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    const id = setInterval(tick, 10 * 60 * 1000); // every 10 minutes
    return () => { sub.remove(); clearInterval(id); };
  }, []);

  return (
    <>
      <LinearGradient
        colors={getCircadianGradient(scheme, hour)}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Aura tint — a VERY subtle wash of the selected aura's color over the
          circadian gradient. Kept low-opacity so the warm-dark base stays
          clearly dominant; it's a hint of the aura, not a color show. Only
          drawn when an aura is active (colors.auraTint set). */}
      {colors.auraTint ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.auraTint, opacity: 0.08 }]}
          pointerEvents="none"
        />
      ) : null}
    </>
  );
}
