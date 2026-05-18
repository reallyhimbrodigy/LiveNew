import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Easing, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { api } from '../api';
import { tapLight, tapSelect } from '../haptics';
import IrisSignature from '../components/IrisSignature';

// Free-form chat with Iris. Modal-presented from TodayStack. The input bar
// is anchored to just above the keyboard; messages auto-scroll; loading
// shows a typing-dots animation (three pulsing dots) instead of a generic
// spinner. Conversation is in-memory only — no cross-session persistence
// in v1. Server rate-limits at 50 messages per 24h per user.

const SUGGESTIONS = [
  "Best supplement for sleep?",
  "Should I work out today?",
  "Why am I waking at 3am?",
  "How do I lower morning anxiety?",
];

// Three-dot typing indicator. Each dot pulses on a staggered offset, the
// pattern you see in iMessage / ChatGPT / Claude. Looks alive without being
// distracting.
function TypingDots({ color }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (val, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay(420 - delay),
        ])
      );
    const loops = [make(a, 0), make(b, 140), make(c, 280)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c]);

  const dot = (val) => ({
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
  });

  return (
    <View style={typingStyles.row}>
      <Animated.View style={[typingStyles.dot, { backgroundColor: color }, dot(a)]} />
      <Animated.View style={[typingStyles.dot, { backgroundColor: color }, dot(b)]} />
      <Animated.View style={[typingStyles.dot, { backgroundColor: color }, dot(c)]} />
    </View>
  );
}

const typingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  dot:  { width: 6, height: 6, borderRadius: 3 },
});

// Bubble row that fades in on mount. Subtle entrance gives chat a less
// "thrown on the screen" feel.
function Bubble({ role, content, s, fade }) {
  const opacity = useRef(new Animated.Value(fade ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(fade ? 6 : 0)).current;
  useEffect(() => {
    if (!fade) return;
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [fade, opacity, translateY]);
  const isUser = role === 'user';
  return (
    <Animated.View
      style={[
        s.bubbleRow,
        isUser ? s.bubbleRowUser : s.bubbleRowAssistant,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      <View style={isUser ? s.bubbleUser : s.bubbleAssistant}>
        <Text style={isUser ? s.bubbleUserText : s.bubbleAssistantText}>{content}</Text>
      </View>
    </Animated.View>
  );
}

export default function ChatScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors, fonts, insets), [colors, fonts, insets]);
  const userName = useAuthStore(z => z.userName);
  const healthSnapshot = useAuthStore(z => z.healthSnapshot);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const scrollRef = useRef(null);
  const mountedRef = useRef(true);
  const sendScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Auto-scroll to bottom on new message or while typing dots are showing.
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, sending]);

  // Scroll to bottom when keyboard shows so the latest message stays in view.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
  }, []);

  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || sending) return;
    setError('');
    setInput('');
    tapSelect();
    // Send-button press pulse.
    Animated.sequence([
      Animated.timing(sendScale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.timing(sendScale, { toValue: 1,    duration: 120, useNativeDriver: true }),
    ]).start();

    const newMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(newMessages);
    setSending(true);
    try {
      const res = await api.irisChat(newMessages, healthSnapshot);
      if (!mountedRef.current) return;
      if (res?.rateLimit) {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.message || "You've hit today's chat limit." }]);
      } else if (res?.text) {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.text }]);
      } else {
        setError("Iris couldn't reach the network. Try again.");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.code === 'NETWORK_ERROR') setError("Check your internet connection.");
      else setError("Something went wrong — try again.");
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [messages, sending, healthSnapshot, sendScale]);

  const canSend = !!input.trim() && !sending;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => { tapLight(); navigation.goBack(); }} hitSlop={10} style={s.closeBtnHit}>
            <Text style={s.closeBtn}>✕</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View style={s.headerCenter}>
              <IrisSignature />
              <Text style={s.headerSuffix}>chat</Text>
            </View>
          </View>
          <View style={{ width: 28 }} />
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={s.intro}>
              <Text style={s.introTitle}>
                {userName ? `Hi, ${userName}.` : 'Hi.'} Ask me anything.
              </Text>
              <Text style={s.introBody}>
                I'll keep it tight. Body stuff only — sleep, stress, cortisol, supplements, energy. Try one of these:
              </Text>
              <View style={s.suggestionList}>
                {SUGGESTIONS.map((q, i) => (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [s.suggestionChip, pressed && { opacity: 0.78, transform: [{ scale: 0.98 }] }]}
                    onPress={() => send(q)}
                  >
                    <Text style={s.suggestionText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                content={m.content}
                s={s}
                fade={i === messages.length - 1}
              />
            ))
          )}

          {sending ? (
            <View style={[s.bubbleRow, s.bubbleRowAssistant]}>
              <View style={[s.bubbleAssistant, s.typingBubble]}>
                <TypingDots color={colors.muted} />
              </View>
            </View>
          ) : null}

          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>

        {/* Input bar — anchored above keyboard. Pill shape; gold circular
            send button only enables when there's a non-empty draft. */}
        <View style={[s.inputBar, inputFocused && s.inputBarFocused]}>
          <View style={[s.inputWrap, inputFocused && s.inputWrapFocused]}>
            <TextInput
              style={s.input}
              placeholder="Ask Iris…"
              placeholderTextColor={colors.dim}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onSubmitEditing={() => send(input)}
              blurOnSubmit={false}
              editable={!sending}
              returnKeyType="send"
            />
          </View>
          <Animated.View style={{ transform: [{ scale: sendScale }] }}>
            <Pressable
              style={({ pressed }) => [
                s.sendBtn,
                !canSend && s.sendBtnDisabled,
                pressed && canSend && { opacity: 0.85 },
              ]}
              onPress={() => send(input)}
              disabled={!canSend}
              hitSlop={8}
              accessibilityLabel="Send message"
            >
              <Text style={[s.sendBtnText, !canSend && s.sendBtnTextDisabled]}>↑</Text>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts, insets) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    closeBtnHit: { width: 28, height: 28, alignItems: 'flex-start', justifyContent: 'center' },
    closeBtn: { fontSize: 20, color: colors.muted },
    headerCenter: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    headerSuffix: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
    },

    scroll: {
      padding: 16,
      paddingBottom: 24,
    },

    // Intro / empty state
    intro: {
      paddingHorizontal: 4,
      paddingTop: 16,
    },
    introTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 26,
      color: colors.text,
      letterSpacing: -0.2,
      marginBottom: 10,
    },
    introBody: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 23,
      marginBottom: 18,
    },
    suggestionList: {
      gap: 8,
    },
    suggestionChip: {
      borderWidth: 1,
      borderColor: colors.goldBorder,
      backgroundColor: colors.goldSoft,
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
    },
    suggestionText: {
      fontFamily: fonts.italic,
      fontSize: 14,
      color: colors.text,
    },

    // Bubbles
    bubbleRow: {
      width: '100%',
      marginBottom: 8,
      flexDirection: 'row',
    },
    bubbleRowUser:      { justifyContent: 'flex-end' },
    bubbleRowAssistant: { justifyContent: 'flex-start' },
    bubbleUser: {
      maxWidth: '80%',
      backgroundColor: colors.gold,
      borderRadius: 20,
      borderBottomRightRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    bubbleUserText: {
      fontFamily: fonts.body,
      fontSize: 15.5,
      color: '#1a1612',
      lineHeight: 22,
    },
    bubbleAssistant: {
      maxWidth: '85%',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 20,
      borderBottomLeftRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    bubbleAssistantText: {
      fontFamily: fonts.body,
      fontSize: 15.5,
      color: colors.text,
      lineHeight: 22,
    },
    typingBubble: {
      paddingVertical: 12,
      paddingHorizontal: 16,
    },

    error: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.error,
      textAlign: 'center',
      marginTop: 12,
    },

    // Input bar — pill input + circular gold send button
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 10) : 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
      backgroundColor: colors.bg,
      gap: 10,
    },
    inputBarFocused: {
      // No visible change — focus styling is on the pill itself.
    },
    inputWrap: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.line,
      minHeight: 44,
      justifyContent: 'center',
    },
    inputWrapFocused: {
      borderColor: colors.goldBorder,
    },
    input: {
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.text,
      paddingHorizontal: 16,
      paddingVertical: Platform.OS === 'ios' ? 11 : 8,
      maxHeight: 120,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.gold,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 5,
    },
    sendBtnDisabled: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      shadowOpacity: 0,
    },
    sendBtnText: {
      fontSize: 20,
      color: '#1a1612',
      fontFamily: fonts.displayBold,
      lineHeight: 22,
    },
    sendBtnTextDisabled: {
      color: colors.dim,
    },
  });
}
