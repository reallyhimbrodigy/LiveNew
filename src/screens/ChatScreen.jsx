import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { api } from '../api';
import { tapLight, tapSelect } from '../haptics';
import IrisSignature from '../components/IrisSignature';

// Free-form chat with Iris. Not a replacement for the structured 8-zone plan;
// an addition for the "I have a specific question" moment.
//
// Conversation lives only in this session — no cross-session persistence
// for v1. Server rate-limits at 50 messages per 24h per user.

const SUGGESTIONS = [
  "Best supplement for sleep?",
  "Should I work out today?",
  "Why am I waking at 3am?",
  "How do I lower morning anxiety?",
];

export default function ChatScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const userName = useAuthStore(z => z.userName);
  const healthSnapshot = useAuthStore(z => z.healthSnapshot);

  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages.length, sending]);

  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || sending) return;
    setError('');
    setInput('');
    tapSelect();
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
  }, [messages, sending, healthSnapshot]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => { tapLight(); navigation.goBack(); }} hitSlop={10}>
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
                    style={({ pressed }) => [s.suggestionChip, pressed && { opacity: 0.85 }]}
                    onPress={() => send(q)}
                  >
                    <Text style={s.suggestionText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m, i) => (
              <View
                key={i}
                style={[
                  s.bubbleRow,
                  m.role === 'user' ? s.bubbleRowUser : s.bubbleRowAssistant,
                ]}
              >
                <View style={m.role === 'user' ? s.bubbleUser : s.bubbleAssistant}>
                  <Text style={m.role === 'user' ? s.bubbleUserText : s.bubbleAssistantText}>
                    {m.content}
                  </Text>
                </View>
              </View>
            ))
          )}

          {sending ? (
            <View style={[s.bubbleRow, s.bubbleRowAssistant]}>
              <View style={s.bubbleAssistant}>
                <ActivityIndicator color={colors.gold} size="small" />
              </View>
            </View>
          ) : null}

          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>

        {/* Input */}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Ask Iris…"
            placeholderTextColor={colors.dim}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            onSubmitEditing={() => send(input)}
            blurOnSubmit={false}
            editable={!sending}
          />
          <Pressable
            style={({ pressed }) => [
              s.sendBtn,
              (!input.trim() || sending) && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => send(input)}
            disabled={!input.trim() || sending}
            hitSlop={8}
          >
            <Text style={s.sendBtnText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
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
    closeBtn: {
      fontSize: 20,
      color: colors.muted,
      width: 28,
    },
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
    bubbleRowUser: { justifyContent: 'flex-end' },
    bubbleRowAssistant: { justifyContent: 'flex-start' },
    bubbleUser: {
      maxWidth: '80%',
      backgroundColor: colors.gold,
      borderRadius: 18,
      borderBottomRightRadius: 4,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    bubbleUserText: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: '#1a1612',
      lineHeight: 22,
    },
    bubbleAssistant: {
      maxWidth: '85%',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 18,
      borderBottomLeftRadius: 4,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    bubbleAssistantText: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
    },

    error: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.error,
      textAlign: 'center',
      marginTop: 12,
    },

    // Input
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 10 : 14,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      backgroundColor: colors.bg,
      gap: 10,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 22,
      paddingVertical: 10,
      paddingHorizontal: 16,
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.text,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: colors.line,
    },
    sendBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnText: {
      fontSize: 18,
      color: '#1a1612',
      fontFamily: fonts.displayBold,
      lineHeight: 20,
    },
  });
}
