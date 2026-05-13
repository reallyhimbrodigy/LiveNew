import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Switch,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Linking, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapMedium } from '../haptics';
import { truncateGoal } from '../utils/goalText';
import StreakShareCard, { milestoneTier } from '../components/StreakShareCard';
import InviteShareCard from '../components/InviteShareCard';
import IrisSignature from '../components/IrisSignature';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getNotificationPermission, requestPermissions,
  getNotificationPrefs, setNotificationPrefs,
  scheduleSessionReminders, clearAllZoneNotifications,
} from '../notifications';
import { ZONE_LABELS } from '../utils/score';

const GOAL_OPTIONS = [
  { label: 'Sleep better', value: 'I want to sleep through the night and wake up rested', emoji: '\u{1F319}' },
  { label: 'Less anxiety', value: 'I want to stop feeling anxious and overwhelmed all day', emoji: '\u{1F32C}️' },
  { label: 'More energy', value: 'I want consistent energy throughout the day without crashing', emoji: '⚡' },
  { label: 'Lose weight', value: 'I want to lose weight and stop stress eating', emoji: '\u{1F331}' },
  { label: 'Be calmer', value: 'I want to feel calm and in control of my stress', emoji: '\u{1F9D8}' },
  { label: 'Feel better', value: 'I just want to feel better overall', emoji: '✨' },
];

export default function AccountScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const profile = useAuthStore(s => s.profile);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const logout = useAuthStore(s => s.logout);
  const deleteAccount = useAuthStore(s => s.deleteAccount);
  const saveProfile = useAuthStore(s => s.saveProfile);
  const streak = useAuthStore(s => s.streak);
  const healthPermission = useAuthStore(s => s.healthPermission);
  const connectHealth = useAuthStore(s => s.connectHealth);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(null);
  const shareCardRef = useRef(null);
  const todayPlan = useAuthStore(z => z.todayPlan);
  const [shareVariant, setShareVariantState] = useState('dark');

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('livenew:share_card_variant');
        if (v === 'cream' || v === 'dark') setShareVariantState(v);
      } catch {}
    })();
  }, []);

  const toggleShareVariant = async () => {
    tapLight();
    const next = shareVariant === 'dark' ? 'cream' : 'dark';
    setShareVariantState(next);
    try { await AsyncStorage.setItem('livenew:share_card_variant', next); } catch {}
  };

  // Notification state
  const [notifPerm, setNotifPerm] = useState('unknown');
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [showZonePrefs, setShowZonePrefs] = useState(false);

  useEffect(() => {
    (async () => {
      const perm = await getNotificationPermission();
      setNotifPerm(perm);
      const prefs = await getNotificationPrefs();
      setNotifPrefs(prefs);
    })();
  }, []);

  const handleEnableNotifications = async () => {
    tapSelect();
    const ok = await requestPermissions();
    setNotifPerm(ok ? 'granted' : 'denied');
    if (ok && todayPlan?.zones) {
      try { await scheduleSessionReminders(todayPlan.zones); } catch {}
    }
    if (!ok) {
      Alert.alert(
        'Notifications off',
        'You can turn them on later in Settings → Notifications → LiveNew.',
      );
    }
  };

  const toggleZonePref = async (zoneId) => {
    if (!notifPrefs) return;
    tapLight();
    const next = { ...notifPrefs, [zoneId]: !notifPrefs[zoneId] };
    setNotifPrefs(next);
    await setNotificationPrefs(next);
    if (notifPerm === 'granted' && todayPlan?.zones) {
      try { await scheduleSessionReminders(todayPlan.zones); } catch {}
    }
  };

  const notifEnabledCount = notifPrefs
    ? Object.values(notifPrefs).filter(Boolean).length
    : 0;

  const shareAs = async (type, payload, message) => {
    tapSelect();
    setSharing({ type, payload });
    await new Promise(r => setTimeout(r, 80));
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Share.share({ url: uri, message });
    } catch (err) {
      console.warn('[share]', err?.message);
    } finally {
      setSharing(null);
    }
  };

  const handleShareStreak = () => {
    if (!streak || streak < 1) return;
    const tier = milestoneTier(streak);
    shareAs('streak', { days: streak }, `${streak} day${streak === 1 ? '' : 's'} on LiveNew — ${tier.subtitle}`);
  };

  const handleInviteFriend = () => {
    // Rotate through invite-card copy so back-to-back shares aren't identical.
    const lineIndex = Math.floor(Math.random() * 3);
    const messages = [
      'Lower your cortisol by tonight. — Iris @ LiveNew',
      'Iris reads bodies and tells the truth. — LiveNew',
      "Eight zones a day. No timers. No sessions. — Iris @ LiveNew",
    ];
    shareAs('invite', { lineIndex }, messages[lineIndex]);
  };

  const handleEdit = (field) => {
    tapSelect();
    setEditValue(field === 'routine' ? (profile?.routine || '') : (profile?.goal || ''));
    setEditing(field);
  };

  const handleSave = async () => {
    if (!editValue.trim()) return;
    tapLight();
    setSaving(true);
    try {
      const updated = { ...profile, [editing]: editValue.trim() };
      await saveProfile(updated);
      setSaving(false);
      setEditing(null);
      // Plan was cleared — send user to re-check-in with updated profile
      try {
        const parent = navigation.getParent();
        if (parent) {
          parent.navigate('Today', { screen: 'StressTap' });
        }
      } catch {}
      Alert.alert('Updated', 'Your plan will refresh with your new profile on the next check-in.');
    } catch {
      Alert.alert('Error', 'Could not save. Try again.');
      setSaving(false);
    }
  };

  const handleLogout = () => {
    tapSelect();
    Alert.alert('Log out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const handleDelete = () => {
    tapSelect();
    Alert.alert(
      'Delete account',
      'This permanently deletes your account, all your data, and your progress. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try { await deleteAccount(); } catch {
              Alert.alert('Error', 'Could not delete account. Try again.');
            }
            setDeleting(false);
          },
        },
      ]
    );
  };

  const handleGoalSelect = async (goalValue) => {
    tapMedium();
    setSaving(true);
    try {
      const updated = { ...profile, goal: goalValue };
      await saveProfile(updated);
      setSaving(false);
      setEditing(null);
      try {
        const parent = navigation.getParent();
        if (parent) parent.navigate('Today', { screen: 'StressTap' });
      } catch {}
      Alert.alert('Updated', 'Your plan will refresh with your new goal on the next check-in.');
    } catch {
      Alert.alert('Error', 'Could not save. Try again.');
      setSaving(false);
    }
  };

  // Edit screen
  if (editing) {
    // Goal editing uses preset options (same as onboarding)
    if (editing === 'goal') {
      return (
        <SafeAreaView style={s.safe}>
          <View style={s.editWrap}>
            <Text style={s.editTitle}>What's your goal?</Text>
            <Text style={s.editSub}>Pick the one that matters most right now</Text>
            {saving ? (
              <View style={{ alignItems: 'center', paddingTop: 32 }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 16 }}>Saving...</Text>
              </View>
            ) : (
              <View style={s.goalGrid}>
                {GOAL_OPTIONS.map(option => (
                  <Pressable
                    key={option.value}
                    style={s.goalOption}
                    onPress={() => handleGoalSelect(option.value)}

                  >
                    <Text style={s.goalEmoji}>{option.emoji}</Text>
                    <Text style={s.goalLabel}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable style={s.cancelBtn} onPress={() => setEditing(null)}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    // Routine editing uses text input
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.editWrap}>
            <Text style={s.editTitle}>Update your routine</Text>
            <Text style={s.editSub}>This shapes when and how LiveNew builds your plan.</Text>
            <TextInput
              style={s.editInput}
              value={editValue}
              onChangeText={setEditValue}
              multiline
              textAlignVertical="top"
              autoFocus
              placeholderTextColor={colors.dim}
              placeholder="Describe your daily routine..."
            />
            <Pressable
              style={[s.saveBtn, (!editValue.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleSave}
              disabled={!editValue.trim() || saving}

            >
              <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
            <Pressable style={s.cancelBtn} onPress={() => setEditing(null)}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.headerRow}>
          <Text style={s.heading}>Account</Text>
          <IrisSignature />
        </View>

        {/* Subscription status */}
        <View style={s.card}>
          <View style={s.statusRow}>
            <View style={[s.statusBadge, isSubscribed && s.statusBadgeActive]}>
              <Text style={[s.statusBadgeText, isSubscribed && s.statusBadgeTextActive]}>
                {isSubscribed ? 'PRO' : 'FREE'}
              </Text>
            </View>
            <View style={s.statusContent}>
              <Text style={s.statusTitle}>{isSubscribed ? 'LiveNew Pro' : 'Free plan'}</Text>
              <Text style={s.statusSub}>
                {isSubscribed ? 'Full access to all features' : 'Upgrade for unlimited plans'}
              </Text>
            </View>
          </View>
          {streak > 0 && (
            <Pressable style={s.streakRow} onPress={handleShareStreak}>
              <Text style={s.streakText}>{streak} day streak 🔥</Text>
              <Text style={s.streakShareHint}>Tap to share</Text>
            </Pressable>
          )}
          {isSubscribed && (
            <>
              <View style={s.settingDivider} />
              <Pressable
                style={s.settingRow}
                onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
              >
                <View style={s.settingContent}>
                  <Text style={s.settingTitle}>Manage subscription</Text>
                  <Text style={s.settingValue}>Change or cancel in App Store</Text>
                </View>
                <Text style={s.settingArrow}>›</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Profile section */}
        <Text style={s.sectionTitle}>Your profile</Text>

        <View style={s.card}>
          <Pressable style={s.settingRow} onPress={() => handleEdit('routine')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>My routine</Text>
              <Text style={s.settingValue} numberOfLines={2}>{profile?.routine || 'Not set'}</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => handleEdit('goal')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>My goal</Text>
              <Text style={s.settingValue} numberOfLines={2}>{profile?.goal ? truncateGoal(profile.goal) : 'Not set'}</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>
        </View>

        {/* Share section */}
        <Text style={s.sectionTitle}>Share</Text>

        <View style={s.card}>
          {streak > 0 ? (
            <>
              <Pressable style={s.settingRow} onPress={handleShareStreak}>
                <View style={s.settingContent}>
                  <Text style={s.settingTitle}>Share my streak</Text>
                  <Text style={s.settingValue}>{streak} day{streak === 1 ? '' : 's'} with Iris</Text>
                </View>
                <Text style={s.settingArrow}>›</Text>
              </Pressable>
              <View style={s.settingDivider} />
            </>
          ) : null}
          <Pressable style={s.settingRow} onPress={handleInviteFriend}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Invite a friend</Text>
              <Text style={s.settingValue}>Send them what Iris told you today</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>
          <View style={s.settingDivider} />
          <Pressable style={s.settingRow} onPress={toggleShareVariant}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Card style</Text>
              <Text style={s.settingValue}>
                {shareVariant === 'dark' ? 'Dark · pops on any feed' : 'Cream · on-brand and soft'}
              </Text>
            </View>
            <Text style={s.settingArrow}>↺</Text>
          </Pressable>
        </View>

        {/* Notifications section */}
        <Text style={s.sectionTitle}>Notifications</Text>

        <View style={s.card}>
          <Pressable
            style={s.settingRow}
            onPress={() => {
              if (notifPerm !== 'granted') handleEnableNotifications();
              else setShowZonePrefs(v => !v);
            }}
          >
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>
                {notifPerm === 'granted' ? `Iris pings: ${notifEnabledCount} of 8 zones` : 'Turn on Iris pings'}
              </Text>
              <Text style={s.settingValue}>
                {notifPerm === 'granted'
                  ? 'Tap to pick which zones notify you.'
                  : 'A nudge from Iris at the moments that matter most.'}
              </Text>
            </View>
            <Text style={s.settingArrow}>
              {notifPerm === 'granted' ? (showZonePrefs ? '▾' : '›') : '›'}
            </Text>
          </Pressable>

          {notifPerm === 'granted' && showZonePrefs && notifPrefs ? (
            <View>
              {Object.keys(ZONE_LABELS).map((zid, idx) => (
                <View key={zid} style={[s.settingRow, idx === 0 && s.settingDivider]}>
                  <View style={s.settingContent}>
                    <Text style={s.zoneToggleTitle}>{ZONE_LABELS[zid]}</Text>
                  </View>
                  <Switch
                    value={!!notifPrefs[zid]}
                    onValueChange={() => toggleZonePref(zid)}
                    trackColor={{ false: colors.line, true: colors.gold }}
                    thumbColor={colors.bg}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Apple Health section */}
        <Text style={s.sectionTitle}>Apple Health</Text>

        <View style={s.card}>
          <Pressable
            style={s.settingRow}
            onPress={async () => {
              if (healthPermission === 'granted') {
                Alert.alert(
                  'Apple Health',
                  'You\'re connected. To revoke access, open the Health app → Sharing → Apps → LiveNew.',
                );
                return;
              }
              tapSelect();
              await connectHealth();
            }}
          >
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>
                {healthPermission === 'granted' ? 'Connected' : 'Connect Apple Health'}
              </Text>
              <Text style={s.settingValue}>
                {healthPermission === 'granted'
                  ? 'Sleep, resting heart rate, and HRV power your score.'
                  : 'Reads sleep, RHR, and HRV. The score becomes legitimate.'}
              </Text>
            </View>
            <Text style={s.settingArrow}>{healthPermission === 'granted' ? '✓' : '›'}</Text>
          </Pressable>
        </View>

        {/* Support section */}
        <Text style={s.sectionTitle}>Support</Text>

        <View style={s.card}>
          <Pressable style={s.settingRow} onPress={() => Linking.openURL('https://livenew.app/help')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Help center</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => Linking.openURL('mailto:support@livenew.app')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Contact us</Text>
              <Text style={s.settingValue}>support@livenew.app</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => Linking.openURL('https://livenew.app/terms')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Terms of service</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => Linking.openURL('https://livenew.app/privacy')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Privacy policy</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>
        </View>

        {/* Account actions */}
        <Text style={s.sectionTitle}>Account</Text>

        <View style={s.card}>
          <Pressable style={s.settingRow} onPress={handleLogout}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Log out</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={handleDelete} disabled={deleting}>
            <View style={s.settingContent}>
              <Text style={[s.settingTitle, { color: colors.error }]}>
                {deleting ? 'Deleting...' : 'Delete my account'}
              </Text>
              <Text style={s.settingValue}>Permanently delete all data</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>
        </View>

        <Text style={s.version}>LiveNew v1.0.0</Text>

        <View style={{ height: 40 }} />
      </ScrollView>

      {sharing ? (
        <View style={s.shareCardHidden} pointerEvents="none">
          {sharing.type === 'streak' ? (
            <StreakShareCard innerRef={shareCardRef} days={sharing.payload.days} variant={shareVariant} />
          ) : null}
          {sharing.type === 'invite' ? (
            <InviteShareCard innerRef={shareCardRef} lineIndex={sharing.payload?.lineIndex || 0} variant={shareVariant} />
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: 20, paddingBottom: 100 },

    headerRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 24,
    },
    heading: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      letterSpacing: 0.2,
    },

    // Section titles
    sectionTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 10,
      color: colors.dim,
      textTransform: 'uppercase',
      letterSpacing: 2,
      marginBottom: 10,
      marginTop: 8,
      marginLeft: 4,
    },

    // Cards
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      marginBottom: 16,
      overflow: 'hidden',
    },

    // Status row
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 18,
    },
    statusBadge: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginRight: 14,
    },
    statusBadgeActive: {
      borderColor: colors.goldBorder,
      backgroundColor: 'rgba(196,168,108,0.08)',
    },
    statusBadgeText: {
      fontFamily: fonts.displayBold,
      fontSize: 9,
      color: colors.dim,
      letterSpacing: 1.6,
    },
    statusBadgeTextActive: {
      color: colors.gold,
    },
    statusContent: { flex: 1 },
    statusTitle: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text, letterSpacing: 0.1 },
    statusSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },

    streakRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: colors.line,
      padding: 12,
      paddingLeft: 16,
    },
    streakText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: colors.gold,
    },
    streakShareHint: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 0.2,
    },
    shareCardHidden: {
      position: 'absolute',
      top: -10000,
      left: 0,
      opacity: 1,
    },
    zoneToggleTitle: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: colors.text,
      letterSpacing: 0.1,
    },

    // Setting rows
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    settingContent: { flex: 1 },
    settingTitle: { fontFamily: fonts.displaySemibold, fontSize: 15, color: colors.text, letterSpacing: 0.1 },
    settingValue: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
    settingArrow: { fontFamily: fonts.body, fontSize: 20, color: colors.dim, marginLeft: 12 },
    settingDivider: { height: 1, backgroundColor: colors.line, marginLeft: 18 },

    // Version
    version: {
      fontFamily: fonts.body,
      textAlign: 'center',
      fontSize: 12,
      color: colors.dim,
      marginTop: 8,
    },

    // Edit screen
    editWrap: { flex: 1, padding: 24, justifyContent: 'center' },
    editTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.text, marginBottom: 8, textAlign: 'center', letterSpacing: 0.2 },
    editSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
    editInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      paddingHorizontal: 18,
      paddingVertical: 16,
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.text,
      minHeight: 140,
      lineHeight: 22,
      marginBottom: 16,
    },
    saveBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    saveBtnText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 16 },
    cancelBtn: { alignItems: 'center', marginTop: 12, padding: 8 },
    cancelText: { color: colors.muted, fontFamily: fonts.body, fontSize: 14 },

    // Goal preset grid
    goalGrid: { gap: 10 },
    goalOption: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 18,
      gap: 14,
    },
    goalEmoji: { fontSize: 22 },
    goalLabel: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text },
  });
}
