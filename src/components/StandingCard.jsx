import React from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { useTheme } from '../theme';
import Halo from './Halo';
import { useAuthStore } from '../store/authStore';
import { standing, formatRarity } from '../domain/gems';

/**
 * StandingCard — "Your Standing" competitive flex surface.
 *
 * Reads maxStreak + haloStats from the store, computes the user's rarity
 * tier (= highest earned halo), and shows:
 *   - the halo visual
 *   - headline: "Top X%" in gold
 *   - sub-line: rarity context sentence
 *   - share button
 *
 * Props:
 *   compact  — boolean. In compact mode, null state renders nothing instead
 *              of the "start a streak" nudge.
 */
export default function StandingCard({ compact = false }) {
  const { colors, fonts } = useTheme();
  const s = React.useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const maxStreak = useAuthStore((st) => st.maxStreak);
  const haloStats = useAuthStore((st) => st.haloStats);

  const st = standing(maxStreak, haloStats);

  // ── Null state (no halo earned yet) ────────────────────────────────────────
  if (!st) {
    if (compact) return null;
    return (
      <View style={s.card}>
        <Text style={s.nullText}>
          Start a streak to earn your first halo and see where you rank.
        </Text>
      </View>
    );
  }

  // ── Standing exists ─────────────────────────────────────────────────────────
  const pctStr = formatRarity(st.pct);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `I'm in the top ${pctStr}% on LiveNew — ${st.gem.day}-day streak.`,
      });
    } catch {
      // user dismissed or error — ignore silently
    }
  };

  return (
    <View style={s.card}>
      <View style={s.row}>
        {/* Halo visual */}
        <View style={s.haloWrap}>
          <Halo gem={st.gem} earned size={44} />
        </View>

        {/* Text block */}
        <View style={s.textBlock}>
          <Text style={s.headline}>Top {pctStr}%</Text>
          <Text style={s.sub}>
            Only ~{pctStr}% of members have reached a {st.gem.day}-day streak.
          </Text>
        </View>
      </View>

      {/* Share */}
      <Pressable
        style={({ pressed }) => [s.shareBtn, pressed && s.shareBtnPressed]}
        onPress={handleShare}
        accessibilityLabel="Share your standing"
        accessibilityRole="button"
      >
        <Text style={s.shareBtnText}>Share</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
      gap: 14,
    },
    haloWrap: {
      // fixed slot so text block doesn't shift when halo is different sizes
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textBlock: {
      flex: 1,
    },
    headline: {
      fontFamily: fonts.displayBold,
      fontSize: 26,
      color: colors.gold,
      letterSpacing: 0.2,
      lineHeight: 30,
      marginBottom: 3,
    },
    sub: {
      fontFamily: fonts.display,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 19,
      letterSpacing: 0.1,
    },
    shareBtn: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 10,
      paddingVertical: 9,
      paddingHorizontal: 20,
    },
    shareBtnPressed: {
      opacity: 0.75,
    },
    shareBtnText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: colors.gold,
      letterSpacing: 0.3,
    },
    nullText: {
      fontFamily: fonts.display,
      fontSize: 14,
      color: colors.muted,
      lineHeight: 21,
      letterSpacing: 0.1,
    },
  });
}
