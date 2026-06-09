import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, Pressable, Animated, StyleSheet, Share,
} from 'react-native';
import { useTheme } from '../theme';
import { gemById, tierColor, rarityPctFor, formatRarity } from '../domain/gems';
import { useAuthStore } from '../store/authStore';
import Halo from './Halo';

/**
 * GemUnlockModal — gem-unlock reveal celebration.
 *
 * Props:
 *   gemId   — string | null  (truthy = visible)
 *   onClose — fn             (called after share or dismiss)
 */
export default function GemUnlockModal({ gemId, onClose }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const haloStats = useAuthStore(s => s.haloStats);

  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  const visible = Boolean(gemId);
  const gem = gemId ? gemById(gemId) : null;

  // Entrance animation whenever the modal becomes visible.
  useEffect(() => {
    if (!visible) {
      // Reset for the next open.
      scale.setValue(0.6);
      opacity.setValue(0);
      glowOpacity.setValue(0);
      return;
    }

    // Haptic feedback on open.
    try { require('../haptics').tapSuccess(); } catch {}

    // Scale + opacity spring.
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 7,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Brief glow pulse after entrance settles.
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start();
    });
  }, [visible]);

  const handleShare = async () => {
    if (!gem) return;
    try {
      await Share.share({
        message: `I just earned the "${gem.name}" halo on LiveNew — held by only ~${formatRarity(rarityPctFor(gem, haloStats))}% of members.`,
      });
    } catch {}
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  if (!visible || !gem) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={s.overlay} onPress={handleClose}>
        <Pressable style={s.card} onPress={() => {}}>

          {/* Eyebrow */}
          <Text style={s.eyebrow}>HALO UNLOCKED</Text>

          {/* Animated halo with glow pulse */}
          <View style={s.gemWrap}>
            {/* Glow ring behind the halo */}
            {gem ? (
              <Animated.View
                style={[
                  s.glowRing,
                  { backgroundColor: gem.hue, opacity: glowOpacity },
                ]}
              />
            ) : null}

            <Animated.View style={{ transform: [{ scale }], opacity }}>
              {gem ? <Halo gem={gem} earned size={140} /> : null}
            </Animated.View>
          </View>

          {/* Gem name */}
          <Text style={s.gemName}>{gem ? gem.name : ''}</Text>

          {/* Tier */}
          <Text style={[s.gemTier, gem ? { color: tierColor(gem.tier) } : null]}>
            {gem ? gem.tier : ''}
          </Text>

          {/* Rarity */}
          <Text style={s.rarity}>
            {gem ? `Held by ~${formatRarity(rarityPctFor(gem, haloStats))}% of members` : ''}
          </Text>

          {/* Flavor */}
          <Text style={s.flavor}>{gem ? gem.flavor : ''}</Text>

          {/* Buttons */}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={handleShare}
          >
            <Text style={s.primaryBtnText}>Share</Text>
          </Pressable>

          <Pressable style={s.secondaryBtn} onPress={handleClose}>
            <Text style={s.secondaryBtnText}>Keep going</Text>
          </Pressable>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 28,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 22,
      padding: 32,
      width: '100%',
      borderWidth: 1,
      borderColor: colors.goldBorder,
      alignItems: 'center',
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 3,
      marginBottom: 24,
    },
    gemWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 160,
      height: 160,
      marginBottom: 24,
    },
    glowRing: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
    },
    gemName: {
      fontFamily: fonts.displayBold,
      fontSize: 26,
      color: colors.text,
      letterSpacing: -0.2,
      marginBottom: 6,
      textAlign: 'center',
    },
    gemTier: {
      fontFamily: fonts.displaySemibold,
      fontSize: 12,
      letterSpacing: 2.5,
      marginBottom: 10,
      textAlign: 'center',
    },
    rarity: {
      fontFamily: fonts.display,
      fontSize: 13,
      color: colors.muted,
      letterSpacing: 0.1,
      marginBottom: 14,
      textAlign: 'center',
    },
    flavor: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 28,
      paddingHorizontal: 8,
    },
    primaryBtn: {
      backgroundColor: colors.gold,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      alignSelf: 'stretch',
      marginBottom: 4,
    },
    primaryBtnText: {
      color: '#1a1612',
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      letterSpacing: 0.2,
    },
    secondaryBtn: {
      paddingVertical: 14,
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    secondaryBtnText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: colors.muted,
      letterSpacing: 0.5,
    },
  });
}
