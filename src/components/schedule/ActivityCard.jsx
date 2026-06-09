import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import TimeField from './TimeField';
import DayToggle from './DayToggle';

export default function ActivityCard({ block, editableLabel = false, onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const set = (patch) => onChange({ ...block, ...patch });
  return (
    <View style={s.card}>
      {editableLabel ? (
        <TextInput
          style={s.labelInput}
          value={block.label}
          onChangeText={(t) => set({ label: t })}
          placeholder="What is it?"
          placeholderTextColor={colors.dim}
          maxLength={24}
        />
      ) : (
        <Text style={s.title}>{block.label}</Text>
      )}
      <View style={s.timesRow}>
        <TimeField value={block.start} onChange={(v) => set({ start: v })} />
        <Text style={s.dash}>–</Text>
        <TimeField value={block.end || block.start} onChange={(v) => set({ end: v })} />
      </View>
      <Text style={s.caption}>Which days?</Text>
      <DayToggle value={block.days} onChange={(days) => set({ days })} />
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderWidth: 1,
      borderRadius: 16,
      padding: 18,
      gap: 14,
    },
    title: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text },
    labelInput: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, padding: 0 },
    timesRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dash: { color: colors.muted, fontSize: 18 },
    caption: { fontFamily: fonts.display, fontSize: 13, color: colors.muted, letterSpacing: 0.3 },
  });
}
