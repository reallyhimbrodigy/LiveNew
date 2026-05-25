import React from "react";
import * as Sentry from "@sentry/react-native";
import RootNavigator from "./src/navigation/RootNavigator";

// Sentry — wired but only active when EXPO_PUBLIC_SENTRY_DSN is set at
// build time. Without a DSN, this is a no-op; no crash visibility but no
// errors either. Set the DSN via EAS env or your shell before building.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // No performance tracing for v1 — just crashes + unhandled errors.
    tracesSampleRate: 0,
    // Mask any in-flight data attached to error reports.
    sendDefaultPii: false,
    // Tag every event with the environment so we can filter dev noise from prod.
    environment: __DEV__ ? "development" : "production",
  });
}

function App() {
  return <RootNavigator />;
}

// Sentry.wrap installs an ErrorBoundary at the root + sets up native crash
// reporting. Safe to call even when DSN is unset (becomes a pass-through).
export default Sentry.wrap(App);
