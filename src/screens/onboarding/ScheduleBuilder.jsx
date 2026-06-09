import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import ActivityCard from '../../components/schedule/ActivityCard';
import { normalizeSchedule, DEFAULT_MEALS } from '../../domain/schedule.js';

const TYPES = [
  { type: 'work',    label: 'Work',              defaultDays: [0,1,2,3,4], start: '09:00', end: '17:00' },
  { type: 'school',  label: 'School',            defaultDays: [0,1,2,3,4], start: '08:00', end: '15:00' },
  { type: 'gym',     label: 'Gym / workouts',    defaultDays: [1,3,5],     start: '18:00', end: '19:00' },
  { type: 'kids',    label: 'Kids / caregiving', defaultDays: [0,1,2,3,4], start: '08:00', end: null },
  { type: 'commute', label: 'Commute',           defaultDays: [0,1,2,3,4], start: '08:00', end: '09:00' },
  { type: 'custom',  label: 'Something else',    defaultDays: [0,1,2,3,4], start: '12:00', end: null },
];

export default function ScheduleBuilder({ onComplete }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const [stage, setStage] = useState('triage');
  const [selected, setSelected] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [cursor, setCursor] = useState(0);

  const toggleType = (t) =>
    setSelected((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const startActivities = () => {
    let n = 0;
    const seeded = selected.map((t) => {
      const def = TYPES.find((x) => x.type === t);
      return { id: `b${n++}`, type: def.type, label: def.type === 'custom' ? '' : def.label,
               start: def.start, end: def.end, days: [...def.defaultDays] };
    });
    setBlocks(seeded);
    setCursor(0);
    setStage(seeded.length ? 'activity' : 'wrap');
  };

  const finish = () => onComplete(normalizeSchedule({ blocks, meals: DEFAULT_MEALS }));

  if (stage === 'triage') {
    return (
      <View style={s.wrap}>
        <Text style={s.iris}>What's in your week?</Text>
        <Text style={s.sub}>Tap what you've got — I'll only ask about those.</Text>
        <View style={s.chips}>
          {TYPES.map((t) => {
            const on = selected.includes(t.type);
            return (
              <Pressable key={t.type} onPress={() => toggleType(t.type)} style={[s.chip, on && s.chipOn]}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={s.cta} onPress={startActivities}>
          <Text style={s.ctaText}>{selected.length ? 'Continue' : 'Skip for now'}</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === 'activity') {
    const block = blocks[cursor];
    const last = cursor === blocks.length - 1;
    return (
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.progress}>{cursor + 1} / {blocks.length}</Text>
        <Text style={s.iris}>When's {block.label || 'this'}?</Text>
        <ActivityCard
          block={block}
          editableLabel={block.type === 'custom'}
          onChange={(nb) => setBlocks((bs) => bs.map((b, i) => (i === cursor ? nb : b)))}
        />
        <Pressable style={s.cta} onPress={() => (last ? setStage('wrap') : setCursor((c) => c + 1))}>
          <Text style={s.ctaText}>{last ? 'Almost done' : 'Next'}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.iris}>That's all I need.</Text>
      <Text style={s.sub}>Wake & sleep — I'll read from your phone where I can.</Text>
      <Text style={s.sub}>Meals — usual times; you can tweak them later.</Text>
      <Pressable style={s.cta} onPress={finish}>
        <Text style={s.ctaText}>See today's plan</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    wrap: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, gap: 16 },
    iris: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.text, letterSpacing: -0.3 },
    sub: { fontFamily: fonts.body, fontSize: 16, color: colors.muted, lineHeight: 23 },
    progress: { fontFamily: fonts.displaySemibold, fontSize: 13, color: colors.gold, letterSpacing: 1.5 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    chip: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder },
    chipText: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.muted },
    chipTextOn: { color: colors.gold },
    cta: { marginTop: 8, backgroundColor: colors.gold, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
    ctaText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 17 },
  });
}
