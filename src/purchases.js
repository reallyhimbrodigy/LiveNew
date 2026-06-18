import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

const API_KEY = 'appl_iHzKiLwHXhOkGobAjCtIFTtrOSw';

// Premium = ANY active RevenueCat entitlement.
// IMPORTANT: every product in RevenueCat grants the "LiveNew Pro" entitlement —
// the "pro" entitlement is archived with NO products attached. The old check
// (`entitlements.active.pro`) therefore NEVER matched a real purchase, so paying
// subscribers were silently downgraded to free the moment their 7-day trial
// ended. Checking "is there any active entitlement" is correct (LiveNew has a
// single premium tier) and can't be broken again by an entitlement rename.
function hasActiveEntitlement(customerInfo) {
  const active = customerInfo?.entitlements?.active;
  return !!active && Object.keys(active).length > 0;
}

// Configure RevenueCat exactly once per process. We ALWAYS configure at boot
// (even when logged out, as an anonymous RC user) so offerings/purchases work
// the moment the user reaches the paywall — the old code only configured at
// cold boot IF already logged in, so a fresh sign-up/sign-in session never
// configured RC and every purchase failed ("payment didn't go through").
let configured = false;

export async function initPurchases(userId) {
  try {
    if (Platform.OS !== 'ios') return;
    if (!configured) {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
      await Purchases.configure({ apiKey: API_KEY, appUserID: userId || null });
      configured = true;
    } else if (userId) {
      await Purchases.logIn(userId);
    }
  } catch (err) {
    console.error('[PURCHASES] init failed:', err);
  }
}

// Associate the RevenueCat user with the signed-in LiveNew user. Call after
// EVERY successful auth so the purchase (and the server's entitlement lookup)
// is tied to this account — not to an anonymous RC id.
export async function identifyPurchases(userId) {
  try {
    if (Platform.OS !== 'ios' || !userId) return;
    if (!configured) { await initPurchases(userId); return; }
    await Purchases.logIn(userId);
  } catch (err) {
    console.error('[PURCHASES] identify failed:', err);
  }
}

// Reset to an anonymous RC user on logout so the next account doesn't inherit
// the previous user's entitlements on this device.
export async function logoutPurchases() {
  try {
    if (Platform.OS !== 'ios' || !configured) return;
    await Purchases.logOut();
  } catch (err) {
    console.error('[PURCHASES] logout failed:', err);
  }
}

export async function checkSubscription() {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const isActive = hasActiveEntitlement(customerInfo);
    return isActive;
  } catch {
    return false;
  }
}

export async function getOfferings() {
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings.current) {
      return offerings.current;
    }
    return null;
  } catch {
    return null;
  }
}

// Returns { active, cancelled }. `active` = entitlement is live now; `cancelled`
// = the user backed out of the Apple sheet. A completed StoreKit purchase that
// isn't `active` yet still means the user PAID (entitlement may reconcile a beat
// later) — the caller should treat that as success, never leave them stuck.
export async function purchasePackage(pkg) {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { active: hasActiveEntitlement(customerInfo), cancelled: false };
  } catch (err) {
    if (err.userCancelled) return { active: false, cancelled: true };
    throw err;
  }
}

export async function restorePurchases() {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const isActive = hasActiveEntitlement(customerInfo);
    return isActive;
  } catch {
    return false;
  }
}
