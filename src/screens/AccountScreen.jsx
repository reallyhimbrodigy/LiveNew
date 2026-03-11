import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function AccountScreen() {
  const profile = useAuthStore(s => s.profile);
  const logout = useAuthStore(s => s.logout);
  const deleteAccount = useAuthStore(s => s.deleteAccount);
  const saveProfile = useAuthStore(s => s.saveProfile);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(null); // 'routine' or 'goal' or null
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleEdit = (field) => {
    setEditValue(field === 'routine' ? (profile?.routine || '') : (profile?.goal || ''));
    setEditing(field);
  };

  const handleSave = async () => {
    if (!editValue.trim()) return;
    setSaving(true);
    try {
      const updated = {
        ...profile,
        [editing]: editValue.trim(),
      };
      await saveProfile(updated);
    } catch (err) {
      Alert.alert('Error', 'Could not save. Try again.');
    }
    setSaving(false);
    setEditing(null);
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const handleDelete = () => {
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

  // Edit modal
  if (editing) {
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.editWrap}>
            <Text style={s.editTitle}>
              {editing === 'routine' ? 'Update your routine' : 'Update your goal'}
            </Text>
            <TextInput
              style={s.editInput}
              value={editValue}
              onChangeText={setEditValue}
              multiline
              textAlignVertical="top"
              autoFocus
              placeholderTextColor={colors.dim}
              placeholder={editing === 'routine' ? 'Describe your daily routine...' : 'What is your goal...'}
            />
            <TouchableOpacity
              style={[s.saveBtn, (!editValue.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleSave}
              disabled={!editValue.trim() || saving}
              activeOpacity={0.8}
            >
              <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setEditing(null)} activeOpacity={0.7}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.logo}>LiveNew</Text>
        <Text style={s.heading}>Account</Text>

        {/* Routine */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>My routine</Text>
            <TouchableOpacity onPress={() => handleEdit('routine')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.cardValue} numberOfLines={4}>{profile?.routine || 'Not set'}</Text>
        </View>

        {/* Goal */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>My goal</Text>
            <TouchableOpacity onPress={() => handleEdit('goal')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.cardValue} numberOfLines={3}>{profile?.goal || 'Not set'}</Text>
        </View>

        {/* Info */}
        <View style={s.infoRow}>
          <Text style={s.infoText}>Your day plan regenerates each time you check in. Updating your routine or goal changes tomorrow's plan.</Text>
        </View>

        {/* Actions */}
        <TouchableOpacity style={s.actionBtn} onPress={handleLogout} activeOpacity={0.7}>
          <Text style={s.actionText}>Log out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} activeOpacity={0.7} disabled={deleting}>
          <Text style={s.deleteText}>{deleting ? 'Deleting...' : 'Delete my account'}</Text>
        </TouchableOpacity>

        <Text style={s.version}>LiveNew v1.0.0</Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 100 },

  logo: { fontSize: 20, fontWeight: '500', color: colors.text, letterSpacing: 1, marginBottom: 20 },
  heading: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 24 },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },

  cardLabel: {
    fontSize: 12,
    color: colors.dim,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  editLink: {
    fontSize: 13,
    color: colors.gold,
    fontWeight: '500',
  },

  cardValue: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },

  // Info
  infoRow: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    marginBottom: 24,
  },

  infoText: {
    fontSize: 13,
    color: colors.dim,
    lineHeight: 18,
  },

  // Actions
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },

  actionText: {
    color: colors.muted,
    fontSize: 15,
  },

  deleteBtn: {
    borderWidth: 1,
    borderColor: 'rgba(200,80,80,0.2)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 24,
  },

  deleteText: {
    color: '#c97a7a',
    fontSize: 15,
  },

  version: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.dim,
  },

  // Edit screen
  editWrap: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },

  editTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 20,
    textAlign: 'center',
  },

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

  saveBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },

  saveBtnText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
  },

  cancelBtn: {
    alignItems: 'center',
    marginTop: 12,
    padding: 8,
  },

  cancelText: {
    color: colors.muted,
    fontSize: 14,
  },
});
