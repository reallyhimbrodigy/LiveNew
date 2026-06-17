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

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // 0=Mon … 6=Sun

function fmtTime(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')}${am ? 'am' : 'pm'}`;
}
function fmtDays(days) {
  if (!Array.isArray(days) || days.length === 0) return '';
  const sorted = [...days].sort((a, b) => a - b);
  const key = sorted.join(',');
  if (sorted.length === 7) return 'Every day';
  if (key === '0,1,2,3,4') return 'Weekdays';
  if (key === '5,6') return 'Weekends';
  return sorted.map((d) => DAY_ABBR[d]).filter(Boolean).join(', ');
}
function blockSummary(b) {
  const time = b.start ? `${fmtTime(b.start)}${b.end ? ` – ${fmtTime(b.end)}` : ''}` : 'Anytime';
  const days = fmtDays(b.days);
  return [time, days].filter(Boolean).join('  ·  ');
}

/**
 * ScheduleBuilder — the routine editor.
 *
 * Flow (sound + reversible, no dead ends):
 *   triage   — pick which things are in your week (chips)
 *   overview — THE HUB: your week as a list; tap any item to edit its time,
 *              "Add or edit" to change which things are in your week, "Done"
 *              to save. Editing an existing routine opens straight here.
 *   activity — edit ONE item's time/days, with a Back to the overview.
 *
 * Every sub-screen has a Back to the hub, so you can always return to "the main
 * part" instead of being forced forward.
 */
export default function ScheduleBuilder({ onComplete, initial }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);

  const initialBlocks = Array.isArray(initial?.blocks) ? initial.blocks : [];
  const initialTypes = [...new Set(initialBlocks.map((b) => b.type).filter(Boolean))];

  // Editing an existing routine? Open on the overview (the main part). Fresh
  // (onboarding)? Start by picking what's in the week.
  const [stage, setStage] = useState(initialBlocks.length ? 'overview' : 'triage');
  const [selected, setSelected] = useState(initialTypes);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [cursor, setCursor] = useState(0);

  const toggleType = (t) =>
    setSelected((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  // Reconcile blocks with the current chip selection: keep existing blocks for
  // still-selected types (preserving their times), drop deselected ones, add
  // defaults for newly-selected ones. Then land on the overview hub.
  const applySelection = () => {
    let n = blocks.length;
    const seeded = selected.map((t) => {
      const existing = blocks.find((b) => b.type === t);
      if (existing) return existing;
      const def = TYPES.find((x) => x.type === t);
      return {
        id: `b${n++}`, type: def.type, label: def.type === 'custom' ? 'Something else' : def.label,
        start: def.start, end: def.end, days: [...def.defaultDays],
      };
    });
    setBlocks(seeded);
    if (seeded.length === 0) {
      onComplete(normalizeSchedule({ blocks: [], meals: DEFAULT_MEALS }));
      return;
    }
    setStage('overview');
  };

  const editBlock = (i) => { setCursor(i); setStage('activity'); };
  const finish = () => onComplete(normalizeSchedule({ blocks, meals: DEFAULT_MEALS }));

  // ── Small reusable header with an optional Back to the hub ─────────────────
  // Plain render fn (not a nested component) so it never remounts on re-render.
  const renderHeader = (onBack, title, subtitle) => (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}>
          <Text style={s.backText}>‹  Your week</Text>
        </Pressable>
      ) : null}
      <Text style={s.iris}>{title}</Text>
      {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
    </View>
  );

  // ── TRIAGE — pick what's in the week ───────────────────────────────────────
  if (stage === 'triage') {
    const canGoBack = blocks.length > 0; // there's an overview to return to
    return (
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        {renderHeader(
          canGoBack ? () => setStage('overview') : null,
          "What's in your week?",
          "Tap what you've got — I'll only ask about those.",
        )}
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
        <Pressable style={s.cta} onPress={applySelection}>
          <Text style={s.ctaText}>{selected.length ? 'Continue' : 'Skip for now'}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── OVERVIEW — the hub: your week, tap any item to edit ────────────────────
  if (stage === 'overview') {
    return (
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        {renderHeader(null, 'Your week', 'Tap anything to adjust its time. This is what I build your day around.')}

        <View style={s.list}>
          {blocks.map((b, i) => (
            <Pressable
              key={b.id || i}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              onPress={() => editBlock(i)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${b.label || 'activity'}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{b.label || 'Something else'}</Text>
                <Text style={s.rowSummary}>{blockSummary(b)}</Text>
              </View>
              <Text style={s.rowChevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={s.secondaryBtn} onPress={() => setStage('triage')}>
          <Text style={s.secondaryBtnText}>Add or edit what's in your week</Text>
        </Pressable>

        <Pressable style={s.cta} onPress={finish}>
          <Text style={s.ctaText}>Done</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── ACTIVITY — edit one item, Back to the hub ──────────────────────────────
  const block = blocks[cursor];
  if (!block) { setStage('overview'); return null; }
  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      {renderHeader(() => setStage('overview'), `When's ${block.label || 'this'}?`, null)}
      <ActivityCard
        block={block}
        editableLabel={block.type === 'custom'}
        onChange={(nb) => setBlocks((bs) => bs.map((b, i) => (i === cursor ? nb : b)))}
      />
      <Pressable style={s.cta} onPress={() => setStage('overview')}>
        <Text style={s.ctaText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    wrap: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32, gap: 16 },
    header: { gap: 6 },
    backBtn: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 2 },
    backText: { fontFamily: fonts.displaySemibold, fontSize: 15, color: colors.gold, letterSpacing: 0.2 },
    iris: { fontFamily: fonts.displayBold, fontSize: 27, color: colors.text, letterSpacing: -0.3 },
    sub: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, lineHeight: 22 },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    chip: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder },
    chipText: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.muted },
    chipTextOn: { color: colors.gold },

    // Overview list
    list: { gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    rowLabel: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text, marginBottom: 3, letterSpacing: 0.1 },
    rowSummary: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, letterSpacing: 0.1 },
    rowChevron: { fontFamily: fonts.displaySemibold, fontSize: 22, color: colors.gold, marginLeft: 12 },

    cta: { marginTop: 8, backgroundColor: colors.gold, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
    ctaText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 17 },
    secondaryBtn: { paddingVertical: 14, alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.goldBorder },
    secondaryBtnText: { fontFamily: fonts.displaySemibold, fontSize: 15, color: colors.gold, letterSpacing: 0.2 },
  });
}
