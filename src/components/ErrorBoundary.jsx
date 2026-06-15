import React from 'react';
import { Text, ScrollView } from 'react-native';

/**
 * Error boundary.
 *  - Default: on a child render error, calls onError(error) and renders
 *    `fallback` (default null) — used to make the boot screen non-fatal.
 *  - With `diagnostic`: instead of a blank fallback, it DISPLAYS the caught
 *    error message + stack on screen, so a render crash shows the actual cause
 *    on-device instead of crashing the app. (Used to surface the post-boot
 *    render crash without needing a remote crash report.)
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errored: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { errored: true, error };
  }

  componentDidCatch(error, info) {
    try {
      this.props.onError && this.props.onError(error, info);
    } catch {}
  }

  render() {
    if (this.state.errored) {
      if (this.props.diagnostic) {
        const e = this.state.error;
        const msg = e ? (e.message || String(e)) : 'Render error';
        const stack = e && e.stack ? String(e.stack) : '';
        return (
          <ScrollView
            style={{ flex: 1, backgroundColor: '#0f0d0a' }}
            contentContainerStyle={{ padding: 24, paddingTop: 90 }}
          >
            <Text selectable style={{ color: '#c4a86c', fontSize: 20, fontWeight: '700', marginBottom: 14 }}>
              App error (diagnostic)
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
      return this.props.fallback != null ? this.props.fallback : null;
    }
    return this.props.children;
  }
}
