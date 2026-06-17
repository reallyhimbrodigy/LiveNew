import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, Pressable, Animated, StyleSheet, Share, Easing,
} from 'react-native';
import { useTheme } from '../theme';
import { gemById, tierColor, rarityPctFor, formatRarity, gemPalette } from '../domain/gems';
import { useAuthStore } from '../store/authStore';
import Halo from './Halo';

/**
 * GemUnlockModal — premium gem-unlock reveal celebration.
 *
 * Props:
 *   gemId   — string | null  (truthy = visible)
 *   onClose — fn             (called after share or dismiss)
 *
 * Reveal sequence (all on native driver, leak-safe):
 *   0ms   — haptic
 *   0ms   — radial flash blooms behind the halo (scale + opacity)
 *   0ms   — halo scales in from 0.4 → 1.06 → 1.0 (spring overshoot)
 *   0ms   — card fades in
 *   ~400ms— shine streak sweeps across the halo (translateX)
 *   ~600ms— 6 sparkle bursts scatter outward and fade
 *   ~800ms— content (name, tier, rarity) fades up
 */

// Number of burst sparkles
const BURST_COUNT = 6;

export default function GemUnlockModal({ gemId, onClose }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const haloStats = useAuthStore(s => s.haloStats);

  // ── Animated values ────────────────────────────────────────────────────────
  // Card / backdrop
  const cardOpacity  = useRef(new Animated.Value(0)).current;
  // Halo entrance
  const haloScale    = useRef(new Animated.Value(0.4)).current;
  const haloOpacity  = useRef(new Animated.Value(0)).current;
  // Radial flash behind the halo
  const flashScale   = useRef(new Animated.Value(0.3)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  // Shine streak (translateX across the halo)
  const shineX       = useRef(new Animated.Value(-90)).current;
  const shineOpacity = useRef(new Animated.Value(0)).current;
  // Content (name + text) fade-up
  const contentY     = useRef(new Animated.Value(12)).current;
  const contentOp    = useRef(new Animated.Value(0)).current;
  // Burst sparkles: scale + opacity per dot
  const burstScales  = useRef(Array.from({ length: BURST_COUNT }, () => new Animated.Value(0))).current;
  const burstOpacs   = useRef(Array.from({ length: BURST_COUNT }, () => new Animated.Value(0))).current;

  // All running animations — stopped on re-use
  const animRefs = useRef([]);

  const visible = Boolean(gemId);
  const gem     = gemId ? gemById(gemId) : null;
  const pal     = gem ? gemPalette(gem) : null;

  // Reset all values to their start position
  function resetAnims() {
    cardOpacity.setValue(0);
    haloScale.setValue(0.4);
    haloOpacity.setValue(0);
    flashScale.setValue(0.3);
    flashOpacity.setValue(0);
    shineX.setValue(-90);
    shineOpacity.setValue(0);
    contentY.setValue(12);
    contentOp.setValue(0);
    burstScales.forEach((v) => v.setValue(0));
    burstOpacs.forEach((v) => v.setValue(0));
  }

  useEffect(() => {
    // Stop any running animations from a previous open
    animRefs.current.forEach((a) => a.stop());
    animRefs.current = [];

    if (!visible) {
      resetAnims();
      return;
    }

    // Haptic
    try { require('../haptics').tapSuccess(); } catch {}

    // ── Phase 1 (t=0): card fade-in + halo entrance + radial flash ──────────
    const phase1 = Animated.parallel([
      // Card fade in
      Animated.timing(cardOpacity, {
        toValue: 1, duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Halo: opacity quick appear
      Animated.timing(haloOpacity, {
        toValue: 1, duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Halo: spring scale-in with overshoot (0.4 → 1.06 → 1.0)
      Animated.spring(haloScale, {
        toValue: 1,
        useNativeDriver: true,
        tension:  90,
        friction: 6,
      }),
      // Flash: blooms quickly then fades
      Animated.sequence([
        Animated.parallel([
          Animated.timing(flashOpacity, {
            toValue: 0.55, duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(flashScale, {
            toValue: 1.4, duration: 380,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(flashOpacity, {
          toValue: 0, duration: 420,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    // ── Phase 2 (t≈300ms): shine streak sweeps + burst sparkles ─────────────
    const phase2 = Animated.parallel([
      // Shine: fade in, slide across, fade out
      Animated.sequence([
        Animated.timing(shineOpacity, {
          toValue: 0.9, duration: 80,
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(shineX, {
            toValue: 90, duration: 340,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(200),
            Animated.timing(shineOpacity, {
              toValue: 0, duration: 120,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
      // Burst sparkles: each shoots out from center and fades
      ...burstScales.map((scaleV, i) =>
        Animated.sequence([
          Animated.delay(i * 40),
          Animated.parallel([
            Animated.timing(scaleV, {
              toValue: 1, duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.timing(burstOpacs[i], {
                toValue: 1, duration: 120,
                useNativeDriver: true,
              }),
              Animated.timing(burstOpacs[i], {
                toValue: 0, duration: 260,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
              }),
            ]),
          ]),
        ])
      ),
    ]);

    // ── Phase 3 (t≈550ms): content fades up ──────────────────────────────────
    const phase3 = Animated.parallel([
      Animated.timing(contentOp, {
        toValue: 1, duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(contentY, {
        toValue: 0, duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    // Run the full sequence
    const seq = Animated.sequence([
      phase1,
      Animated.delay(120),
      phase2,
      Animated.delay(100),
      phase3,
    ]);

    seq.start();
    animRefs.current = [seq];

    return () => {
      animRefs.current.forEach((a) => a.stop());
    };
  }, [visible]);

  const handleShare = async () => {
    if (!gem) return;
    try {
      await Share.share({
        message: `I just earned the "${gem.name}" gem on LiveNew — held by only ~${formatRarity(rarityPctFor(gem, haloStats))}% of members.`,
      });
    } catch {}
    onClose();
  };

  if (!visible || !gem) return null;

  // Burst sparkle positions — distributed around the halo
  const HALO_R   = 80; // half of the 160-wide gemWrap
  const burstDots = Array.from({ length: BURST_COUNT }, (_, i) => {
    const angle  = (2 * Math.PI * i) / BURST_COUNT - Math.PI / 2;
    const startR = HALO_R * 0.55;
    const endR   = HALO_R * 1.05;
    return {
      // We animate via scale on the dot, but position it at a fixed angle
      // on a circle so the burst reads as radiating outward.
      x: Math.cos(angle),
      y: Math.sin(angle),
      startR,
      endR,
    };
  });

  // No pending unlock → render nothing. This MUST come after all hooks above
  // (the useRefs + the single reveal useEffect) so hook order stays stable.
  // Without it, the gem dereferences below and in the JSX crash on every Today
  // render (pendingGemUnlock is null in the normal case) — the post-boot crash.
  if (!gem) return null;

  const gemColor = pal?.mid ?? gem.hue;
  const shineColor = pal?.core ?? '#ffffff';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <Animated.View style={[s.card, { opacity: cardOpacity }]}>
          <Pressable onPress={() => {}} style={s.cardInner}>

            {/* Eyebrow */}
            <Text style={s.eyebrow}>GEM UNLOCKED</Text>

            {/* ── Halo reveal area ──────────────────────────────────────────── */}
            <View style={s.gemWrap}>

              {/* Radial flash bloom — behind everything */}
              <Animated.View
                pointerEvents="none"
                style={[
                  s.flashRing,
                  {
                    backgroundColor: gemColor,
                    opacity: flashOpacity,
                    transform: [{ scale: flashScale }],
                  },
                ]}
              />

              {/* Burst sparkles — radiate outward from center */}
              {burstDots.map((dot, i) => (
                <Animated.View
                  key={i}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    width: 5,
                    height: 5,
                    borderRadius: 5,
                    backgroundColor: i % 2 === 0 ? gemColor : shineColor,
                    // Position at the end radius along its angle; scale animates from 0
                    // but since we can't animate x/y on native driver, we translate the
                    // dot from center toward its orbit using a fixed position + scale
                    // that expands it. Since native driver can't do custom translate per
                    // dot, we place each at an orbit mid-point and animate opacity only.
                    left: HALO_R + dot.x * HALO_R * 0.78 - 2.5,
                    top:  HALO_R + dot.y * HALO_R * 0.78 - 2.5,
                    opacity: burstOpacs[i],
                  }}
                />
              ))}

              {/* The halo itself — spring scale-in */}
              <Animated.View
                style={{
                  transform: [{ scale: haloScale }],
                  opacity: haloOpacity,
                }}
              >
                <Halo gem={gem} earned size={140} />
              </Animated.View>

              {/* Shine streak — sweeps left→right over the halo */}
              <Animated.View
                pointerEvents="none"
                style={[
                  s.shineStreak,
                  {
                    opacity: shineOpacity,
                    transform: [{ translateX: shineX }, { rotate: '-28deg' }],
                  },
                ]}
              />
            </View>

            {/* ── Text content — fades up after halo settles ──────────────── */}
            <Animated.View
              style={{ opacity: contentOp, transform: [{ translateY: contentY }], alignItems: 'center' }}
            >
              <Text style={s.gemName}>{gem.name}</Text>
              <Text style={[s.gemTier, { color: tierColor(gem.tier) }]}>
                {gem.tier.toUpperCase()}
              </Text>
              <Text style={s.rarity}>
                {`Held by ~${formatRarity(rarityPctFor(gem, haloStats))}% of members`}
              </Text>
              <Text style={s.flavor}>{gem.flavor}</Text>
            </Animated.View>

            {/* Buttons */}
            <Pressable
              style={({ pressed }) => [s.primaryBtn, { borderColor: gemColor }, pressed && { opacity: 0.85 }]}
              onPress={handleShare}
            >
              <Text style={s.primaryBtnText}>Share</Text>
            </Pressable>

            <Pressable style={s.secondaryBtn} onPress={onClose}>
              <Text style={s.secondaryBtnText}>Keep going</Text>
            </Pressable>

          </Pressable>
        </Animated.View>
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
      borderRadius: 24,
      width: '100%',
      borderWidth: 1,
      borderColor: colors.goldBorder,
      overflow: 'hidden',
    },
    cardInner: {
      padding: 32,
      alignItems: 'center',
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 2.4,
      marginBottom: 24,
    },
    gemWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 160,
      height: 160,
      marginBottom: 24,
    },
    flashRing: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
    },
    shineStreak: {
      position: 'absolute',
      width: 22,
      height: 200,
      borderRadius: 11,
      backgroundColor: '#ffffff',
      // Centered horizontally on the halo
      left: 69,
      top: -20,
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
      fontSize: 11,
      letterSpacing: 2.8,
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
      borderWidth: 1,
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
