import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tapLight, tapSuccess, tapSelect } from '../haptics';

const { width } = Dimensions.get('window');

function InstructionReveal({ text, phaseIndex, totalSeconds, secondsLeft }) {
  const sentences = React.useMemo(() => {
    if (!text) return [];
    return text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) || [text];
  }, [text]);

  const elapsed = totalSeconds - secondsLeft;
  const timePerSentence = sentences.length > 0 ? totalSeconds / sentences.length : totalSeconds;
  const visibleCount = Math.min(
    sentences.length,
    Math.floor(elapsed / timePerSentence) + 1
  );

  // Reset scroll position when phase changes
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    scrollRef.current?.scrollToEnd?.({ animated: true });
  }, [visibleCount]);

  return (
    <ScrollView
      ref={scrollRef}
      style={revealStyles.wrap}
      contentContainerStyle={revealStyles.content}
      showsVerticalScrollIndicator={false}
    >
      {sentences.slice(0, visibleCount).map((sentence, i) => (
        <Text
          key={`${phaseIndex}-${i}`}
          style={[
            revealStyles.sentence,
            i === visibleCount - 1 && revealStyles.currentSentence,
            i < visibleCount - 1 && revealStyles.pastSentence,
          ]}
        >
          {sentence}
        </Text>
      ))}
    </ScrollView>
  );
}

function isBreathingPhase(instruction) {
  if (!instruction) return false;
  const lower = instruction.toLowerCase();
  return lower.includes('breathe') || lower.includes('inhale') || lower.includes('exhale') || lower.includes('breath');
}

function BreathingCircle({ secondsLeft, totalSeconds }) {
  const animRef = React.useRef(new (require('react-native').Animated.Value)(0)).current;

  React.useEffect(() => {
    // 4 seconds in, 4 seconds out cycle
    const cycle = require('react-native').Animated.loop(
      require('react-native').Animated.sequence([
        require('react-native').Animated.timing(animRef, {
          toValue: 1,
          duration: 4000,
          useNativeDriver: true,
        }),
        require('react-native').Animated.timing(animRef, {
          toValue: 0,
          duration: 4000,
          useNativeDriver: true,
        }),
      ])
    );
    cycle.start();
    return () => cycle.stop();
  }, []);

  const scale = animRef.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  const opacity = animRef.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.6, 0.3],
  });

  const Animated = require('react-native').Animated;

  return (
    <View style={breathStyles.wrap}>
      <Animated.View style={[breathStyles.circle, { transform: [{ scale }], opacity }]} />
      <Animated.View style={[breathStyles.circleInner, { transform: [{ scale }] }]} />
      <Text style={breathStyles.label}>
        {animRef._value > 0.5 ? 'breathe in' : 'breathe out'}
      </Text>
    </View>
  );
}

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
            tapLight();
            setPhaseIndex(p => p + 1);
          } else {
            tapSuccess();
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
    tapSelect();
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
    tapSuccess();
    
    // Save completion — retry if it fails
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const plan = JSON.parse(raw);
          if (!plan.completedSessions) plan.completedSessions = {};
          plan.completedSessions[onCompleteKey] = true;
          await AsyncStorage.setItem('livenew:plan', JSON.stringify(plan));
        }
        break;
      } catch {
        if (attempt === 2) console.error('[SESSION] Failed to save completion after 3 attempts');
      }
    }

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

        {/* Breathing animation if this phase involves breathing */}
        {isBreathingPhase(currentPhase?.instruction) && (
          <BreathingCircle secondsLeft={secondsLeft} totalSeconds={totalSecs} />
        )}

        {/* Instruction — sentence by sentence */}
        <InstructionReveal
          text={currentPhase.instruction}
          phaseIndex={phaseIndex}
          totalSeconds={(currentPhase.minutes || 1) * 60}
          secondsLeft={secondsLeft}
        />

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

const revealStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    marginVertical: 8,
  },
  content: {
    paddingVertical: 8,
    justifyContent: 'center',
    flexGrow: 1,
  },
  sentence: {
    fontSize: 18,
    lineHeight: 28,
    color: colors.text,
    marginBottom: 12,
  },
  currentSentence: {
    color: colors.text,
  },
  pastSentence: {
    color: colors.dim,
  },
});

const breathStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    marginVertical: 8,
  },
  circle: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(196,168,108,0.08)',
  },
  circleInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
  label: {
    position: 'absolute',
    bottom: 10,
    color: colors.dim,
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
