import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';
import { Text, ScrollView } from 'react-native';

// Hide the native splash immediately and unconditionally. If any JavaScript is
// running at all, the user can never be stuck on the logo after this point.
SplashScreen.hideAsync().catch(() => {});

// Load the real app inside a try/catch so a module-scope throw anywhere in its
// import chain is CAUGHT and shown on screen, instead of silently stranding the
// app behind the splash. require() (not import) runs the module synchronously
// here so we can catch its init error.
let App = null;
let loadError = null;
try {
  App = require('./App').default;
} catch (e) {
  loadError = e;
  try {
    // Also log so a local Metro/simulator run captures the raw error in stdout.
    console.error('[LAUNCH_ERROR]', (e && (e.stack || e.message)) || e);
  } catch {}
}

function Root() {
  if (loadError || !App) {
    const msg = loadError ? (loadError.message || String(loadError)) : 'App failed to load.';
    const stack = loadError && loadError.stack ? String(loadError.stack) : '';
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#0f0d0a' }}
        contentContainerStyle={{ padding: 24, paddingTop: 90 }}
      >
        <Text style={{ color: '#c4a86c', fontSize: 20, fontWeight: '700', marginBottom: 14 }}>
          Launch diagnostic
        </Text>
        <Text selectable style={{ color: '#ffffff', fontSize: 14, marginBottom: 18 }}>
          {msg}
        </Text>
        <Text selectable style={{ color: '#9a9a9a', fontSize: 11, lineHeight: 16 }}>
          {stack}
        </Text>
      </ScrollView>
    );
  }
  return <App />;
}

registerRootComponent(Root);
