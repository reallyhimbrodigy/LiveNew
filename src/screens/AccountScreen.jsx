import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, Pressable, TextInput, Switch,
  StyleSheet, Alert, Linking, Share, Modal,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../theme';
import { useAuthStore, useIsPremium } from '../store/authStore';
import { trialDaysRemaining, isWithinTrial } from '../store/authStore';
import { tapLight, tapSelect, tapMedium } from '../haptics';
import { Asset } from 'expo-asset';
import StreakShareCard, { milestoneTier } from '../components/StreakShareCard';
import FlameIcon from '../components/FlameIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScheduleBuilder from './onboarding/ScheduleBuilder';
import PremiumUpsell from '../components/PremiumUpsell';
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
  const hasProfile = useAuthStore((s) => s.hasProfile);
  const themeMode = useAuthStore(s => s.themeMode);
  const setThemeMode = useAuthStore(s => s.setThemeMode);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const trialStartISO = useAuthStore(s => s.trialStartISO);
  const daysLeft = trialDaysRemaining(trialStartISO);
  const inTrial = isWithinTrial(trialStartISO);
  const logout = useAuthStore(s => s.logout);
  const deleteAccount = useAuthStore(s => s.deleteAccount);
  const saveProfile = useAuthStore(s => s.saveProfile);
  const userId = useAuthStore(s => s.userId);
  const userName = useAuthStore(s => s.userName);
  const userEmail = useAuthStore(s => s.userEmail);
  const avatarUri = useAuthStore(s => s.avatarUri);
  const setAvatar = useAuthStore(s => s.setAvatar);
  const avatarUploading = useAuthStore(s => s.avatarUploading);
  const setDisplayName = useAuthStore(s => s.setDisplayName);
  const streak = useAuthStore(s => s.streak);
  const streakFreezeReady = useAuthStore(s => s.streakFreezeReady);
  const isPremium = useIsPremium();
  const healthPermission = useAuthStore(s => s.healthPermission);
  const connectHealth = useAuthStore(s => s.connectHealth);
  const disconnectHealth = useAuthStore(s => s.disconnectHealth);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleKey, setScheduleKey] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(true); // default hidden until we check
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

  // One-time nudge: show only for users with no schedule who haven't dismissed it yet
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      if (!hasProfile) { if (!cancelled) setNudgeDismissed(true); return; }
      if (profile?.schedule?.blocks?.length) { if (!cancelled) setNudgeDismissed(true); return; }
      try {
        const v = await AsyncStorage.getItem(`livenew:sched_nudge_dismissed:${userId}`);
        if (!cancelled) setNudgeDismissed(v === '1');
      } catch { if (!cancelled) setNudgeDismissed(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, hasProfile, profile?.schedule]);

  const dismissNudge = async () => {
    setNudgeDismissed(true);
    if (!userId) return;
    try { await AsyncStorage.setItem(`livenew:sched_nudge_dismissed:${userId}`, '1'); } catch {}
  };

  const openScheduleEditor = () => { setScheduleKey((k) => k + 1); setScheduleOpen(true); };

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

  // Pick a profile photo from the library and upload it. We request library
  // permission first (graceful denial alert), then launch the picker with
  // square cropping at moderate quality + base64 so we can hand the bytes to
  // the server, which stores them in Supabase Storage and returns the URL.
  const handlePickAvatar = async () => {
    if (avatarUploading) return;
    tapSelect();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo access needed',
          'Enable photo library access in Settings to set a profile picture.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        // Base64 inflates payload ~33%; the server caps uploads at 12MB of
        // base64. 0.5 keeps even large photos comfortably under that ceiling.
        quality: 0.5,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        Alert.alert('Error', 'Could not read that image. Try another photo.');
        return;
      }
      // Derive the extension from the asset metadata; default to jpg. Only
      // png/jpg are meaningful to the server (it maps everything else to jpeg).
      let ext = 'jpg';
      const nameExt = (asset.fileName || '').split('.').pop()?.toLowerCase();
      const mime = (asset.mimeType || '').toLowerCase();
      if (nameExt === 'png' || mime.includes('png')) ext = 'png';
      const res = await setAvatar({ base64: asset.base64, ext });
      if (res?.ok) {
        tapLight();
      } else {
        // Surface the real server error so a too-large image reads differently
        // from a generic failure. Fall back to the generic line if none given.
        Alert.alert(
          'Upload failed',
          res?.error
            ? `${res.error}\n\nIf the photo is very large, try a smaller one.`
            : 'Could not upload your photo. Please try again.'
        );
      }
    } catch (err) {
      Alert.alert('Upload failed', err?.message || 'Could not upload your photo. Please try again.');
    }
  };

  const startEditName = () => {
    tapSelect();
    setNameValue(userName || '');
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 250);
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || savingName) { setEditingName(false); return; }
    tapLight();
    setSavingName(true);
    try {
      await setDisplayName(trimmed);
    } catch {
      Alert.alert('Error', 'Could not save your name. Try again.');
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  };

  const avatarInitial = (userName || '').trim().charAt(0).toUpperCase() || '?';

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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.headerRow}>
          <Text style={s.heading}>Account</Text>
        </View>

        {/* Profile — avatar + editable name. Pro users get a golden aura. */}
        <View style={s.profileSection}>
          <Pressable
            style={s.avatarTap}
            onPress={handlePickAvatar}
            disabled={avatarUploading}
            hitSlop={6}
          >
            {/* PRO golden aura — concentric soft-gold halos + glow behind the
                avatar. Free users fall through to a plain subtle ring only. */}
            {isPremium ? (
              <>
                <View style={[s.aura, s.auraOuter]} pointerEvents="none" />
                <View style={[s.aura, s.auraMid]} pointerEvents="none" />
                <View style={[s.aura, s.auraInner]} pointerEvents="none" />
              </>
            ) : null}
            <View style={[s.avatarRing, isPremium ? s.avatarRingPro : s.avatarRingFree]}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.avatarImg} />
              ) : (
                <View style={s.avatarFallback}>
                  <Text style={s.avatarInitial}>{avatarInitial}</Text>
                </View>
              )}
              {/* Upload spinner overlay — dims the avatar while the photo
                  uploads so the tap feels acknowledged. */}
              {avatarUploading ? (
                <View style={s.avatarUploadingOverlay} pointerEvents="none">
                  <ActivityIndicator size="small" color={colors.gold} />
                </View>
              ) : null}
            </View>
            {/* Gold "+" edit affordance — signals the avatar is tappable. */}
            <View style={s.avatarEditDot} pointerEvents="none">
              <Text style={s.avatarEditGlyph}>+</Text>
            </View>
          </Pressable>

          <View style={s.profileMeta}>
            {editingName ? (
              <View style={s.nameEditRow}>
                <TextInput
                  ref={nameInputRef}
                  style={s.nameInput}
                  value={nameValue}
                  onChangeText={setNameValue}
                  placeholder="Your name"
                  placeholderTextColor={colors.dim}
                  returnKeyType="done"
                  maxLength={40}
                  onSubmitEditing={handleSaveName}
                />
                <Pressable
                  onPress={handleSaveName}
                  disabled={savingName || !nameValue.trim()}
                  hitSlop={8}
                  style={[s.nameSaveBtn, (savingName || !nameValue.trim()) && { opacity: 0.4 }]}
                >
                  <Text style={s.nameSaveText}>{savingName ? '…' : 'Save'}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={startEditName} hitSlop={8} style={s.nameRow}>
                <Text style={s.profileName} numberOfLines={1}>
                  {userName || 'Add your name'}
                </Text>
                <Text style={s.nameEditHint}>Edit</Text>
              </Pressable>
            )}
            {userEmail ? (
              <Text style={s.profileEmail} numberOfLines={1}>{userEmail}</Text>
            ) : null}
          </View>
        </View>

        {/* One-time nudge for users with no schedule */}
        {hasProfile && !nudgeDismissed && !(profile?.schedule?.blocks?.length) ? (
          <View style={s.card}>
            <View style={{ padding: 18 }}>
              <Text style={s.settingTitle}>Make your plans fit your week</Text>
              <Text style={[s.settingValue, { marginTop: 6 }]}>Tell Iris what your days actually look like — it takes under a minute.</Text>
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
                <Pressable hitSlop={8} onPress={openScheduleEditor}>
                  <Text style={{ color: colors.gold, fontFamily: fonts.displaySemibold }}>Set up my week</Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={dismissNudge}>
                  <Text style={{ color: colors.muted, fontFamily: fonts.displaySemibold }}>Not now</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {/* Subscription status */}
        <View style={s.card}>
          <Pressable
            style={s.statusRow}
            onPress={() => {
              if (isSubscribed) return;
              tapSelect();
              navigation.navigate('Essentials');
            }}
            disabled={isSubscribed}
          >
            <View style={[s.statusBadge, isSubscribed && s.statusBadgeActive]}>
              <Text style={[s.statusBadgeText, isSubscribed && s.statusBadgeTextActive]}>
                {isSubscribed ? 'PRO' : inTrial ? 'TRIAL' : 'ESSENTIALS'}
              </Text>
            </View>
            <View style={s.statusContent}>
              <Text style={s.statusTitle}>
                {isSubscribed
                  ? 'LiveNew Pro'
                  : inTrial
                  ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your trial`
                  : 'Essentials'}
              </Text>
              <Text style={s.statusSub}>
                {isSubscribed
                  ? 'Full access to all premium features'
                  : inTrial
                  ? 'Premium features unlocked — trial ends in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '.'
                  : 'Essentials — your plan, streak, and halos are always free.'}
              </Text>
            </View>
            {!isSubscribed ? <Text style={s.settingArrow}>›</Text> : null}
          </Pressable>
          {streak > 0 && (
            <Pressable style={s.streakRow} onPress={handleShareStreak}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={s.streakText}>{streak} day streak</Text>
                <View style={{ marginLeft: 6 }}><FlameIcon size={15} color={colors.gold} /></View>
              </View>
              <Text style={s.streakShareHint}>Tap to share</Text>
            </Pressable>
          )}
          {/* Streak Freeze status row — shown for premium users inside the subscription card */}
          {isPremium ? (
            <>
              <View style={s.settingDivider} />
              <View style={s.freezeRow}>
                <Text style={s.freezeLabel}>Streak Freeze</Text>
                <Text style={[s.freezeStatus, streakFreezeReady ? s.freezeStatusReady : s.freezeStatusUsed]}>
                  {streakFreezeReady ? 'ready' : 'used this week'}
                </Text>
              </View>
            </>
          ) : (
            /* Free-user teaser — taps to Paywall */
            <>
              <View style={s.settingDivider} />
              <Pressable
                style={s.freezeRow}
                onPress={() => { tapSelect(); navigation.navigate('Paywall'); }}
              >
                <Text style={s.freezeLabel}>Streak Freeze</Text>
                <Text style={s.freezeHint}>Premium  ›</Text>
              </Pressable>
            </>
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

        {/* Premium upsell — only shown to non-premium users */}
        <PremiumUpsell onPress={() => { tapSelect(); navigation.navigate('Paywall'); }} />

        {/* Profile section */}
        <Text style={s.sectionTitle}>Your profile</Text>

        <View style={s.card}>
          <Pressable style={s.settingRow} onPress={openScheduleEditor}>
            <View style={s.settingContent}>
              <Text style={s.settingTitle}>Schedule</Text>
              <Text style={s.settingValue}>
                {profile?.schedule?.blocks?.length ? `${profile.schedule.blocks.length} blocks set` : 'Set up your week'}
              </Text>
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
            <View style={s.healthToggleRow}>
              <Text style={s.healthGrantedTitle}>Iris is reading your real biometrics.</Text>
              <Switch
                value={true}
                onValueChange={(next) => {
                  tapSelect();
                  if (next) {
                    connectHealth();
                  } else {
                    disconnectHealth();
                  }
                }}
                trackColor={{ false: colors.line, true: colors.gold }}
                thumbColor={colors.bg}
              />
            </View>
            <Text style={s.healthGrantedBody}>
              Sleep, resting heart rate, and HRV are powering your score and the daily plan. Turning this off stops Iris from using your Health data. To fully revoke access, open Health → Sharing → Apps → LiveNew.
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

      <Modal visible={scheduleOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setScheduleOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
          {/* Builder fills the screen; the Close control sits centered BELOW it,
              clear of the status bar / battery that crowded the old top-right X. */}
          <View style={{ flex: 1 }}>
            <ScheduleBuilder
              key={scheduleKey}
              onComplete={async (schedule) => {
                try {
                  await saveProfile({ ...(profile || {}), schedule });
                } catch (e) {
                  console.warn('[account] saveProfile schedule failed', e?.message);
                }
                setScheduleOpen(false);
              }}
            />
          </View>
          <Pressable
            onPress={() => setScheduleOpen(false)}
            hitSlop={8}
            style={{ alignSelf: 'center', paddingVertical: 18, paddingHorizontal: 32, marginBottom: 8 }}
          >
            <Text style={{ color: colors.muted, fontFamily: fonts.displaySemibold, fontSize: 16 }}>Close</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
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

    // ─── Profile section (avatar + name + email) ───────────────────────────
    profileSection: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 20,
    },
    // The avatar wrapper is the aura's positioning context. Extra padding gives
    // the Pro halos room to bloom outside the avatar ring without clipping.
    avatarTap: {
      width: 116,
      height: 116,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Concentric gold halos — only rendered for Pro. Each is a centered circle
    // behind the avatar; stacked with decreasing opacity they read as a glow.
    aura: {
      position: 'absolute',
      borderRadius: 999,
      alignSelf: 'center',
    },
    auraOuter: {
      width: 116, height: 116,
      backgroundColor: 'rgba(196,168,108,0.06)',
    },
    auraMid: {
      width: 102, height: 102,
      backgroundColor: 'rgba(196,168,108,0.10)',
    },
    auraInner: {
      width: 92, height: 92,
      backgroundColor: 'rgba(196,168,108,0.16)',
      // Gold glow — a soft luminous bloom around the avatar that sells "premium."
      shadowColor: colors.gold,
      shadowOpacity: 0.9,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 12,
    },
    // The avatar ring holds the image / fallback. Pro gets a solid gold border;
    // free gets a plain subtle line — no glow.
    avatarRing: {
      width: 84,
      height: 84,
      borderRadius: 42,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarRingPro: {
      borderWidth: 2,
      borderColor: colors.gold,
    },
    avatarRingFree: {
      borderWidth: 1,
      borderColor: colors.line,
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    // Dim overlay shown over the avatar while an upload is in flight.
    avatarUploadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarFallback: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.goldSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: {
      fontFamily: fonts.displayBold,
      fontSize: 34,
      color: colors.gold,
      letterSpacing: 0.5,
    },
    // Edit affordance — a small gold dot on the avatar ring's lower-right edge.
    // The ring (84px) is centered in the 116px tap wrapper, so there's ~16px of
    // padding on every side. right/bottom of 18 lands the dot's center just
    // inside the ring's lower-right corner (the 45° point) so it reads as
    // sitting ON the ring edge, not floating off it.
    avatarEditDot: {
      position: 'absolute',
      right: 18,
      bottom: 18,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.bg,
    },
    avatarEditGlyph: {
      fontFamily: fonts.displayBold,
      fontSize: 16,
      lineHeight: 18,
      color: '#1a1612',
      marginTop: -1,
    },
    profileMeta: {
      flex: 1,
      marginLeft: 6,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
    },
    profileName: {
      fontFamily: fonts.displayBold,
      fontSize: 22,
      color: colors.text,
      letterSpacing: 0.2,
      flexShrink: 1,
    },
    nameEditHint: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: colors.gold,
      marginLeft: 10,
    },
    nameEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
    },
    nameInput: {
      flex: 1,
      fontFamily: fonts.displaySemibold,
      fontSize: 18,
      color: colors.text,
      borderBottomWidth: 1,
      borderBottomColor: colors.goldBorder,
      paddingVertical: 6,
      paddingRight: 8,
    },
    nameSaveBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.gold,
      marginLeft: 8,
    },
    nameSaveText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: '#1a1612',
      letterSpacing: 0.3,
    },
    profileEmail: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
      marginTop: 2,
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
    // Title + on/off Switch share a row so the toggle reads as the connection
    // control, not buried below copy.
    healthToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    healthGrantedTitle: {
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      color: colors.text,
      marginBottom: 6,
      flexShrink: 1,
      paddingRight: 12,
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
    // Streak Freeze row — inside the subscription card
    freezeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    freezeLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: colors.text,
      letterSpacing: 0.1,
    },
    freezeStatus: {
      fontFamily: fonts.displaySemibold,
      fontSize: 12,
      letterSpacing: 0.5,
    },
    freezeStatusReady: {
      color: colors.gold,
    },
    freezeStatusUsed: {
      color: colors.muted,
    },
    freezeHint: {
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
  });
}
