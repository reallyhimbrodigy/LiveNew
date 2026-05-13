import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { getOfferings, purchasePackage, restorePurchases } from '../purchases';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSuccess } from '../haptics';

export default function PaywallScreen({ navigation, route }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const [offering, setOffering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const setSubscribed = useAuthStore(z => z.setSubscribed);

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

        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.closeText}>✕</Text>
        </TouchableOpacity>

        <View style={s.content}>
          <Text style={s.logo}>LiveNew</Text>
          <Text style={s.title}>Keep going with Iris</Text>

          <Text style={s.sub}>
            You've been using LiveNew for a week. People who stick with it past this point report feeling measurably calmer within 2 weeks.
          </Text>

          <View style={s.features}>
            {[
              'Unlimited daily plans tuned to your patterns',
              'Iris references your real routine and biometrics',
              'Evening reflections that shape tomorrow',
              'Stress tracking that tells a story, not just numbers',
              'A plan that gets sharper the longer you use it',
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
                  <ActivityIndicator color="#1a1612" size="small" />
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

function makeStyles(colors, fonts) {
  return StyleSheet.create({
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
      fontFamily: fonts.displaySemibold,
      fontSize: 18,
      color: colors.gold,
      letterSpacing: 1.2,
      marginBottom: 14,
    },

    title: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      marginBottom: 20,
      letterSpacing: 0.2,
    },

    sub: {
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.muted,
      lineHeight: 25,
      marginBottom: 24,
      letterSpacing: 0.1,
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
      fontFamily: fonts.displayBold,
      fontSize: 15,
      marginRight: 10,
      width: 18,
    },

    featureText: {
      color: colors.text,
      fontFamily: fonts.body,
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
      color: '#1a1612',
      fontFamily: fonts.displaySemibold,
      fontSize: 17,
    },

    priceNote: {
      color: colors.dim,
      fontFamily: fonts.body,
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
      fontFamily: fonts.body,
      fontSize: 13,
    },
  });
}
