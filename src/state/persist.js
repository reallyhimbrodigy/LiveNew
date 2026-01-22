import AsyncStorage from "@react-native-async-storage/async-storage";

export async function saveJSON(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadJSON(key) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function removeJSON(key) {
  await AsyncStorage.removeItem(key);
}
