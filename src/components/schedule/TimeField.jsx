import React, { useState } from 'react';
import { Modal, View, Pressable, Text, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme';

function toDate(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 9, m ?? 0, 0, 0); // ?? not || so 00:00 (midnight) is preserved
  return d;
}
function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function label12(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

// Tappable "HH:MM" time. iOS opens a spinner in a dismissable bottom-sheet
// modal (the inline spinner has no Done button); Android uses the system dialog.
export default function TimeField({ value, onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={s.field} onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={s.text}>{label12(value)}</Text>
      </Pressable>
      {open && Platform.OS === 'ios' ? (
        <Modal transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={s.overlay} onPress={() => setOpen(false)} />
          <View style={s.sheet}>
            <Pressable onPress={() => setOpen(false)} style={s.done} hitSlop={8}>
              <Text style={s.doneText}>Done</Text>
            </Pressable>
            <DateTimePicker
              value={toDate(value)}
              mode="time"
              display="spinner"
              onChange={(e, d) => { if (d) onChange(toHHMM(d)); }}
            />
          </View>
        </Modal>
      ) : open ? (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display="default"
          onChange={(e, d) => { setOpen(false); if (d) onChange(toHHMM(d)); }}
        />
      ) : null}
    </>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    field: { minWidth: 84, height: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.goldBorder, backgroundColor: colors.surface },
    text: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.modalOverlay },
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24 },
    done: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingVertical: 12 },
    doneText: { fontFamily: fonts.displaySemibold, fontSize: 17, color: colors.gold },
  });
}
