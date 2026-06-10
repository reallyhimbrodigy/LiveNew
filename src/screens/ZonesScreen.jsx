import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  LayoutAnimation, UIManager, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight } from '../haptics';
import { ZONE_ORDER, ZONE_LABELS, getCurrentZoneId } from '../utils/score';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Your day — the full eight-zone view, pushed off Today's main scroll so the
// Today screen stays lean. Same per-zone "See why" reveal the Today inline
// block used. Reads the plan from the store exactly as Today does.
export default function ZonesScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const insets = useSafeAreaInsets();

  const todayPlan = useAuthStore(st => st.todayPlan);
  const zones = Array.isArray(todayPlan?.zones) ? todayPlan.zones : [];
  const zoneById = zones.reduce((acc, z) => { acc[z.id] = z; return acc; }, {});

  const [currentZoneId] = useState(getCurrentZoneId());
  const [openWhy, setOpenWhy] = useState({});

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        onPress={() => { tapLight(); navigation.goBack(); }}
        hitSlop={12}
        style={s.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Text style={s.backIcon}>‹</Text>
        <Text style={s.backText}>Today</Text>
      </Pressable>

      <Text style={s.title}>Your day</Text>
      <Text style={s.subtitle}>
        Eight inflection points across your cortisol curve. Tap any to see why.
      </Text>

      <View style={s.allZones}>
        {ZONE_ORDER.map((zid) => {
          const z = zoneById[zid];
          if (!z) return null;
          const isCurrent = zid === currentZoneId;
          const whyOpen = !!openWhy[zid];
          return (
            <View key={zid} style={[s.zoneListItem, isCurrent && s.zoneListItemCurrent]}>
              <Text style={s.zoneListLabel}>{ZONE_LABELS[zid]}</Text>
              <Text style={s.zoneListHeadline}>{z.headline}</Text>
              {whyOpen ? (
                <Text style={s.zoneListBody}>{z.body}</Text>
              ) : null}
              <Pressable
                onPress={() => {
                  tapLight();
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setOpenWhy(prev => ({ ...prev, [zid]: !prev[zid] }));
                }}
                hitSlop={10}
                style={s.zoneWhyBtn}
                accessibilityRole="button"
                accessibilityLabel={whyOpen ? 'Hide why' : 'See why'}
              >
                <Text style={s.zoneWhyText}>{whyOpen ? 'Hide' : 'See why'}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    scroll: {
      paddingHorizontal: 22,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      minHeight: 44,
      paddingRight: 12,
      gap: 4,
    },
    backIcon: {
      fontSize: 28,
      lineHeight: 30,
      color: colors.gold,
    },
    backText: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.gold,
      letterSpacing: 0.3,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 30,
      color: colors.text,
      letterSpacing: 0.2,
      marginTop: 12,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 22,
      letterSpacing: 0.1,
      marginBottom: 24,
    },
    allZones: { gap: 10 },
    zoneListItem: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      padding: 14,
    },
    zoneListItemCurrent: {
      borderColor: colors.goldBorder,
      backgroundColor: 'rgba(196,168,108,0.06)',
    },
    zoneListLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.gold,
      letterSpacing: 1.4,
      marginBottom: 6,
    },
    zoneListHeadline: {
      fontFamily: fonts.display,
      fontSize: 16,
      color: colors.text,
      marginBottom: 6,
      lineHeight: 22,
    },
    zoneListBody: {
      fontFamily: fonts.display,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 20,
      marginBottom: 6,
    },
    zoneWhyBtn: {
      alignSelf: 'flex-start',
      paddingTop: 4,
      paddingBottom: 2,
      paddingHorizontal: 0,
      minHeight: 44,
      justifyContent: 'center',
    },
    zoneWhyText: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.gold,
      letterSpacing: 0.4,
    },
  });
}
