import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';
export default function AccountScreen() {
  return <View style={s.c}><Text style={s.t}>Account — coming next</Text></View>;
}
const s = StyleSheet.create({ c: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }, t: { color: colors.text } });
