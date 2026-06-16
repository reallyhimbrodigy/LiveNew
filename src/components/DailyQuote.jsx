import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { quoteForDay } from '../domain/dailyQuotes';

/**
 * DailyQuote — a calm, premium daily anchor rendered once per calendar day.
 * Displays a curated quote in italic Lora with the author attribution in
 * Manrope semibold.
 *
 * Props:
 *   style — optional ViewStyle overrides for the outer container.
 */
export default function DailyQuote({ style }) {
  const { colors, fonts } = useTheme();
  const quote = quoteForDay();

  const s = makeStyles(colors, fonts);

  return (
    <View style={[s.container, style]}>
      <Text style={s.text}>{quote.text}</Text>
      <Text style={s.author}>{`— ${quote.author}`}</Text>
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    container: {
      paddingVertical: 22,
      paddingHorizontal: 22,
      paddingTop: 8,
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
