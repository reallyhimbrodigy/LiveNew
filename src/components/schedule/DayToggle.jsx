import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

const LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // index 0=Mon..6=Sun
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function DayToggle({ value = [], onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const toggle = (i) =>
    onChange(value.includes(i) ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b));
  return (
    <View style={s.row} accessibilityRole="radiogroup">
      {LABELS.map((label, i) => {
        const on = value.includes(i);
        return (
          <Pressable
            key={i}
            onPress={() => toggle(i)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={FULL[i]}
            style={[s.pill, on && s.pillOn]}
          >
            <Text style={[s.label, on && s.labelOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
    pill: {
      width: 40,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.surface,
    },
    pillOn: { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder },
    label: { fontFamily: fonts.displaySemibold, fontSize: 14, color: colors.muted },
    labelOn: { color: colors.gold },
  });
}
