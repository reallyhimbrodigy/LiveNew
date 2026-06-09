import React, { useState } from 'react';
import { Pressable, Text, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme';

function toDate(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const d = new Date();
  d.setHours(h || 9, m || 0, 0, 0);
  return d;
}

function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function label12(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const ap = h < 12 ? 'a' : 'p';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

export default function TimeField({ value, onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={s.field} onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={s.text}>{label12(value)}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => {
            setOpen(Platform.OS === 'ios');
            if (d) onChange(toHHMM(d));
          }}
        />
      )}
    </>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    field: {
      minWidth: 84,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 12,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.goldBorder,
      backgroundColor: colors.surface,
    },
    text: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text },
  });
}
