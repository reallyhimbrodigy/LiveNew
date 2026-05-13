import React, { useMemo } from 'react';
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
  const s = useMemo(() => makeStyles(fonts, isHeader, tint), [fonts, isHeader, tint]);
  return (
    <View style={[s.row, style]}>
      <Text style={s.word}>Iris</Text>
      <View style={s.dot} />
    </View>
  );
}

function makeStyles(fonts, isHeader, tint) {
  const wordSize = isHeader ? 18 : 13;
  const dotSize = isHeader ? 5 : 4;
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    word: {
      fontFamily: fonts.italic,
      fontSize: wordSize,
      color: tint,
      letterSpacing: 0.3,
    },
    dot: {
      width: dotSize,
      height: dotSize,
      borderRadius: dotSize / 2,
      backgroundColor: tint,
      marginLeft: 5,
      marginBottom: isHeader ? 2 : 1,
    },
  });
}
