// Investor journey on production: one conversation, realistic asks, full replies.
// Usage: CQ_PUBLIC_JSON=<file with {url,key}: the public Supabase URL and publishable key> CQ_SEED_ACCOUNT_PASSWORD=… NODE_USE_ENV_PROXY=1
//   node scripts/handoff/live/journey.mjs <fictional email> scripts/handoff/live/journeys/investor1.json out.json
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const pub = JSON.parse(
  readFileSync(process.env.CQ_PUBLIC_JSON ?? "public.json", "utf8"),
);
const QAPI = "https://capital-qq-api-production.up.railway.app";
const EMAIL = process.argv[2];
const ASKS = JSON.parse(readFileSync(process.argv[3], "utf8"));
const out = process.argv[4];
const s = await fetch(`${pub.url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: pub.key, "content-type": "application/json" },
  body: JSON.stringify({
    email: EMAIL,
    password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
  }),
});
const token = (await s.json()).access_token;
if (!token) {
  console.log("sign-in failed", s.status);
  process.exit(1);
}
const api = async (method, path, body) => {
  const r = await fetch(`${QAPI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {
    // Not JSON: the text is reported instead.
  }
  return { status: r.status, json: j, text: t.slice(0, 300) };
};
const ANSWERED = new Set(["COMPLETED", "AWAITING_INPUT", "AWAITING_APPROVAL"]);
let conv = null;
const log = [];
for (const ask of ASKS) {
  const t0 = Date.now();
  const c = await api("POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text: ask },
    modality: "TEXT",
    ...(conv ? { conversationId: conv } : {}),
  });
  const runId = c.json?.runId;
  if (!runId) {
    log.push({ ask, error: `${c.status} ${c.text}` });
    continue;
  }
  let run;
  for (;;) {
    run = (await api("GET", `/v1/q/runs/${runId}`)).json ?? {};
    const qs = (run.messages ?? []).filter((m) => m.role === "Q");
    if (
      (ANSWERED.has(run.status) && qs.length > 0) ||
      ["FAILED", "CANCELLED", "EXPIRED"].includes(run.status)
    )
      break;
    if (Date.now() - t0 > 90000) {
      run.status = "TIMED_OUT";
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  conv = c.json?.conversationId ?? run.conversationId ?? conv;
  const q = (run.messages ?? []).filter((m) => m.role === "Q").at(-1) ?? {};
  const blocks = (q.resultBlocks ?? q.result_blocks ?? q.blocks ?? []).map(
    (b) =>
      (b.kind ?? b.type) +
      (b.items
        ? `(${b.items.length})`
        : b.rows
          ? `(${b.rows.length} rows)`
          : ""),
  );
  const entry = {
    ask,
    ms: Date.now() - t0,
    status: run.status,
    reply: q.text ?? q.content ?? "",
    blocks,
    approvals: run.pendingApproval ? "APPROVAL" : undefined,
    keys: Object.keys(q),
  };
  log.push(entry);
  console.log(
    `\n### ${ask}\n[${entry.ms} ms, ${run.status}] blocks: ${blocks.join(",") || "-"}\n${entry.reply}`,
  );
}
writeFileSync(out, JSON.stringify(log, null, 2));
