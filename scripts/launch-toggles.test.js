import { withServer } from "./lib/server.js";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  await withServer(
    {
      CANARY_ALLOWLIST: "",
      FREEZE_LIB_VERSION: "true",
      EXPECTED_LIB_VERSION: String(LIB_VERSION),
      CONTRACT_LOCK: "true",
      DOMAIN_LOCK: "true",
      STATIC_ROOT_LOCK: "true",
      EXPECTED_STATIC_ROOT: "public",
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/readyz`);
      const payload = await res.json().catch(() => null);
      assert(res.ok && payload?.ok, "server should start with locks enabled and canary allowlist cleared");
    }
  );

  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
