import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import App from './App';

// Keep the native splash up until the app explicitly hides it.
// Must run at module scope so it fires before any frame is rendered.
SplashScreen.preventAutoHideAsync().catch(() => {});

// FAILSAFE: the native splash must NEVER stay up forever. Even if React fails
// to mount, or the boot screen throws before it can hide the splash, force it
// down after 3s so the user is never stuck on the logo. (A boot screen that
// held the splash open and never hid it was the App Store launch hang.)
setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {});
}, 3000);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
