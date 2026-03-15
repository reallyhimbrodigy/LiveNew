import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function maybePromptReview() {
  try {
    const raw = await AsyncStorage.getItem('livenew:review_prompted');
    if (raw === 'true') return;

    const streakRaw = await AsyncStorage.getItem('livenew:streak');
    if (!streakRaw) return;
    const streak = JSON.parse(streakRaw);

    if (streak.count >= 3) {
      const isAvailable = await StoreReview.isAvailableAsync();
      if (isAvailable) {
        setTimeout(async () => {
          await StoreReview.requestReview();
          await AsyncStorage.setItem('livenew:review_prompted', 'true');
        }, 2000);
      }
    }
  } catch {}
}
