import React from 'react';

/**
 * Minimal error boundary. If its children throw during render, it calls
 * onError(error) once and renders `fallback` (default: null) instead of
 * crashing the whole tree.
 *
 * Used to make the boot animation NON-FATAL: if BootLoader throws on a real
 * device, the app still proceeds to render instead of being stuck behind the
 * native splash forever.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errored: false };
  }

  static getDerivedStateFromError() {
    return { errored: true };
  }

  componentDidCatch(error, info) {
    try {
      this.props.onError && this.props.onError(error, info);
    } catch {}
  }

  render() {
    if (this.state.errored) {
      return this.props.fallback != null ? this.props.fallback : null;
    }
    return this.props.children;
  }
}
