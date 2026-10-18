// Re-run one standing instruction now, as its owner, through the app's own
// Work endpoints (there is no separate run-now route): Pause, then Resume.
// Resume makes the instruction due at once; the q-api sweep (every minute)
// claims and fires it. Nothing else is changed: same grant, same delegation.
//
//   NODE_USE_ENV_PROXY=1 \
//   SB_URL=https://<ref>.supabase.co SB_KEY=<service role key> \
//   SB_PUBLISHABLE=<publishable key> \
//   OWNER_EMAIL=<the instruction owner's email> \
//   INSTRUCTION_ID=4fe0050f-51c1-430a-8343-6ec56fc8dae7 \
//   [SUPABASE_ACCESS_TOKEN=... to print the steps it recorded] \
//   node scripts/handoff/live/kick-instruction.mjs
//
// Sign-in is a magic link generated with the service key and exchanged at
// once: keys and the session stay in memory, nothing is printed or written.
// Run only after the deploy; it acts on production as the owner.

import { randomUUID } from "node:crypto";

const API = process.env.API ?? "https://capital-qapi-production.up.railway.app";
const need = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};
const SB_URL = need("SB_URL");
const ID = need("INSTRUCTION_ID");
if (!/^[0-9a-f-]{36}$/iu.test(ID)) {
  console.error("INSTRUCTION_ID must be a uuid");
  process.exit(2);
}

// ---- the owner's session, via a magic link (in memory only) --------------
const link = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: need("SB_KEY"),
    authorization: `Bearer ${need("SB_KEY")}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", email: need("OWNER_EMAIL") }),
});
if (!link.ok) {
  console.error(`magic link failed: HTTP ${link.status}`);
  process.exit(1);
}
const linkBody = await link.json();
const tokenHash =
  linkBody.hashed_token ?? linkBody.properties?.hashed_token ?? null;
if (tokenHash === null) {
  console.error("magic link carried no token hash");
  process.exit(1);
}
const verify = await fetch(`${SB_URL}/auth/v1/verify`, {
  method: "POST",
  headers: {
    apikey: need("SB_PUBLISHABLE"),
    "content-type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
});
if (!verify.ok) {
  console.error(`magic link exchange failed: HTTP ${verify.status}`);
  process.exit(1);
}
const { access_token: token } = await verify.json();

const post = async (path) => {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: "{}",
  });
  return {
    status: response.status,
    text: (await response.text()).slice(0, 300),
  };
};

// ---- Pause, then Resume: due now ------------------------------------------
const startedAt = new Date().toISOString();
const paused = await post(`/v1/q/work/${ID}/pause`);
console.log("pause", paused.status, paused.text);
if (paused.status >= 300 && paused.status !== 404) process.exit(1);
const resumed = await post(`/v1/q/work/${ID}/resume`);
console.log("resume", resumed.status, resumed.text);
if (resumed.status >= 300) {
  console.error("resume refused: the instruction may not be ACTIVE or yours");
  process.exit(1);
}
console.log(`${startedAt} due now; the sweep fires it within about a minute`);

// ---- optional: the steps it recorded (read-only) --------------------------
const access = process.env.SUPABASE_ACCESS_TOKEN;
if (access !== undefined && access !== "") {
  await new Promise((resolve) => setTimeout(resolve, 150_000));
  const response = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `select created_at, action, status, reason_code, left(words, 200) as words from q_runtime.instruction_steps where instruction_id = '${ID}' and created_at >= '${startedAt}' order by created_at`,
        read_only: true,
      }),
    },
  );
  console.log(response.status, (await response.text()).slice(0, 4000));
}
