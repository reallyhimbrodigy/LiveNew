import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import App from './App';

// The native splash auto-hides once the first JS frame renders. A failsafe
// clears it a couple seconds in, in case auto-hide doesn't fire on some OS.
setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {});
}, 2000);

registerRootComponent(App);
