import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapMedium } from '../haptics';
import { truncateGoal } from '../utils/goalText';

const GOAL_OPTIONS = [
  { label: 'Sleep better', value: 'I want to sleep through the night and wake up rested', emoji: '\u{1F319}' },
  { label: 'Less anxiety', value: 'I want to stop feeling anxious and overwhelmed all day', emoji: '\u{1F32C}\uFE0F' },
  { label: 'More energy', value: 'I want consistent energy throughout the day without crashing', emoji: '\u26A1' },
  { label: 'Lose weight', value: 'I want to lose weight and stop stress eating', emoji: '\u{1F331}' },
  { label: 'Be calmer', value: 'I want to feel calm and in control of my stress', emoji: '\u{1F9D8}' },
  { label: 'Feel better', value: 'I just want to feel better overall', emoji: '\u2728' },
];

export default function AccountScreen({ navigation }) {
  const profile = useAuthStore(s => s.profile);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const logout = useAuthStore(s => s.logout);
  const deleteAccount = useAuthStore(s => s.deleteAccount);
  const saveProfile = useAuthStore(s => s.saveProfile);
  const streak = useAuthStore(s => s.streak);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

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
                <Text style={{ color: colors.muted, fontSize: 16 }}>Saving...</Text>
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

        <Text style={s.heading}>Account</Text>

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
            <View style={s.streakRow}>
              <Text style={s.streakText}>{streak} day streak 🔥</Text>
            </View>
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 100 },

  heading: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.text,
    marginBottom: 24,
    letterSpacing: 0.2,
  },

  // Section titles
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
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
    fontSize: 9,
    fontWeight: '700',
    color: colors.dim,
    letterSpacing: 1.6,
  },
  statusBadgeTextActive: {
    color: colors.gold,
  },
  statusContent: { flex: 1 },
  statusTitle: { fontSize: 16, fontWeight: '600', color: colors.text, letterSpacing: 0.1 },
  statusSub: { fontSize: 13, color: colors.muted, marginTop: 2 },

  streakRow: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: 12,
    paddingLeft: 16,
  },
  streakText: {
    fontSize: 14,
    color: colors.gold,
    fontWeight: '600',
  },

  // Setting rows
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  settingContent: { flex: 1 },
  settingTitle: { fontSize: 15, fontWeight: '500', color: colors.text, letterSpacing: 0.1 },
  settingValue: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
  settingArrow: { fontSize: 20, color: colors.dim, fontWeight: '300', marginLeft: 12 },
  settingDivider: { height: 1, backgroundColor: colors.line, marginLeft: 18 },

  // Version
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.dim,
    marginTop: 8,
  },

  // Edit screen
  editWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  editTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.text, marginBottom: 8, textAlign: 'center', letterSpacing: 0.2 },
  editSub: { fontFamily: fonts.displayItalic, fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  editInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: colors.text,
    minHeight: 140,
    lineHeight: 22,
    marginBottom: 16,
  },
  saveBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', marginTop: 12, padding: 8 },
  cancelText: { color: colors.muted, fontSize: 14 },

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
  goalLabel: { fontSize: 16, fontWeight: '500', color: colors.text },
});
