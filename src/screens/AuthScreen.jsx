import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const login = useAuthStore(s => s.login);
  const signup = useAuthStore(s => s.signup);

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

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          <Text style={s.logo}>LiveNew</Text>

          <Text style={s.heading}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </Text>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}
          {success ? <View style={s.successBox}><Text style={s.successText}>{success}</Text></View> : null}

          {mode === 'signup' && (
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

          <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={s.submitText}>
                {mode === 'login' ? 'Continue' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={s.switchRow}>
            <Text style={s.switchText}>
              {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
            </Text>
            <TouchableOpacity onPress={toggleMode}>
              <Text style={s.switchLink}>
                {mode === 'login' ? 'Sign up' : 'Log in'}
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
  errorText: { color: '#c97a7a', fontSize: 14 },

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
