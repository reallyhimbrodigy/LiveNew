import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function AccountScreen() {
  const profile = useAuthStore(s => s.profile);
  const logout = useAuthStore(s => s.logout);
  const deleteAccount = useAuthStore(s => s.deleteAccount);
  const [deleting, setDeleting] = useState(false);

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
            try {
              await deleteAccount();
            } catch {
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

        <Text style={s.logo}>LiveNew</Text>
        <Text style={s.heading}>Account</Text>

        {/* Profile info */}
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.label}>Goal</Text>
            <Text style={s.value}>{profile?.goal || '—'}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <Text style={s.label}>Routine</Text>
            <Text style={s.value} numberOfLines={3}>{profile?.routine || '—'}</Text>
          </View>
        </View>

        {/* Actions */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <Text style={s.logoutText}>Log out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} activeOpacity={0.7} disabled={deleting}>
          <Text style={s.deleteText}>{deleting ? 'Deleting...' : 'Delete my account'}</Text>
        </TouchableOpacity>

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

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },

  row: {
    paddingVertical: 12,
  },

  divider: {
    height: 1,
    backgroundColor: colors.line,
  },

  label: {
    fontSize: 12,
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },

  value: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },

  logoutBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },

  logoutText: {
    color: colors.muted,
    fontSize: 15,
  },

  deleteBtn: {
    borderWidth: 1,
    borderColor: 'rgba(200,80,80,0.2)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },

  deleteText: {
    color: '#c97a7a',
    fontSize: 15,
  },
});
