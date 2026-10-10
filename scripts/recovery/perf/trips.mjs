#!/usr/bin/env node
/* global process, console, fetch */
/**
 * S2: database round trips per Q turn, per path, on the local stack.
 *
 *   node scripts/recovery/perf/trips.mjs <email> "<message>" [--repeat 2] [--sites]
 *
 * Signs in as a seeded person, sends one turn to q-api, waits for the run to
 * settle and prints the run's own "q orchestration returned" fields
 * (dbRoundTrips, dbRoundTripsByPhase, and the traced sites when
 * CQ_ROUND_TRIP_TRACE=1 is set on q-api). No provider is called: the model
 * is the loopback fake vendor.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const runDir =
  process.env.CQ_RECOVERY_RUN_DIR ?? resolve(root, ".playwright/recovery-stack");
const env = Object.fromEntries(
  readFileSync(resolve(runDir, "stack.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const argv = process.argv.slice(2);
let [email, text, ...rest] = argv;
let extraBody = {};
let rules = [];
if (argv[0] === "--scenario") {
  const scenarios = JSON.parse(
    readFileSync(resolve(root, "scripts/recovery/perf/trips-scenarios.json"), "utf8"),
  ).scenarios;
  const one = scenarios[argv[1]];
  if (one === undefined) throw new Error(`no scenario ${argv[1]}`);
  email = one.email;
  text = one.text;
  extraBody = one.body ?? {};
  rules = one.rules ?? [];
  rest = argv.slice(2);
}
const fakeUrl = `http://127.0.0.1:${env.OPENAI_BASE_URL.split(":")[2].split("/")[0]}`;
const baseline = JSON.parse(
  readFileSync(resolve(root, "tests/recovery/fixtures/q-script.json"), "utf8"),
).rules;
await fetch(`${fakeUrl}/__fake/script`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ rules: [...rules, ...baseline] }),
});
const at = rest.indexOf("--repeat");
const repeat = at === -1 ? 1 : Number(rest[at + 1]) || 1;
const verbose = rest.includes("--sites");
const qApi = env.CQ_Q_API_URL;

const signIn = await fetch(
  `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: env.CQ_SEED_ACCOUNT_PASSWORD }),
  },
);
const token = (await signIn.json()).access_token;
if (typeof token !== "string") throw new Error("sign-in refused");

let conversationId;
for (let i = 0; i < repeat; i += 1) {
  const created = await fetch(`${qApi}/v1/q/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": `s2-${randomUUID()}`,
    },
    body: JSON.stringify({
      capability: "ANSWER",
      message: { text },
      modality: "TEXT",
      ...extraBody,
      ...(conversationId === undefined ? {} : { conversationId }),
    }),
  });
  const body = await created.json();
  if (created.status !== 202 && created.status !== 200)
    throw new Error(`refused ${created.status} ${JSON.stringify(body).slice(0, 200)}`);
  conversationId = body.conversationId;
  let status = "";
  for (let n = 0; n < 240; n += 1) {
    const r = await (
      await fetch(`${qApi}/v1/q/runs/${body.runId}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();
    status = r.status;
    if (["COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"].includes(status)) break;
    await new Promise((r2) => setTimeout(r2, 250));
  }
  await new Promise((r2) => setTimeout(r2, 600));
  const log = readFileSync(resolve(runDir, "q-api.log"), "utf8").split("\n");
  const line = log
    .filter((l) => l.includes(body.runId) && l.includes("q orchestration returned"))
    .pop();
  const o = line === undefined ? {} : JSON.parse(line);
  console.log(
    JSON.stringify({
      run: body.runId,
      status,
      dbRoundTrips: o.dbRoundTrips,
      before: o.dbRoundTripsBeforeAnalysis,
      phases: o.dbRoundTripsByPhase,
    }),
  );
  if (verbose && o.dbRoundTripSites)
    console.log(JSON.stringify(o.dbRoundTripSites, null, 1));
}
