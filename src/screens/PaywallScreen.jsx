import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { getOfferings, purchasePackage, restorePurchases } from '../purchases';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSuccess } from '../haptics';

export default function PaywallScreen({ navigation, route }) {
  const [offering, setOffering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const setSubscribed = useAuthStore(s => s.setSubscribed);

  // Preview data passed from Today screen
  const planPreview = route?.params?.planPreview || null;

  useEffect(() => {
    (async () => {
      const off = await getOfferings();
      setOffering(off);
      setLoading(false);
    })();
  }, []);

  const handlePurchase = async () => {
    if (!offering?.monthly) return;
    tapLight();
    setPurchasing(true);
    try {
      const success = await purchasePackage(offering.monthly);
      if (success) {
        tapSuccess();
        await setSubscribed(true);
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert('Error', 'Purchase failed. Please try again.');
    }
    setPurchasing(false);
  };

  const handleRestore = async () => {
    tapLight();
    setPurchasing(true);
    try {
      const success = await restorePurchases();
      if (success) {
        tapSuccess();
        await setSubscribed(true);
        navigation.goBack();
      } else {
        Alert.alert('No subscription found', 'We couldn\'t find an active subscription for this account.');
      }
    } catch {
      Alert.alert('Error', 'Could not restore. Please try again.');
    }
    setPurchasing(false);
  };

  const price = offering?.monthly?.product?.priceString || '$9.99/month';
  const trialText = offering?.monthly?.product?.introPrice
    ? `${offering.monthly.product.introPrice.periodNumberOfUnits}-day free trial, then `
    : '';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        {/* Close button */}
        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.closeText}>✕</Text>
        </TouchableOpacity>

        <View style={s.content}>
          <Text style={s.logo}>LiveNew</Text>
          <Text style={s.title}>Your plan is ready</Text>

          {/* Plan preview */}
          {planPreview && planPreview.sessions && (
            <View style={s.previewWrap}>
              {planPreview.sessions.map((ses, i) => (
                <View key={i} style={s.previewRow}>
                  <View style={s.previewDot} />
                  <View style={s.previewContent}>
                    <Text style={s.previewTitle}>{ses.title}</Text>
                    <Text style={s.previewTime}>{ses.time}</Text>
                  </View>
                </View>
              ))}
              {planPreview.meals && planPreview.meals.length > 0 && (
                <View style={s.previewRow}>
                  <View style={s.previewDot} />
                  <Text style={s.previewTitle}>{planPreview.meals.length} meals planned</Text>
                </View>
              )}
            </View>
          )}

          <Text style={s.sub}>
            Subscribe to unlock your full personalized plan — guided sessions, timed meals, progress tracking, and plans that get smarter every day.
          </Text>

          {/* Features */}
          <View style={s.features}>
            {[
              'Full guided sessions with timers',
              'Personalized meals timed to your day',
              'Progress tracking and stress insights',
              'Plans that evolve with your history',
              'Session reminders at the right time',
            ].map((f, i) => (
              <View key={i} style={s.featureRow}>
                <Text style={s.featureCheck}>✓</Text>
                <Text style={s.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.bottom}>
          {loading ? (
            <ActivityIndicator color={colors.gold} />
          ) : (
            <>
              <TouchableOpacity
                style={s.purchaseBtn}
                onPress={handlePurchase}
                disabled={purchasing}
                activeOpacity={0.8}
              >
                {purchasing ? (
                  <ActivityIndicator color={colors.bg} size="small" />
                ) : (
                  <Text style={s.purchaseBtnText}>
                    {trialText ? `Start free trial` : `Subscribe for ${price}`}
                  </Text>
                )}
              </TouchableOpacity>

              <Text style={s.priceNote}>{trialText}{price}</Text>

              <TouchableOpacity style={s.restoreBtn} onPress={handleRestore} disabled={purchasing}>
                <Text style={s.restoreText}>Restore purchase</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },

  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 20,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.muted, fontSize: 16 },

  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },

  logo: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.gold,
    letterSpacing: 1,
    marginBottom: 12,
  },

  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 20,
  },

  previewWrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },

  previewDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
    marginRight: 12,
  },

  previewContent: { flex: 1 },

  previewTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },

  previewTime: {
    fontSize: 12,
    color: colors.dim,
  },

  sub: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: 20,
  },

  features: {
    gap: 10,
  },

  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  featureCheck: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '600',
    marginRight: 10,
    width: 18,
  },

  featureText: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },

  bottom: {
    padding: 24,
    paddingBottom: 16,
  },

  purchaseBtn: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },

  purchaseBtnText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: '600',
  },

  priceNote: {
    color: colors.dim,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },

  restoreBtn: {
    alignItems: 'center',
    marginTop: 12,
    padding: 8,
  },

  restoreText: {
    color: colors.muted,
    fontSize: 13,
  },
});
