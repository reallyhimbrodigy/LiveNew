import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

// Iris's signature mark. Used everywhere we want to make her presence felt —
// screen headers, quote attributions, modal labels. Two elements:
//   • the word "Iris" in italic Lora (the brand serif)
//   • a small gold dot raised slightly, like a designer's mark
// No mascot, no symbol. Reads as deliberate, precise.

export default function IrisSignature({ size = 'inline', color, style }) {
  const { colors, fonts } = useTheme();
  const isHeader = size === 'header';
  const tint = color || colors.gold;
  const s = makeStyles(colors, fonts, isHeader, tint);
  return (
    <View style={[s.row, style]}>
      <Text style={s.word}>Iris</Text>
      <Text style={s.dot}>·</Text>
    </View>
  );
}

function makeStyles(colors, fonts, isHeader, tint) {
  const wordSize = isHeader ? 18 : 13;
  const dotSize = isHeader ? 22 : 16;
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    word: {
      fontFamily: fonts.italic,
      fontSize: wordSize,
      color: tint,
      letterSpacing: 0.3,
    },
    dot: {
      fontFamily: fonts.displayBold,
      fontSize: dotSize,
      color: tint,
      marginLeft: 4,
      lineHeight: wordSize + 4,
      // The dot sits a touch lower than the baseline; align it visually.
      transform: [{ translateY: -2 }],
    },
  });
}
