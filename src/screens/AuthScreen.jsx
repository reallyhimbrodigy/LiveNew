import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuth from 'expo-apple-authentication';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import IrisSignature from '../components/IrisSignature';
import GoogleGLogo from '../components/GoogleGLogo';

// Passwordless OTP entry: ask for email, fire signInWithOtp on the server, hop
// to the VerifyEmail screen where the user types the 6-digit code Supabase
// just emailed them. No password, no signup/login toggle, no name capture
// (name is collected during onboarding for new users). Single field, single
// button — matches the modern mental model from Linear / Notion / Substack.
export default function AuthScreen({ navigation }) {
  const { colors, fonts, scheme } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); // 'apple' | 'google' | null
  const [error, setError] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const inputRef = useRef(null);

  const sendOtp = useAuthStore((z) => z.sendOtp);
  const signInWithApple = useAuthStore((z) => z.signInWithApple);
  const signInWithGoogle = useAuthStore((z) => z.signInWithGoogle);

  // Apple Sign In is iOS-only and only on iOS 13+. Check availability so we
  // don't render a button that errors when tapped.
  useEffect(() => {
    if (Platform.OS !== 'ios') { setAppleAvailable(false); return; }
    AppleAuth.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const handleApple = async () => {
    setError('');
    setSocialLoading('apple');
    try {
      await signInWithApple();
      // Navigation handled by RootNavigator on isLoggedIn flip.
    } catch (err) {
      // ERR_REQUEST_CANCELED = user dismissed the sheet. Silent.
      if (err?.code !== 'ERR_REQUEST_CANCELED' && err?.code !== 'ERR_CANCELED') {
        setError(err?.message || "Couldn't sign in with Apple. Try email instead.");
      }
    } finally {
      setSocialLoading(null);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setSocialLoading('google');
    try {
      await signInWithGoogle();
    } catch (err) {
      // SIGN_IN_CANCELLED = user dismissed. Silent.
      if (err?.code !== 'SIGN_IN_CANCELLED' && err?.code !== '-5') {
        setError(err?.message || "Couldn't sign in with Google. Try email instead.");
      }
    } finally {
      setSocialLoading(null);
    }
  };

  // Email field is no longer auto-focused — the social buttons above it would
  // get hidden by the keyboard opening instantly on mount. Users who want
  // email tap the field themselves.

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
            New or returning — pick a way to continue.
          </Text>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}

          {/* Apple-first per HIG: when available, the Sign in with Apple
              button leads the social options. Apple's button comes from
              expo-apple-authentication so it matches system styling/locale.
              In dark mode use the WHITE button (white pill on dark bg),
              in light mode the BLACK button (black pill on light bg) — this
              matches Apple's HIG and reads as native, not bolted-on. */}
          {appleAvailable ? (
            <AppleAuth.AppleAuthenticationButton
              buttonType={AppleAuth.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                scheme === 'dark'
                  ? AppleAuth.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuth.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={12}
              style={s.appleBtn}
              onPress={handleApple}
            />
          ) : null}

          <Pressable
            onPress={handleGoogle}
            disabled={socialLoading === 'google'}
            style={({ pressed }) => [
              s.googleBtn,
              pressed && { transform: [{ scale: 0.99 }] },
              socialLoading === 'google' && { opacity: 0.6 },
            ]}
          >
            {socialLoading === 'google' ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <>
                <GoogleGLogo size={18} />
                <Text style={s.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          {/* "or" divider between social and email */}
          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

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
              <Text style={s.submitText}>Continue with email</Text>
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
    safe: { flex: 1, backgroundColor: 'transparent' },
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

    // Apple button: 50pt is Apple's recommended minimum tap height. We use
    // 52 to match the Google button visually for a tidy stack.
    appleBtn: {
      width: '100%',
      height: 52,
      marginBottom: 12,
    },
    // Google button: matches the Apple button proportions exactly so the
    // social block reads as one block, not two unrelated buttons. Uses the
    // app's surface color so it blends with the brand rather than being a
    // jarring white pill on dark bg (Google's brand guidelines allow either).
    googleBtn: {
      width: '100%',
      height: 52,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      marginBottom: 12,
    },
    googleBtnText: {
      color: colors.text,
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      letterSpacing: 0.1,
    },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 8,
      marginBottom: 14,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.line,
    },
    dividerText: {
      fontFamily: fonts.italic,
      fontSize: 12,
      color: colors.dim,
      letterSpacing: 0.8,
      textTransform: 'lowercase',
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
