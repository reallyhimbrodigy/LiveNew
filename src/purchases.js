import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

const API_KEY = 'test_SZYJnIvVrooYovFarwJtZZcIAKd';

export async function initPurchases(userId) {
  try {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
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
    const isActive = customerInfo?.entitlements?.active?.pro !== undefined;
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
    const isActive = customerInfo?.entitlements?.active?.pro !== undefined;
    return isActive;
  } catch (err) {
    if (err.userCancelled) return false;
    throw err;
  }
}

export async function restorePurchases() {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const isActive = customerInfo?.entitlements?.active?.pro !== undefined;
    return isActive;
  } catch {
    return false;
  }
}
