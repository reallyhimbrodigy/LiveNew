import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import IrisSignature from '../components/IrisSignature';

// Passwordless OTP entry: ask for email, fire signInWithOtp on the server, hop
// to the VerifyEmail screen where the user types the 6-digit code Supabase
// just emailed them. No password, no signup/login toggle, no name capture
// (name is collected during onboarding for new users). Single field, single
// button — matches the modern mental model from Linear / Notion / Substack.
export default function AuthScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const sendOtp = useAuthStore((z) => z.sendOtp);

  // Focus the email field on mount — saves a tap and signals where to start.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async () => {
    setError('');
    const e = email.trim().toLowerCase();
    if (!e) { setError('Enter your email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await sendOtp(e);
      setLoading(false);
      navigation?.navigate('VerifyEmail', { email: e });
    } catch (err) {
      setLoading(false);
      if (err?.code === 'OTP_RATE_LIMITED') {
        setError('Too many tries. Wait a minute and try again.');
      } else if (err?.code === 'OTP_INVALID_EMAIL') {
        setError("That doesn't look like a valid email address.");
      } else if (err?.code === 'NETWORK_ERROR') {
        setError('Check your internet connection and try again.');
      } else {
        setError(err?.message || 'Could not send the code. Try again in a moment.');
      }
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.logoRow}>
            <Text style={s.logo}>LiveNew</Text>
            <IrisSignature />
          </View>

          <Text style={s.heading}>Sign in</Text>
          <Text style={s.sub}>
            Enter your email. We'll send a 6-digit code.{'\n'}
            New here? An account will be created automatically.
          </Text>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}

          <TextInput
            ref={inputRef}
            style={s.input}
            placeholder="Email address"
            placeholderTextColor={colors.dim}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            editable={!loading}
          />

          <TouchableOpacity
            style={[s.submitBtn, (!email.trim() || loading) && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!email.trim() || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={s.submitText}>Continue</Text>
            )}
          </TouchableOpacity>

          <Text style={s.footnote}>
            By continuing you agree to LiveNew's{' '}
            <Text style={s.footnoteLink}>Terms</Text>
            {' '}and{' '}
            <Text style={s.footnoteLink}>Privacy Policy</Text>.
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },

    logoRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 12,
      marginBottom: 56,
    },
    logo: {
      fontFamily: fonts.displaySemibold,
      fontSize: 26,
      color: colors.gold,
      letterSpacing: 1,
    },

    heading: {
      fontFamily: fonts.serifBold || fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      textAlign: 'center',
      letterSpacing: -0.5,
      marginBottom: 14,
    },
    sub: {
      fontFamily: fonts.displayRegular,
      fontSize: 15,
      color: colors.muted,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 32,
    },

    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      paddingHorizontal: 18,
      paddingVertical: 16,
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.text,
      marginBottom: 14,
    },

    submitBtn: {
      backgroundColor: colors.gold,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    submitBtnDisabled: { opacity: 0.45 },
    submitText: {
      color: colors.bg,
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      letterSpacing: 0.3,
    },

    footnote: {
      fontFamily: fonts.displayRegular,
      fontSize: 12,
      color: colors.dim,
      textAlign: 'center',
      marginTop: 28,
      lineHeight: 18,
    },
    footnoteLink: { color: colors.muted },

    errorBox: {
      backgroundColor: colors.errorBg || 'rgba(204, 90, 74, 0.08)',
      borderWidth: 1,
      borderColor: colors.errorBorder || 'rgba(204, 90, 74, 0.25)',
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    errorText: {
      color: colors.error || '#cc5a4a',
      fontFamily: fonts.body,
      fontSize: 14,
      textAlign: 'center',
    },
  });
}
