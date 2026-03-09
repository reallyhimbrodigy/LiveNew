import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

export default function SessionScreen({ route, navigation }) {
  const { session, onCompleteKey } = route.params;
  const phases = session?.phases || [];

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const intervalRef = useRef(null);

  const currentPhase = phases[phaseIndex];
  const totalPhases = phases.length;

  // Initialize timer for current phase
  useEffect(() => {
    if (currentPhase) {
      setSecondsLeft((currentPhase.minutes || 1) * 60);
    }
  }, [phaseIndex]);

  // Timer tick
  useEffect(() => {
    if (isPaused || isComplete || !currentPhase) return;

    intervalRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          // Auto-advance to next phase
          if (phaseIndex < totalPhases - 1) {
            setPhaseIndex(p => p + 1);
          } else {
            setIsComplete(true);
            setShowFeedback(true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [phaseIndex, isPaused, isComplete, currentPhase, totalPhases]);

  const handleSkip = () => {
    clearInterval(intervalRef.current);
    if (phaseIndex < totalPhases - 1) {
      setPhaseIndex(p => p + 1);
    } else {
      setIsComplete(true);
      setShowFeedback(true);
    }
  };

  const handleExit = () => {
    clearInterval(intervalRef.current);
    navigation.goBack();
  };

  const handleFeedback = async (feeling) => {
    // Save completion
    try {
      const raw = await AsyncStorage.getItem('livenew:plan');
      if (raw) {
        const plan = JSON.parse(raw);
        if (!plan.completedSessions) plan.completedSessions = {};
        plan.completedSessions[onCompleteKey] = true;
        await AsyncStorage.setItem('livenew:plan', JSON.stringify(plan));
      }
    } catch {}

    // Report to server (fire and forget)
    try {
      const { api } = require('../api');
      api.feedback({
        type: 'session',
        feeling,
        dateISO: new Date().toISOString().slice(0, 10),
        sessionIndex: onCompleteKey,
      }).catch(() => {});
    } catch {}

    navigation.goBack();
  };

  // Format timer
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timerDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  // Progress percentage for current phase
  const totalSecs = (currentPhase?.minutes || 1) * 60;
  const progress = totalSecs > 0 ? (totalSecs - secondsLeft) / totalSecs : 0;

  // Feedback screen
  if (showFeedback) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.feedbackWrap}>
          <Text style={s.feedbackTitle}>How do you feel?</Text>
          <View style={s.feedbackOptions}>
            {['Better', 'Same', 'Not sure'].map(opt => (
              <TouchableOpacity
                key={opt}
                style={s.feedbackBtn}
                onPress={() => handleFeedback(opt.toLowerCase())}
                activeOpacity={0.7}
              >
                <Text style={s.feedbackBtnText}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentPhase) return null;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity onPress={handleExit} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.exitText}>Exit</Text>
          </TouchableOpacity>
          <Text style={s.phaseCount}>
            {phaseIndex + 1} of {totalPhases}
          </Text>
          <TouchableOpacity onPress={handleSkip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={s.progressBarBg}>
          <View style={[s.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>

        {/* Timer */}
        <Text style={s.timer}>{timerDisplay}</Text>

        {/* Session title */}
        <Text style={s.sessionTitle}>{session.title}</Text>

        {/* Instruction */}
        <View style={s.instructionWrap}>
          <Text style={s.instruction}>{currentPhase.instruction}</Text>
        </View>

        {/* Pause / Resume */}
        <TouchableOpacity
          style={s.pauseBtn}
          onPress={() => setIsPaused(p => !p)}
          activeOpacity={0.7}
        >
          <Text style={s.pauseBtnText}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  container: {
    flex: 1,
    padding: 20,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },

  exitText: {
    color: colors.muted,
    fontSize: 15,
  },

  phaseCount: {
    color: colors.dim,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  skipText: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '500',
  },

  // Progress bar
  progressBarBg: {
    height: 3,
    backgroundColor: colors.line,
    borderRadius: 2,
    marginBottom: 32,
    overflow: 'hidden',
  },

  progressBarFill: {
    height: '100%',
    backgroundColor: colors.gold,
    borderRadius: 2,
  },

  // Timer
  timer: {
    fontSize: 56,
    fontWeight: '200',
    color: colors.gold,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 2,
  },

  // Session title
  sessionTitle: {
    fontSize: 14,
    color: colors.dim,
    textAlign: 'center',
    marginBottom: 32,
  },

  // Instruction
  instructionWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },

  instruction: {
    fontSize: 18,
    color: colors.text,
    lineHeight: 28,
    textAlign: 'left',
  },

  // Pause
  pauseBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },

  pauseBtnText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '500',
  },

  // Feedback
  feedbackWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  feedbackTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 32,
  },

  feedbackOptions: {
    flexDirection: 'row',
    gap: 12,
  },

  feedbackBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },

  feedbackBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
});
