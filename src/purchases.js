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

export async function initPurchases(userId) {
  try {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
    if (Platform.OS === 'ios') {
      await Purchases.configure({ apiKey: API_KEY, appUserID: userId || null });
    }
  } catch (err) {
    console.error('[PURCHASES] init failed:', err);
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

export async function purchasePackage(pkg) {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const isActive = hasActiveEntitlement(customerInfo);
    return isActive;
  } catch (err) {
    if (err.userCancelled) return false;
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
