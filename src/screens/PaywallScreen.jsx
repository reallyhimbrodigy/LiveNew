import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { getOfferings, purchasePackage, restorePurchases } from '../purchases';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapSuccess } from '../haptics';
import IrisSignature from '../components/IrisSignature';
import CortisolFact from '../components/CortisolFact';

// Two-tier paywall: Annual (highlighted, default) and Monthly. The 14-day
// free trial happens BEFORE this screen ever appears — by the time the
// user lands here, they've already used Iris for 14 days. The copy
// reflects that.
export default function PaywallScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const [offering, setOffering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [selected, setSelected] = useState('annual'); // 'annual' | 'monthly'
  const setSubscribed = useAuthStore(z => z.setSubscribed);

  useEffect(() => {
    (async () => {
      const off = await getOfferings();
      setOffering(off);
      setLoading(false);
    })();
  }, []);

  const monthly = offering?.monthly || null;
  const annual = offering?.annual || null;

  // Display prices — fall back to defaults if RevenueCat hasn't returned
  // offerings yet. These match what we configure in App Store Connect.
  const monthlyPrice = monthly?.product?.priceString || '$9.99';
  const annualPrice = annual?.product?.priceString || '$59.99';
  const annualMonthlyEquivalent = annual?.product?.price
    ? `$${(annual.product.price / 12).toFixed(2)}/mo`
    : '$4.99/mo';
  const annualSavingsPercent = monthly?.product?.price && annual?.product?.price
    ? Math.round((1 - (annual.product.price / 12) / monthly.product.price) * 100)
    : 50;

  const handleSubscribe = async () => {
    const pkg = selected === 'annual' ? annual : monthly;
    if (!pkg) {
      Alert.alert('Hmm', "We couldn't load the subscription right now. Try again in a moment.");
      return;
    }
    tapLight();
    setPurchasing(true);
    try {
      const success = await purchasePackage(pkg);
      if (success) {
        tapSuccess();
        await setSubscribed(true);
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert('Purchase failed', "Something went wrong. Try again, or use Restore if you've already subscribed.");
    }
    setPurchasing(false);
  };

  const handleRestore = async () => {
    tapSelect();
    setPurchasing(true);
    try {
      const success = await restorePurchases();
      if (success) {
        tapSuccess();
        await setSubscribed(true);
        navigation.goBack();
      } else {
        Alert.alert('No subscription found', "We couldn't find an active subscription for this Apple ID.");
      }
    } catch {
      Alert.alert('Restore failed', 'Try again in a moment.');
    }
    setPurchasing(false);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <Pressable
        style={s.closeBtn}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      >
        <Text style={s.closeText}>✕</Text>
      </Pressable>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.brandRow}>
          <Text style={s.logo}>LiveNew</Text>
          <IrisSignature size="header" />
        </View>

        <Text style={s.title}>Two weeks with me.</Text>
        <Text style={s.titleAccent}>Keep going.</Text>

        <Text style={s.sub}>
          You felt what the curve looks like when it's actually tuned. People who stay past this point notice the difference in another two weeks.
        </Text>

        <CortisolFact style={s.paywallFact} />

        <View style={s.features}>
          {[
            'Unlimited daily plans, sharpened by your patterns',
            'Full chat with Iris — sleep, supplements, protocols',
            'Behavior profile that gets smarter every day',
            'Weekly outcome deltas — see what actually changed',
            'Lock-screen + home-screen widgets',
          ].map((f, i) => (
            <View key={i} style={s.featureRow}>
              <Text style={s.featureCheck}>✓</Text>
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* Tier picker — annual highlighted as best value, monthly as alt */}
        <View style={s.tiers}>
          <Pressable
            onPress={() => { tapSelect(); setSelected('annual'); }}
            style={[
              s.tierCard,
              selected === 'annual' && s.tierCardSelected,
            ]}
          >
            <View style={s.tierTopRow}>
              <Text style={s.tierName}>Annual</Text>
              <View style={s.bestBadge}>
                <Text style={s.bestBadgeText}>BEST VALUE</Text>
              </View>
            </View>
            <Text style={s.tierPriceBig}>{annualPrice}<Text style={s.tierPriceUnit}>/year</Text></Text>
            <Text style={s.tierSub}>{annualMonthlyEquivalent} · save {annualSavingsPercent}%</Text>
            <View style={[s.radio, selected === 'annual' && s.radioSelected]}>
              {selected === 'annual' ? <View style={s.radioDot} /> : null}
            </View>
          </Pressable>

          <Pressable
            onPress={() => { tapSelect(); setSelected('monthly'); }}
            style={[
              s.tierCard,
              selected === 'monthly' && s.tierCardSelected,
            ]}
          >
            <View style={s.tierTopRow}>
              <Text style={s.tierName}>Monthly</Text>
            </View>
            <Text style={s.tierPriceBig}>{monthlyPrice}<Text style={s.tierPriceUnit}>/month</Text></Text>
            <Text style={s.tierSub}>Cancel any time</Text>
            <View style={[s.radio, selected === 'monthly' && s.radioSelected]}>
              {selected === 'monthly' ? <View style={s.radioDot} /> : null}
            </View>
          </Pressable>
        </View>

        <View style={s.bottom}>
          {loading ? (
            <ActivityIndicator color={colors.gold} />
          ) : !monthly && !annual ? (
            // Offerings failed to load (RevenueCat couldn't fetch products,
            // or App Store Connect products aren't configured yet). Make
            // the failure VISIBLE — never let the CTA look enabled but be
            // dead. Apple rejected the previous build for this exact issue.
            <View>
              <View style={s.errorCard}>
                <Text style={s.errorTitle}>Pricing unavailable</Text>
                <Text style={s.errorBody}>
                  Subscription details couldn't be loaded right now. Check your connection or try again in a moment.
                </Text>
              </View>
              <Pressable onPress={handleRestore} disabled={purchasing} style={s.restoreBtn} hitSlop={10}>
                <Text style={s.restoreText}>Restore purchase</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [
                  s.purchaseBtn,
                  pressed && { opacity: 0.88 },
                  purchasing && { opacity: 0.6 },
                ]}
                onPress={handleSubscribe}
                disabled={purchasing}
              >
                {purchasing ? (
                  <ActivityIndicator color="#1a1612" size="small" />
                ) : (
                  <Text style={s.purchaseBtnText}>Continue with Iris</Text>
                )}
              </Pressable>

              <Text style={s.legal}>
                Auto-renews until canceled. Manage in your Apple ID account settings.
              </Text>

              <Pressable onPress={handleRestore} disabled={purchasing} style={s.restoreBtn} hitSlop={10}>
                <Text style={s.restoreText}>Restore purchase</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    closeBtn: {
      position: 'absolute',
      top: 16,
      right: 20,
      zIndex: 10,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: { color: colors.muted, fontSize: 16 },

    scroll: {
      paddingHorizontal: 24,
      paddingTop: 56,
      paddingBottom: 24,
    },

    brandRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    logo: {
      fontFamily: fonts.displaySemibold,
      fontSize: 18,
      color: colors.gold,
      letterSpacing: 1.2,
    },

    title: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      letterSpacing: -0.2,
      lineHeight: 38,
    },
    titleAccent: {
      fontFamily: fonts.italic,
      fontSize: 32,
      color: colors.gold,
      letterSpacing: 0.2,
      marginBottom: 16,
      lineHeight: 38,
    },

    sub: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 23,
      marginBottom: 22,
    },

    // Cortisol fact card — adds motivational weight before the features list.
    paywallFact: {
      marginBottom: 20,
    },
    features: { gap: 11, marginBottom: 24 },
    featureRow: { flexDirection: 'row', alignItems: 'center' },
    featureCheck: {
      color: colors.gold,
      fontFamily: fonts.displayBold,
      fontSize: 14,
      marginRight: 10,
      width: 18,
    },
    featureText: {
      color: colors.text,
      fontFamily: fonts.body,
      fontSize: 14,
      flex: 1,
      lineHeight: 20,
    },

    // Tier picker
    tiers: { gap: 10, marginBottom: 20 },
    tierCard: {
      borderWidth: 1.5,
      borderColor: colors.line,
      borderRadius: 14,
      padding: 16,
      backgroundColor: colors.surface,
      position: 'relative',
    },
    tierCardSelected: {
      borderColor: colors.gold,
      backgroundColor: colors.goldSoft,
    },
    tierTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    tierName: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: colors.text,
      letterSpacing: 0.3,
    },
    bestBadge: {
      backgroundColor: colors.gold,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    bestBadgeText: {
      fontFamily: fonts.displayBold,
      fontSize: 9,
      color: '#1a1612',
      letterSpacing: 1.2,
    },
    tierPriceBig: {
      fontFamily: fonts.displayBold,
      fontSize: 26,
      color: colors.text,
      letterSpacing: -0.4,
    },
    tierPriceUnit: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.muted,
    },
    tierSub: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
      marginTop: 2,
      letterSpacing: 0.2,
    },
    radio: {
      position: 'absolute',
      top: 16,
      right: 16,
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    radioSelected: {
      borderColor: colors.gold,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.gold,
    },

    bottom: { gap: 10 },
    purchaseBtn: {
      backgroundColor: colors.gold,
      borderRadius: 14,
      paddingVertical: 17,
      alignItems: 'center',
    },
    purchaseBtnText: {
      color: '#1a1612',
      fontFamily: fonts.displayBold,
      fontSize: 17,
      letterSpacing: 0.3,
    },
    legal: {
      color: colors.dim,
      fontFamily: fonts.body,
      fontSize: 11,
      textAlign: 'center',
      lineHeight: 16,
      marginTop: 4,
    },
    restoreBtn: { alignItems: 'center', marginTop: 6, padding: 6 },
    restoreText: {
      color: colors.muted,
      fontFamily: fonts.body,
      fontSize: 13,
    },

    // Visible empty-state when subscription offerings fail to load. Tells
    // the user explicitly so the button is never just sitting there
    // looking enabled but doing nothing.
    errorCard: {
      borderWidth: 1,
      borderColor: colors.errorBorder,
      backgroundColor: colors.errorBg,
      borderRadius: 14,
      padding: 16,
      marginBottom: 14,
    },
    errorTitle: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: colors.error,
      marginBottom: 6,
    },
    errorBody: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.text,
      lineHeight: 19,
    },
  });
}
