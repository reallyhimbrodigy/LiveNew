// One-shot Supabase auth config: SMTP via Resend + branded email templates.
//
// Why this script exists:
//   Supabase's auth config (SMTP, mailer templates, email confirmation toggle)
//   isn't accessible from the SQL editor — it's GoTrue service config, not a
//   table. The Management API at api.supabase.com is the only way to set
//   these programmatically. This script PATCHes the auth config in one call.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=sbp_xxx \
//   SUPABASE_PROJECT_REF=abcdefghij \
//   RESEND_API_KEY=re_xxx \
//   node scripts/setup-supabase-auth.mjs
//
// To get the Supabase access token (one-time):
//   https://supabase.com/dashboard/account/tokens → Generate new token

import { readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "RESEND_API_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing required env vars: " + missing.join(", "));
  console.error("\nUsage:");
  console.error("  SUPABASE_ACCESS_TOKEN=sbp_xxx \\");
  console.error("  SUPABASE_PROJECT_REF=abcdefghij \\");
  console.error("  RESEND_API_KEY=re_xxx \\");
  console.error("  node scripts/setup-supabase-auth.mjs");
  process.exit(1);
}

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN.trim();
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF.trim();
const RESEND_KEY = process.env.RESEND_API_KEY.trim();

const TEMPLATE_DIR = path.join(process.cwd(), "docs/email-templates");

async function readTemplate(name) {
  const full = path.join(TEMPLATE_DIR, name);
  const body = await readFile(full, "utf8");
  return body;
}

async function main() {
  console.log(`\nConfiguring auth for project: ${PROJECT_REF}\n`);

  // Load the branded HTML email bodies from docs/email-templates/.
  // These match the templates we shipped in the repo.
  const [confirmHtml, recoveryHtml, magicLinkHtml] = await Promise.all([
    readTemplate("01-confirm-signup.html"),
    readTemplate("02-reset-password.html"),
    readTemplate("03-magic-link.html"),
  ]);

  // Auth config payload. Field names match Supabase Management API's
  // /v1/projects/{ref}/config/auth schema.
  const payload = {
    // --- SMTP (Resend) ---
    smtp_admin_email: "support@livenew.app",
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: RESEND_KEY,
    smtp_sender_name: "LiveNew",
    smtp_max_frequency: 60,

    // --- Enforce email confirmation on signup ---
    // false = users must verify before they can log in. This is what we want.
    mailer_autoconfirm: false,

    // --- Branded templates ---
    mailer_subjects_confirmation: "Your LiveNew verification code",
    mailer_templates_confirmation_content: confirmHtml,

    mailer_subjects_recovery: "Reset your LiveNew password",
    mailer_templates_recovery_content: recoveryHtml,

    mailer_subjects_magic_link: "Your LiveNew sign-in code",
    mailer_templates_magic_link_content: magicLinkHtml,

    // We keep email-change and invite templates at defaults for now — they're
    // rarely triggered in our flow. Can override later if needed.
  };

  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`PATCH ${url} failed: HTTP ${res.status}`);
    console.error(text);
    process.exit(1);
  }

  console.log("✓ SMTP configured: Resend → smtp.resend.com:465");
  console.log("  Sender: LiveNew <support@livenew.app>");
  console.log("");
  console.log("✓ Email confirmation required on signup (mailer_autoconfirm=false)");
  console.log("");
  console.log("✓ Branded templates installed:");
  console.log("  • Confirm signup     →  01-confirm-signup.html");
  console.log("  • Reset password     →  02-reset-password.html");
  console.log("  • Magic link         →  03-magic-link.html");
  console.log("");
  console.log("Next: test by signing up a new account in the LiveNew app.");
  console.log("If the email doesn't arrive, check Supabase Dashboard → Logs → Auth.");
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message || err);
  process.exit(1);
});
