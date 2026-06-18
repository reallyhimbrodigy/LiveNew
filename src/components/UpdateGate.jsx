import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Linking, Alert } from 'react-native';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';

/**
 * UpdateGate — surfaces the server's appUpdate signal (set on bootstrap):
 *   • required  → a blocking "Update required" screen (app version below `min`)
 *   • available → a one-time, dismissible "Update available" alert (below `latest`)
 *
 * Only fires for NATIVE version bumps; JS-only changes ship silently via EAS
 * Update (OTA), so this stays quiet for those.
 */
export default function UpdateGate() {
  const { colors, fonts } = useTheme();
  const appUpdate = useAuthStore((s) => s.appUpdate);
  const softShownRef = useRef(false);
  const s = makeStyles(colors, fonts);

  useEffect(() => {
    if (appUpdate?.available && !appUpdate?.required && !softShownRef.current) {
      softShownRef.current = true;
      Alert.alert(
        'Update available',
        'A newer version of LiveNew is ready, with the latest improvements.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Update', onPress: () => { if (appUpdate.storeUrl) Linking.openURL(appUpdate.storeUrl).catch(() => {}); } },
        ],
      );
    }
  }, [appUpdate?.available, appUpdate?.required, appUpdate?.storeUrl]);

  if (!appUpdate?.required) return null;

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>Time to update</Text>
          <Text style={s.body}>
            This version of LiveNew is out of date. Update to the latest to keep going — it only takes a moment.
          </Text>
          <Pressable
            style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
            onPress={() => { if (appUpdate.storeUrl) Linking.openURL(appUpdate.storeUrl).catch(() => {}); }}
          >
            <Text style={s.btnText}>Update now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    card: { alignItems: 'center', maxWidth: 340 },
    title: {
      fontFamily: fonts.displayBold, fontSize: 26, color: colors.text,
      letterSpacing: -0.2, marginBottom: 14, textAlign: 'center',
    },
    body: {
      fontFamily: fonts.body, fontSize: 16, color: colors.muted,
      lineHeight: 24, textAlign: 'center', marginBottom: 28,
    },
    btn: {
      backgroundColor: colors.gold, borderRadius: 14,
      paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center',
    },
    btnText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 17, letterSpacing: 0.2 },
  });
}
