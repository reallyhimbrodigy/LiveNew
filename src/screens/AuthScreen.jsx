import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { api } from '../api';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const login = useAuthStore(s => s.login);
  const signup = useAuthStore(s => s.signup);
  const isSignUp = mode === 'signup';

  const handleSubmit = async () => {
    setError('');
    setSuccess('');

    if (!email.trim()) { setError('Enter your email address.'); return; }
    if (!password) { setError('Enter your password.'); return; }
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
        // If no confirmation needed, auto-login
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
        setSuccess('Check your email to confirm your account.');
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
              <Text style={{ color: colors.muted, fontSize: 15 }}>← Back</Text>
            </TouchableOpacity>

            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text style={s.title}>Reset password</Text>

              {resetSent ? (
                <>
                  <Text style={{ color: colors.gold, fontSize: 16, textAlign: 'center', marginTop: 16, lineHeight: 24 }}>
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
                  <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                    Enter your email and we'll send you a link to reset your password.
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

          <Text style={s.logo}>LiveNew</Text>

          <Text style={s.heading}>
            {isSignUp ? 'Create account' : 'Log in'}
          </Text>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}
          {success ? <View style={s.successBox}><Text style={s.successText}>{success}</Text></View> : null}

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
              style={[s.input, { flex: 1, marginBottom: 0 }]}
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
              <Text style={{ color: colors.gold, fontSize: 13 }}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={s.submitText}>
                {isSignUp ? 'Create Account' : 'Continue'}
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  container: { flex: 1, padding: 24 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, textAlign: 'center' },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
  },

  logo: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 40,
    letterSpacing: 1,
  },

  heading: {
    fontSize: 22,
    fontWeight: '600',
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
  eyeText: { color: colors.dim, fontSize: 14, fontWeight: '500' },

  submitBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },

  submitText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
  },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },

  switchText: { color: colors.muted, fontSize: 14 },
  switchLink: { color: colors.gold, fontSize: 14, fontWeight: '600' },

  errorBox: {
    backgroundColor: 'rgba(200,80,80,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(200,80,80,0.15)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: colors.error, fontSize: 14 },

  successBox: {
    backgroundColor: 'rgba(196,168,108,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(196,168,108,0.15)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  successText: { color: colors.gold, fontSize: 14 },
});
