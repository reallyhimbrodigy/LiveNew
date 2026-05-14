// Delete the EAS-cached provisioning profile via Expo's GraphQL API.
//
// Why this exists: when you change iOS entitlements (e.g. add App Groups),
// EAS Build *should* auto-regenerate the provisioning profile but in
// practice often reuses its cached copy and the build fails with
// "Provisioning profile doesn't support X capability." The official fix is
// to delete the profile from EAS's credential store; the CLI only exposes
// that via interactive prompts, so we do it via GraphQL directly.
//
// Authentication: pulls the Expo session secret from ~/.expo/state.json
// (set by `npx expo login`).

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const EXPO_STATE_PATH = path.join(homedir(), ".expo", "state.json");
const GRAPHQL_URL = "https://api.expo.dev/graphql";

const APP_FULL_NAME = "@zaclibman/livenew";
const BUNDLE_ID = "app.livenew.mobile";

function sessionSecret() {
  if (!existsSync(EXPO_STATE_PATH)) {
    throw new Error(`Expo session not found at ${EXPO_STATE_PATH}. Run \`npx expo login\` first.`);
  }
  const state = JSON.parse(readFileSync(EXPO_STATE_PATH, "utf8"));
  const sess = state?.auth?.sessionSecret;
  if (!sess) throw new Error("No sessionSecret in ~/.expo/state.json — login first.");
  return sess;
}

async function gql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "expo-session": sessionSecret(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}\n${text}`);
  if (body?.errors?.length) throw new Error(`GraphQL errors:\n${JSON.stringify(body.errors, null, 2)}`);
  return body?.data;
}

async function listProfiles() {
  const query = `
    query ListProfiles($projectFullName: String!) {
      app {
        byFullName(fullName: $projectFullName) {
          id
          iosAppCredentials {
            id
            iosAppBuildCredentialsList {
              id
              iosDistributionType
              provisioningProfile {
                id
                developerPortalIdentifier
                expiration
                status
              }
            }
          }
        }
      }
    }
  `;
  const data = await gql(query, { projectFullName: APP_FULL_NAME });
  const profiles = [];
  const credLists = data?.app?.byFullName?.iosAppCredentials || [];
  for (const cred of credLists) {
    for (const build of cred.iosAppBuildCredentialsList || []) {
      if (build?.provisioningProfile?.id) {
        profiles.push({
          id: build.provisioningProfile.id,
          developerPortalIdentifier: build.provisioningProfile.developerPortalIdentifier,
          status: build.provisioningProfile.status,
          dist: build.iosDistributionType,
        });
      }
    }
  }
  return profiles;
}

async function deleteProfiles(ids) {
  const mutation = `
    mutation DeleteProfiles($ids: [ID!]!) {
      appleProvisioningProfile {
        deleteAppleProvisioningProfiles(ids: $ids) {
          id
        }
      }
    }
  `;
  const data = await gql(mutation, { ids });
  return data?.appleProvisioningProfile?.deleteAppleProvisioningProfiles || [];
}

(async () => {
  try {
    console.log(`Project: ${APP_FULL_NAME}`);
    console.log(`Bundle:  ${BUNDLE_ID}\n`);

    const profiles = await listProfiles();
    if (profiles.length === 0) {
      console.log("No provisioning profiles found in EAS credential store. Nothing to delete.");
      return;
    }

    console.log(`Found ${profiles.length} profile(s) in EAS credentials:`);
    for (const p of profiles) {
      console.log(`  • ${p.developerPortalIdentifier} [${p.dist}] status=${p.status} (EAS id ${p.id})`);
    }

    const ids = profiles.map((p) => p.id);
    const deleted = await deleteProfiles(ids);
    console.log(`\n✓ Deleted ${deleted.length} profile(s) from EAS store.`);
    console.log("\n🎉 Next EAS build will request fresh profiles from Apple with current entitlements (App Group included).");
  } catch (err) {
    console.error("\nERROR:", err.message);
    process.exit(1);
  }
})();
