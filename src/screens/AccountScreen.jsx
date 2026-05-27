import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Switch,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Linking, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { trialDaysRemaining, isWithinTrial } from '../store/authStore';
import { tapLight, tapSelect, tapMedium } from '../haptics';
import { Asset } from 'expo-asset';
import StreakShareCard, { milestoneTier } from '../components/StreakShareCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getNotificationPermission, requestPermissions,
  getNotificationPrefs, setNotificationPrefs,
  scheduleSessionReminders, clearAllZoneNotifications,
  scheduleCheckInReminders,
} from '../notifications';
import { ZONE_LABELS } from '../utils/score';

export default function AccountScreen({ navigation }) {
  const { colors, fonts, scheme } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const profile = useAuthStore(s => s.profile);
  const themeMode = useAuthStore(s => s.themeMode);
  const setThemeMode = useAuthStore(s => s.setThemeMode);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const trialStartISO = useAuthStore(s => s.trialStartISO);
  const daysLeft = trialDaysRemaining(trialStartISO);
  const inTrial = isWithinTrial(trialStartISO);
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
    if (ok) {
      try { await scheduleCheckInReminders({ hasPlanToday: !!todayPlan?.zones }); } catch {}
      if (todayPlan?.zones) {
        try { await scheduleSessionReminders(todayPlan.zones); } catch {}
      }
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
    // Wait two frames for the hidden share card to paint before capturing.
    // 80ms was tight on older devices; this is more forgiving.
    await new Promise(r => setTimeout(r, 200));
    let captured = false;
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      captured = true;
      await Share.share({ url: uri, message });
    } catch (err) {
      if (!captured) {
        Alert.alert("Couldn't create share image", "Try again in a moment.");
      }
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

  // Safe wrapper around Linking.openURL — guards against devices with no
  // mail client / no browser configured. Shows a friendly Alert on failure
  // instead of letting the unhandled promise rejection surface.
  const safeOpenURL = async (url, fallbackMsg) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert("Can't open this", fallbackMsg || 'No app on this device can handle that link.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Can't open this", fallbackMsg || 'Something went wrong opening that link.');
    }
  };

  // Invite a friend — share the actual LiveNew icon as the preview image
  // (iOS otherwise pulls a "L" from the website's favicon, which looks
  // off-brand). Resolve the bundled icon to a local URI, then pass it as
  // the `url` field to Share.share so the share sheet shows OUR mark.
  // Message copy is short, personal, and Iris-voiced — feels like a real
  // recommendation from a friend, not marketing.
  const handleInviteFriend = async () => {
    tapSelect();
    const link = 'https://livenew.app';
    const lines = [
      "ok you have to try this app. it literally tells you when your cortisol crashes and exactly what to do about it. iris (the ai inside) is wild → " + link,
      "if you've ever been wired-but-tired, this app fixes it. eight cortisol-aware moments a day, real protocols, no 'just breathe' nonsense → " + link,
      "this app reads your body and tells you the truth. closest thing to a personal doctor in your pocket. iris > every wellness app i've tried → " + link,
      "stumbled into this app and now i can't stop. it's like a coach that actually knows the science — sleep, hrv, cortisol, the whole thing → " + link,
      "the afternoon crash isn't you, it's your cortisol curve. this app finally taught me what to do about it. iris is the real deal → " + link,
    ];
    const message = lines[Math.floor(Math.random() * lines.length)];

    let imageUri = null;
    try {
      const asset = Asset.fromModule(require('../../assets/icon.png'));
      await asset.downloadAsync();
      imageUri = asset.localUri || asset.uri;
    } catch {}

    try {
      if (imageUri) {
        // Share image + message together — iOS shows our icon as the preview.
        await Share.share({ url: imageUri, message });
      } else {
        // Fallback: text + link only.
        await Share.share({ message });
      }
    } catch {}
  };

  const handleEdit = (field) => {
    tapSelect();
    setEditValue(profile?.[field] || '');
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
      // Profile is saved. Iris will pick up the change on the next plan
      // generation — we don't yank the user into a re-check-in. They're in
      // Account for a reason; respect that.
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

  // Edit screen — routine only (goal removed in 2026-05-16 simplification)
  if (editing) {
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.editWrap}>
            <Text style={s.editTitle}>Update your routine</Text>
            <Text style={s.editSub}>This shapes when and how Iris builds your plan.</Text>
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
        </View>

        {/* Subscription status */}
        <View style={s.card}>
          <Pressable
            style={s.statusRow}
            onPress={() => {
              if (isSubscribed) return;
              tapSelect();
              navigation.navigate('Paywall');
            }}
            disabled={isSubscribed}
          >
            <View style={[s.statusBadge, isSubscribed && s.statusBadgeActive]}>
              <Text style={[s.statusBadgeText, isSubscribed && s.statusBadgeTextActive]}>
                {isSubscribed ? 'PRO' : inTrial ? 'TRIAL' : 'FREE'}
              </Text>
            </View>
            <View style={s.statusContent}>
              <Text style={s.statusTitle}>
                {isSubscribed
                  ? 'LiveNew Pro'
                  : inTrial
                  ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your trial`
                  : 'Free plan'}
              </Text>
              <Text style={s.statusSub}>
                {isSubscribed
                  ? 'Full access to all features'
                  : inTrial
                  ? 'Full access for now — subscribe before it ends.'
                  : 'Subscribe to keep generating daily plans.'}
              </Text>
            </View>
            {!isSubscribed ? <Text style={s.settingArrow}>›</Text> : null}
          </Pressable>
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
                onPress={() => safeOpenURL('https://apps.apple.com/account/subscriptions')}
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

        </View>

        {/* Share section — streak share moved up to the subscription card,
            card-style toggle replaced with appearance (light/dark). */}
        <Text style={s.sectionTitle}>Share</Text>

        <View style={s.card}>
          <Pressable style={s.settingRow} onPress={handleInviteFriend}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Invite a friend</Text>
              <Text style={s.settingValue}>Send a personal link to LiveNew.</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>
        </View>

        {/* Appearance — manual light/dark override. */}
        <Text style={s.sectionTitle}>Appearance</Text>

        <View style={s.card}>
          <View style={s.settingRow}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Dark mode</Text>
              <Text style={s.settingValue}>
                {themeMode === 'system' ? 'Following system' : (themeMode === 'dark' ? 'Always dark' : 'Always light')}
              </Text>
            </View>
            <Switch
              value={themeMode === 'dark' || (themeMode === 'system' && scheme === 'dark')}
              onValueChange={(v) => { tapLight(); setThemeMode(v ? 'dark' : 'light'); }}
              trackColor={{ false: colors.line, true: colors.gold }}
              thumbColor={'#fff'}
              ios_backgroundColor={colors.line}
            />
          </View>
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
                <React.Fragment key={zid}>
                  {idx === 0 ? <View style={s.settingDivider} /> : null}
                  <View style={s.settingRow}>
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
                </React.Fragment>
              ))}
            </View>
          ) : null}
        </View>

        {/* Apple Health — promoted to a real CTA card, not a settings row.
            Connecting Health is the highest-leverage thing a non-connected
            user can do here; the UI should reflect that, not bury it in a
            list. */}
        <Text style={s.sectionTitle}>Apple Health</Text>

        {healthPermission === 'granted' ? (
          <View style={s.healthGrantedCard}>
            <Text style={s.healthGrantedBadge}>● CONNECTED</Text>
            <Text style={s.healthGrantedTitle}>Iris is reading your real biometrics.</Text>
            <Text style={s.healthGrantedBody}>
              Sleep, resting heart rate, and HRV are powering your score and the daily plan. To revoke, open Health → Sharing → Apps → LiveNew.
            </Text>
          </View>
        ) : (
          <View style={s.healthConnectCard}>
            <Text style={s.healthConnectTitle}>Connect Apple Health</Text>
            <Text style={s.healthConnectBody}>
              Read-only access to your sleep, RHR, and HRV. The score and Iris's daily read both become calibrated to your actual biometrics instead of self-report.
            </Text>
            <Pressable
              style={({ pressed }) => [s.healthConnectBtn, pressed && { opacity: 0.88 }]}
              onPress={async () => {
                tapSelect();
                const result = await connectHealth();
                if (result && result.ok === false) {
                  Alert.alert("Couldn't connect", result.error || 'Apple Health is unavailable on this device.');
                }
              }}
            >
              <Text style={s.healthConnectBtnText}>Connect</Text>
            </Pressable>
          </View>
        )}

        {/* Support section */}
        <Text style={s.sectionTitle}>Support</Text>

        <View style={s.card}>
          <Pressable style={s.settingRow} onPress={() => safeOpenURL('https://livenew.app/help')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Help center</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => safeOpenURL('mailto:support@livenew.app', 'No mail app is set up on this device.')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Contact us</Text>
              <Text style={s.settingValue}>support@livenew.app</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => safeOpenURL('https://livenew.app/terms')}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Terms of service</Text>
            </View>
            <Text style={s.settingArrow}>›</Text>
          </Pressable>

          <View style={s.settingDivider} />

          <Pressable style={s.settingRow} onPress={() => safeOpenURL('https://livenew.app/privacy')}>
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
          <StreakShareCard innerRef={shareCardRef} days={sharing.payload.days} />
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

    // Apple Health — promoted CTA card (not granted) + status card (granted)
    healthConnectCard: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    healthConnectTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      color: colors.text,
      letterSpacing: -0.2,
      marginBottom: 6,
    },
    healthConnectBody: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.muted,
      lineHeight: 20,
      marginBottom: 14,
    },
    healthConnectBtn: {
      backgroundColor: colors.gold,
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: 20,
      alignSelf: 'flex-start',
    },
    healthConnectBtnText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: '#1a1612',
      letterSpacing: 0.3,
    },
    healthGrantedCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    healthGrantedBadge: {
      fontFamily: fonts.displaySemibold,
      fontSize: 11,
      color: colors.gold,
      letterSpacing: 1.6,
      marginBottom: 8,
    },
    healthGrantedTitle: {
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      color: colors.text,
      marginBottom: 6,
    },
    healthGrantedBody: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 19,
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
