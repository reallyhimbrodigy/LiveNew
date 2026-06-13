import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import App from './App';

// We deliberately do NOT call preventAutoHideAsync(). The native splash
// auto-hides as soon as the first JS frame renders — the behavior that shipped
// fine before this app's custom boot screen was added. Holding the splash up
// (preventAutoHide) and depending on the boot screen to hide it is exactly what
// stranded the app on the logo when that hide didn't fire on-device.
//
// Failsafe: force-hide a couple seconds after launch in case auto-hide doesn't
// fire on some OS version. Harmless no-op if the splash is already gone.
setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {});
}, 2000);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
registerRootComponent(App);
