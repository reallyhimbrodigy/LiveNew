// Social-auth client IDs. These are PUBLIC identifiers (safe to commit) —
// the secret half lives in Supabase Auth provider config, not the app.
//
// Where to find these:
//   Google Cloud Console → APIs & Services → Credentials
//     - WEB_CLIENT_ID:   the Web OAuth client (same one configured in Supabase)
//     - IOS_CLIENT_ID:   the iOS OAuth client (Bundle ID: app.livenew.mobile)
//
// IMPORTANT: webClientId is REQUIRED for iOS — it's the audience Supabase
// expects in the idToken. Without it, Supabase rejects the token with an
// "audience mismatch" error.

export const GOOGLE_WEB_CLIENT_ID = '388820236554-0iept81t48453g2b667c7qpfb7jdp15h.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID = '388820236554-nopaftj6tobedjd8fnl71rifth445a94.apps.googleusercontent.com';
