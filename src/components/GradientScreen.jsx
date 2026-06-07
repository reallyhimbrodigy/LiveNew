import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppBackground from './AppBackground';

// Screen wrapper that paints the shared circadian background behind safe-area
// content. Most screens get the background globally (rendered once behind the
// navigator) and just keep transparent surfaces; this wrapper is for screens
// that want to own their backdrop explicitly. Uses the same AppBackground so
// the gradient is always identical to the rest of the app.
export default function GradientScreen({ edges = ['top'], style, children }) {
  return (
    <View style={{ flex: 1 }}>
      <AppBackground />
      <SafeAreaView style={[{ flex: 1 }, style]} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}
