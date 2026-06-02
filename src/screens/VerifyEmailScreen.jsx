import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';

// Cool-down (seconds) between Resend taps so users don't hammer Supabase and
// trigger rate limits.
const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyEmailScreen({ route, navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const email = route?.params?.email || '';
  const verifySignupOtp = useAuthStore((z) => z.verifySignupOtp);
  const resendSignupOtp = useAuthStore((z) => z.resendSignupOtp);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const inputRef = useRef(null);

  // Auto-focus the code field on mount and after the cooldown ticker fires
  // (so the user can keep typing if they switch back from the mail app).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  // Cool-down countdown for the Resend button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Auto-submit as soon as 6 digits are entered — saves the user a tap and
  // matches the experience of most other modern apps' OTP screens.
  useEffect(() => {
    if (code.length === 6 && !loading) {
      handleVerify(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleVerify = async (codeToSubmit) => {
    const value = (codeToSubmit ?? code).trim();
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await verifySignupOtp(email, value);
      // Success: authStore flips isLoggedIn, so RootNavigator will swap the
      // stack and unmount this screen. No explicit navigation needed.
    } catch (err) {
      const code = err?.code || err?.body?.code;
      if (code === 'OTP_EXPIRED') {
        setError("That code expired. Tap Resend to get a new one.");
      } else if (code === 'OTP_INVALID') {
        setError("That code didn't work. Double-check or send a new one.");
      } else if (code === 'NETWORK_ERROR') {
        setError('Check your internet connection and try again.');
      } else {
        setError(err?.message || 'Could not verify the code. Try again.');
      }
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setError('');
    setInfo('');
    setResending(true);
    try {
      await resendSignupOtp(email);
      setInfo('New code sent. Check your email.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err?.message || 'Could not resend the code. Try again in a moment.');
    } finally {
      setResending(false);
    }
  };

  const handleChangeEmail = () => {
    // Go back to Auth screen so user can re-enter a different email
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.body}>
            <Text style={s.eyebrow}>Verify your email</Text>
            <Text style={s.headline}>Enter the 6-digit code.</Text>
            <Text style={s.sub}>
              We sent it to <Text style={s.subEmphasis}>{email || 'your email'}</Text>.
              {'\n'}It expires in an hour.
            </Text>

            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={colors.dim}
              style={s.codeInput}
              editable={!loading}
            />

            {error ? <Text style={s.error}>{error}</Text> : null}
            {info ? <Text style={s.info}>{info}</Text> : null}

            <TouchableOpacity
              style={[s.primaryBtn, (loading || code.length !== 6) && s.primaryBtnDisabled]}
              onPress={() => handleVerify()}
              disabled={loading || code.length !== 6}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={s.primaryBtnText}>Verify</Text>
              )}
            </TouchableOpacity>

            <View style={s.divider} />

            <View style={s.helperRow}>
              <Text style={s.helperLabel}>Didn't get it?</Text>
              <TouchableOpacity
                onPress={handleResend}
                disabled={cooldown > 0 || resending}
                activeOpacity={0.7}
              >
                <Text style={[s.helperLink, (cooldown > 0 || resending) && s.helperLinkDim]}>
                  {resending
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleChangeEmail} activeOpacity={0.7} style={s.changeEmailRow}>
              <Text style={s.changeEmailText}>Wrong email? Go back</Text>
            </TouchableOpacity>

            <Text style={s.footnote}>
              Check spam if you don't see it. The code comes from support@livenew.app.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
    body: { width: '100%', maxWidth: 420, alignSelf: 'center' },

    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 11,
      letterSpacing: 2.4,
      color: colors.gold,
      textTransform: 'uppercase',
      marginBottom: 12,
    },
    headline: {
      fontFamily: fonts.serifBold || fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      letterSpacing: -0.5,
      marginBottom: 16,
      lineHeight: 38,
    },
    sub: {
      fontFamily: fonts.displayRegular,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 22,
      marginBottom: 32,
    },
    subEmphasis: { color: colors.text, fontFamily: fonts.displaySemibold },

    codeInput: {
      fontFamily: fonts.displayBold || fonts.displaySemibold,
      fontSize: 32,
      letterSpacing: 14,
      textAlign: 'center',
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      paddingVertical: 18,
      paddingHorizontal: 18,
      backgroundColor: colors.card || colors.bg,
      marginBottom: 16,
    },

    error: {
      fontFamily: fonts.displayMedium,
      fontSize: 14,
      color: '#cc5a4a',
      textAlign: 'center',
      marginBottom: 16,
    },
    info: {
      fontFamily: fonts.displayMedium,
      fontSize: 14,
      color: colors.gold,
      textAlign: 'center',
      marginBottom: 16,
    },

    primaryBtn: {
      backgroundColor: colors.gold,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      color: colors.bg,
      letterSpacing: 0.3,
    },

    divider: {
      height: 1,
      backgroundColor: colors.line,
      marginVertical: 28,
    },

    helperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    helperLabel: {
      fontFamily: fonts.displayRegular,
      fontSize: 14,
      color: colors.muted,
    },
    helperLink: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: colors.gold,
    },
    helperLinkDim: { opacity: 0.45 },

    changeEmailRow: { alignItems: 'center', marginTop: 16 },
    changeEmailText: {
      fontFamily: fonts.displayMedium,
      fontSize: 13,
      color: colors.muted,
    },

    footnote: {
      fontFamily: fonts.displayRegular,
      fontSize: 12,
      color: colors.dim,
      textAlign: 'center',
      marginTop: 28,
      lineHeight: 18,
    },
  });
}
