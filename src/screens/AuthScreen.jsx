import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { api } from '../api';
import IrisSignature from '../components/IrisSignature';

export default function AuthScreen() {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [info, setInfo] = useState(''); // soft warning (not error, not success)
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const login = useAuthStore(z => z.login);
  const signup = useAuthStore(z => z.signup);
  const isSignUp = mode === 'signup';

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    setInfo('');

    if (!email.trim()) { setError('Enter your email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    if (!password) { setError('Enter your password.'); return; }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (mode === 'signup' && !name.trim()) { setError('Enter your name.'); return; }

    setLoading(true);

    try {
      if (mode === 'signup') {
        const data = await signup(email.trim(), password, name.trim());
        if (data?.needsEmailConfirm) {
          setSuccess('Check your email to confirm your account.');
          setLoading(false);
          return;
        }
        await login(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      if (err.code === 'ACCOUNT_EXISTS') {
        setError('Account already exists.');
        setTimeout(() => {
          setMode('login');
          setPassword('');
          setName('');
        }, 1500);
      } else if (err.code === 'INVALID_CREDENTIALS') {
        setError('Invalid email or password.');
      } else if (err.code === 'EMAIL_NOT_CONFIRMED') {
        setInfo('Check your email to confirm your account before logging in.');
      } else if (err.code === 'NETWORK_ERROR') {
        setError('Check your internet connection.');
      } else {
        setError(err.message || 'Something went wrong.');
      }
    }

    setLoading(false);
  };

  const toggleMode = () => {
    setMode(m => m === 'login' ? 'signup' : 'login');
    setError('');
    setSuccess('');
    setPassword('');
    setName('');
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    try {
      await api.resetPassword(resetEmail.trim().toLowerCase());
      setResetSent(true);
    } catch {
      Alert.alert('Error', 'Could not send reset email. Please try again.');
    }
    setResetLoading(false);
  };

  if (showForgot) {
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.container}>
            <TouchableOpacity onPress={() => { setShowForgot(false); setResetSent(false); }} style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 15 }}>← Back</Text>
            </TouchableOpacity>

            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text style={s.title}>Reset password</Text>

              {resetSent ? (
                <>
                  <Text style={{ color: colors.gold, fontFamily: fonts.body, fontSize: 16, textAlign: 'center', marginTop: 16, lineHeight: 24 }}>
                    Check your email for a password reset link.
                  </Text>
                  <TouchableOpacity
                    style={[s.btn, { marginTop: 24 }]}
                    onPress={() => { setShowForgot(false); setResetSent(false); }}
                    activeOpacity={0.8}
                  >
                    <Text style={s.btnText}>Back to sign in</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                    Enter your email. I'll send you a link to reset your password.
                  </Text>
                  <TextInput
                    style={s.input}
                    value={resetEmail}
                    onChangeText={setResetEmail}
                    placeholder="Email address"
                    placeholderTextColor={colors.dim}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[s.btn, (!resetEmail.trim() || resetLoading) && { opacity: 0.4 }]}
                    onPress={handleResetPassword}
                    disabled={!resetEmail.trim() || resetLoading}
                    activeOpacity={0.8}
                  >
                    <Text style={s.btnText}>{resetLoading ? 'Sending...' : 'Send reset link'}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          <View style={s.logoRow}>
            <Text style={s.logo}>LiveNew</Text>
            <IrisSignature />
          </View>

          <Text style={s.heading}>
            {isSignUp ? 'Create account' : 'Log in'}
          </Text>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}
          {success ? <View style={s.successBox}><Text style={s.successText}>{success}</Text></View> : null}
          {info ? <View style={s.infoBox}><Text style={s.infoText}>{info}</Text></View> : null}

          {isSignUp && (
            <TextInput
              style={s.input}
              placeholder="Full name"
              placeholderTextColor={colors.dim}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
            />
          )}

          <TextInput
            style={s.input}
            placeholder="Email address"
            placeholderTextColor={colors.dim}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <View style={s.passWrap}>
            <TextInput
              style={[s.input, { flex: 1, marginBottom: 0, borderWidth: 0, backgroundColor: 'transparent' }]}
              placeholder="Password"
              placeholderTextColor={colors.dim}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword(v => !v)}>
              <Text style={s.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          {!isSignUp && (
            <TouchableOpacity onPress={() => setShowForgot(true)} style={{ alignSelf: 'flex-end', marginBottom: 16, marginTop: -4 }}>
              <Text style={{ color: colors.gold, fontFamily: fonts.displaySemibold, fontSize: 13 }}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color="#1a1612" size="small" />
            ) : (
              <Text style={s.submitText}>
                {isSignUp ? 'Create Account' : 'Log in'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={s.switchRow}>
            <Text style={s.switchText}>
              {isSignUp ? "Already have an account? " : "Don't have an account? "}
            </Text>
            <TouchableOpacity onPress={toggleMode}>
              <Text style={s.switchLink}>
                {isSignUp ? 'Log in' : 'Sign up'}
              </Text>
            </TouchableOpacity>
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
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    container: { flex: 1, padding: 24 },
    title: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.text, textAlign: 'center' },
    btn: {
      backgroundColor: colors.gold,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
    },
    btnText: {
      color: '#1a1612',
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
    },

    logoRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 12,
      marginBottom: 40,
    },
    logo: {
      fontFamily: fonts.displaySemibold,
      fontSize: 26,
      color: colors.gold,
      letterSpacing: 1,
    },

    heading: {
      fontFamily: fonts.displaySemibold,
      fontSize: 22,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 28,
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
      marginBottom: 12,
    },

    passWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      marginBottom: 12,
      paddingRight: 12,
    },

    eyeBtn: { padding: 8 },
    eyeText: { color: colors.dim, fontFamily: fonts.displaySemibold, fontSize: 14 },

    submitBtn: {
      backgroundColor: colors.gold,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },

    submitText: {
      color: '#1a1612',
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
    },

    switchRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 24,
    },

    switchText: { color: colors.muted, fontFamily: fonts.body, fontSize: 14 },
    switchLink: { color: colors.gold, fontFamily: fonts.displaySemibold, fontSize: 14 },

    errorBox: {
      backgroundColor: colors.errorBg,
      borderWidth: 1,
      borderColor: colors.errorBorder,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    errorText: { color: colors.error, fontFamily: fonts.body, fontSize: 14 },

    successBox: {
      backgroundColor: colors.successBg,
      borderWidth: 1,
      borderColor: colors.success,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    successText: { color: colors.success, fontFamily: fonts.body, fontSize: 14 },
    infoBox: {
      backgroundColor: colors.goldDim,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    infoText: { color: colors.gold, fontFamily: fonts.body, fontSize: 14 },
  });
}
