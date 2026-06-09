import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useTheme } from '../theme';
import { SOUNDSCAPES } from '../domain/soundscapes';

// View-drawn play triangle (▶). A right-pointing triangle built from a
// zero-width/height box with a left border acting as the visible fill.
// No emoji, no SVG dependency.
function PlayIcon({ color }) {
  return (
    <View style={{
      width: 0,
      height: 0,
      borderTopWidth: 5,
      borderBottomWidth: 5,
      borderLeftWidth: 9,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: color,
      marginLeft: 2, // optical centering inside the 20px container
    }} />
  );
}

// View-drawn pause bars (❚❚). Two thin rectangles side by side.
function PauseIcon({ color }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      <View style={{ width: 3, height: 11, borderRadius: 1.5, backgroundColor: color }} />
      <View style={{ width: 3, height: 11, borderRadius: 1.5, backgroundColor: color }} />
    </View>
  );
}

export default function SoundscapePlayer() {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const [playingId, setPlayingId] = useState(null);
  const playerRef = useRef(null);
  const mountedRef = useRef(true);

  // Set audio mode once on mount so sound plays through the silent/ringer switch.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      mountedRef.current = false;
      // Cleanup: release native player resources on unmount.
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          playerRef.current.remove();
        } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  const stopCurrent = () => {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.remove();
      } catch {}
      playerRef.current = null;
    }
  };

  const handlePress = (soundscape) => {
    if (!mountedRef.current) return;

    // Tapping the currently-playing track stops it.
    if (playingId === soundscape.id) {
      stopCurrent();
      if (mountedRef.current) setPlayingId(null);
      return;
    }

    // Stop whatever is currently playing before starting the new one.
    stopCurrent();

    try {
      const player = createAudioPlayer(soundscape.source);
      player.loop = true;
      player.volume = 1;
      player.play();
      playerRef.current = player;
      if (mountedRef.current) setPlayingId(soundscape.id);
    } catch (err) {
      // Playback error must never crash the screen.
      console.warn('[SoundscapePlayer] playback error', err?.message);
      playerRef.current = null;
      if (mountedRef.current) setPlayingId(null);
    }
  };

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>SOUNDSCAPES</Text>
      {SOUNDSCAPES.map((sc) => {
        const active = sc.id === playingId;
        return (
          <Pressable
            key={sc.id}
            onPress={() => handlePress(sc)}
            style={({ pressed }) => [
              s.row,
              active && s.rowActive,
              pressed && s.rowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${sc.name}${active ? ', playing' : ''}`}
            accessibilityState={{ selected: active }}
          >
            {/* Play / pause indicator — 20×20 container keeps alignment stable */}
            <View style={s.iconWrap}>
              {active
                ? <PauseIcon color={colors.gold} />
                : <PlayIcon color={colors.muted} />
              }
            </View>
            <View style={s.textWrap}>
              <Text style={[s.name, active && s.nameActive]}>{sc.name}</Text>
              <Text style={[s.desc, active && s.descActive]}>{sc.desc}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 1.8,
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44, // 44pt tap target
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 10,
      marginBottom: 4,
    },
    rowActive: {
      backgroundColor: colors.goldSoft,
    },
    rowPressed: {
      opacity: 0.75,
    },
    iconWrap: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    textWrap: {
      flex: 1,
    },
    name: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: colors.text,
      letterSpacing: 0.1,
      marginBottom: 2,
    },
    nameActive: {
      color: colors.gold,
    },
    desc: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.muted,
      lineHeight: 17,
      letterSpacing: 0.1,
    },
    descActive: {
      color: colors.gold,
      opacity: 0.75,
    },
  });
}
