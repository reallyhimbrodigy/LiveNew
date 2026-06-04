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

export const GOOGLE_WEB_CLIENT_ID = 'REPLACE_WITH_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID = 'REPLACE_WITH_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com';
