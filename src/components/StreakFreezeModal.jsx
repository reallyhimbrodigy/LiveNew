import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, Animated, StyleSheet, Easing } from 'react-native';
import { useTheme } from '../theme';
import { useAuthStore, useIsPremium } from '../store/authStore';
import { tapLight, tapSuccess } from '../haptics';
import FlameIcon from './FlameIcon';

/**
 * StreakFreezeModal — the "you missed a day, save your streak?" choice.
 *
 * Shown when authStore.streakFreezeOffer is set (the streak is saveable — the
 * user missed exactly one day). A freeze is a SCARCE resource for free users
 * (one save, then a 7-day cooldown), so we never spend it silently — we ask.
 * Premium users can save anytime.
 *
 * Props:
 *   onUpgrade — fn, navigate to the paywall (for free users on cooldown)
 */
export default function StreakFreezeModal({ onUpgrade }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);

  const offer = useAuthStore((z) => z.streakFreezeOffer);
  const isPremium = useIsPremium();
  const applyStreakFreeze = useAuthStore((z) => z.applyStreakFreeze);
  const declineStreakFreeze = useAuthStore((z) => z.declineStreakFreeze);

  const visible = !!offer;
  // Eligibility is live: a user who upgrades from this very modal becomes
  // eligible without us recomputing the stored offer.
  const eligible = isPremium || !!offer?.eligible;

  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (!visible) {
      cardOpacity.setValue(0);
      cardScale.setValue(0.92);
      return;
    }
    try { tapLight(); } catch {}
    const anim = Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, tension: 90, friction: 8, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [visible]);

  if (!visible) return null;

  const count = offer?.count ?? 0;
  const cooldownDaysLeft = offer?.cooldownDaysLeft ?? 0;

  const onUse = async () => {
    try { tapSuccess(); } catch {}
    await applyStreakFreeze();
  };
  const onLetGo = async () => {
    try { tapLight(); } catch {}
    await declineStreakFreeze();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onLetGo}>
      <View style={s.overlay}>
        <Animated.View style={[s.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
          <View style={s.flameWrap}>
            <FlameIcon size={44} streak={count} strokeWidth={2} />
          </View>

          <Text style={s.eyebrow}>STREAK AT RISK</Text>
          <Text style={s.title}>You missed a day</Text>

          {eligible ? (
            <Text style={s.body}>
              Use a streak freeze to save your{' '}
              <Text style={s.bodyStrong}>{count}-day</Text> streak?
              {isPremium ? ' Premium lets you save anytime.' : ' Free includes one save, then a 7-day cooldown.'}
            </Text>
          ) : (
            <Text style={s.body}>
              Your free streak save is on cooldown —{' '}
              <Text style={s.bodyStrong}>{cooldownDaysLeft} day{cooldownDaysLeft === 1 ? '' : 's'} left</Text>.
              Go Premium to save your {count}-day streak now and freeze it anytime.
            </Text>
          )}

          {eligible ? (
            <Pressable style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]} onPress={onUse}>
              <Text style={s.primaryBtnText}>Use streak freeze</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.85 }]}
              onPress={() => { try { tapLight(); } catch {} onUpgrade && onUpgrade(); }}
            >
              <Text style={s.primaryBtnText}>Go Premium</Text>
            </Pressable>
          )}

          <Pressable style={s.secondaryBtn} onPress={onLetGo}>
            <Text style={s.secondaryBtnText}>Let it reset</Text>
          </Pressable>
        </Animated.View>
      </View>
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
      padding: 32,
      alignItems: 'center',
    },
    flameWrap: {
      width: 64,
      height: 64,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 2.4,
      marginBottom: 10,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 24,
      color: colors.text,
      letterSpacing: -0.2,
      marginBottom: 12,
      textAlign: 'center',
    },
    body: {
      fontFamily: fonts.display,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 26,
      paddingHorizontal: 4,
    },
    bodyStrong: {
      fontFamily: fonts.displaySemibold,
      color: colors.text,
    },
    primaryBtn: {
      backgroundColor: colors.gold,
      borderRadius: 12,
      paddingVertical: 15,
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
