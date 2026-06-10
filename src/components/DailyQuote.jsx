import React from 'react';
import { Pressable, Text, StyleSheet, Share } from 'react-native';
import { useTheme } from '../theme';
import { quoteForDay } from '../domain/dailyQuotes';

/**
 * DailyQuote — a calm, premium daily anchor rendered once per calendar day.
 * Displays a curated quote with a large gold opening mark, italic body in
 * Lora, and the author attribution in Manrope semibold.
 *
 * Tapping shares the quote via the system share sheet.
 *
 * Props:
 *   style — optional ViewStyle overrides for the outer container.
 */
export default function DailyQuote({ style }) {
  const { colors, fonts } = useTheme();
  const quote = quoteForDay();

  const s = makeStyles(colors, fonts);

  const handlePress = async () => {
    try {
      await Share.share({
        message: `"${quote.text}" — ${quote.author}`,
      });
    } catch (_err) {
      // Share dismissed or unavailable — no-op
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [s.container, style, pressed && { opacity: 0.82 }]}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel="Tap to share this quote"
    >
      <Text style={s.openMark}>{'"'}</Text>
      <Text style={s.text}>{quote.text}</Text>
      <Text style={s.author}>{`— ${quote.author}`}</Text>
    </Pressable>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    container: {
      paddingVertical: 22,
      paddingHorizontal: 22,
      paddingTop: 8,
    },
    openMark: {
      fontFamily: fonts.italic,
      fontSize: 52,
      lineHeight: 46,
      color: colors.gold,
      marginBottom: 2,
      // Optical left-hang so the mark aligns with the text edge visually.
      marginLeft: -4,
    },
    text: {
      fontFamily: fonts.italic,
      fontSize: 17,
      color: colors.text,
      lineHeight: 27,
      letterSpacing: 0.1,
      marginBottom: 12,
    },
    author: {
      fontFamily: fonts.displaySemibold,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 0.8,
    },
  });
}
