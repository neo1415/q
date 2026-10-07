/* global console, fetch, process, setTimeout */
// Zino's standing instruction with scoped delegation ON, through the real
// app path (founder 2026-10-07: "add the stuff for me, the instructions to
// my account... the agents don't need approval for everything").
//
// Run AFTER the deploy that carries migration 20261217090000 and the
// delegation switch. The lead runs it; never against production by an
// agent on its own.
//
//   NODE_USE_ENV_PROXY=1 \
//   EMAIL=<Zino's login email> CQ_ACCOUNT_PASSWORD=<his password> \
//   SB_URL=https://<ref>.supabase.co SB_PUBLISHABLE=<publishable key> \
//   [QAPI=https://capital-qq-api-production.up.railway.app] \
//   [API=https://capital-qapi-production.up.railway.app] \
//   node scripts/seed/zino-delegation.mjs [--approve]
//
// What it does, as Zino, over the public APIs only (no SQL):
//   1. signs in (the password and token stay in this process's memory;
//      neither is printed or written anywhere);
//   2. if a live instruction with this exact goal already exists, reuses it;
//      otherwise asks Q (POST /v1/q/runs) to set it up, which prepares the
//      `q.instruction.grant` card, prints the card's words and, only with
//      --approve, approves exactly that card (POST .../approve);
//   3. switches the delegation ON for it (POST /v1/q/work/:id/delegation,
//      the person's own switch, audited);
//   4. prints the instruction id and what Work now says.
// Without --approve it stops after printing the card: nothing is approved.

import { randomUUID } from "node:crypto";

const GOAL =
  "Reply to founders who accept or write to me, follow up when they go quiet, and propose meetings in my working hours; ask me first for anything about money, terms or commitments";
const QAPI =
  process.env.QAPI ?? "https://capital-qq-api-production.up.railway.app";
const API = process.env.API ?? "https://capital-qapi-production.up.railway.app";
const APPROVE = process.argv.includes("--approve");

const need = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};

const signIn = await fetch(
  `${need("SB_URL")}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: {
      apikey: need("SB_PUBLISHABLE"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: need("EMAIL"),
      password: need("CQ_ACCOUNT_PASSWORD"),
    }),
  },
);
if (!signIn.ok) {
  console.error(`sign-in failed: HTTP ${String(signIn.status)}`);
  process.exit(1);
}
const { access_token: token } = await signIn.json();

async function call(origin, method, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Problem details are JSON; anything else is reported as text.
  }
  return { status: response.status, json, text: text.slice(0, 300) };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const same = (a, b) =>
  String(a ?? "")
    .trim()
    .toLowerCase() === b.trim().toLowerCase();

async function liveInstruction() {
  const work = await call(QAPI, "GET", "/v1/q/work");
  if (work.status !== 200) {
    console.error(`could not read Work: HTTP ${String(work.status)}`);
    process.exit(1);
  }
  return (work.json?.items ?? []).find(
    (item) =>
      item.kind === "STANDING_INSTRUCTION" &&
      item.status === "ACTIVE" &&
      same(item.goal, GOAL.slice(0, 300)),
  );
}

let instruction = await liveInstruction();
if (instruction === undefined) {
  const started = await call(QAPI, "POST", "/v1/q/runs", {
    capability: "ANSWER",
    modality: "TEXT",
    message: {
      text: `Please set this up as a standing instruction for me: "${GOAL}". Routine replies don't need my approval each time.`,
    },
  });
  if (![200, 201, 202].includes(started.status)) {
    console.error(`Q refused the request: HTTP ${String(started.status)}`);
    process.exit(1);
  }
  const runId = started.json?.runId;
  let card;
  for (let attempt = 0; attempt < 90 && card === undefined; attempt += 1) {
    await sleep(2_000);
    const pending = await call(QAPI, "GET", "/v1/q/approvals");
    for (const item of pending.json?.items ?? []) {
      if (item.runId !== runId) continue;
      const view = await call(
        QAPI,
        "GET",
        `/v1/q/approvals/${item.approvalId}`,
      );
      if (view.json?.action?.actionType === "q.instruction.grant") {
        card = view.json;
      }
    }
  }
  if (card === undefined) {
    console.error(
      "Q did not prepare the instruction card; ask it in Home and approve it there, then run this again to switch delegation on.",
    );
    process.exit(1);
  }
  console.log(`Card: ${card.action.summary}`);
  if (card.action.preview !== undefined) console.log(card.action.preview);
  if (!APPROVE) {
    console.log(
      "Not approved (run with --approve to approve exactly this card).",
    );
    process.exit(0);
  }
  const approved = await call(
    QAPI,
    "POST",
    `/v1/q/approvals/${card.approvalId}/approve`,
    {},
  );
  if (approved.status >= 300) {
    console.error(`approval refused: HTTP ${String(approved.status)}`);
    process.exit(1);
  }
  for (
    let attempt = 0;
    attempt < 30 && instruction === undefined;
    attempt += 1
  ) {
    await sleep(2_000);
    instruction = await liveInstruction();
  }
  if (instruction === undefined) {
    console.error("the approved instruction did not appear on Work yet");
    process.exit(1);
  }
}

if (instruction.delegation?.enabled === true) {
  console.log(`Instruction ${instruction.id}: delegation already on.`);
} else {
  const switched = await call(
    API,
    "POST",
    `/v1/q/work/${instruction.id}/delegation`,
    { enabled: true },
  );
  if (switched.status >= 300) {
    console.error(
      `delegation not switched on: HTTP ${String(switched.status)} ${switched.text}`,
    );
    process.exit(1);
  }
  console.log(`Instruction ${instruction.id}: delegation switched on.`);
}
const after = await liveInstruction();
console.log(
  `Work says: ${after?.delegation?.words ?? "?"} -- ${after?.delegation?.enabled === true ? "On" : "Off"}`,
);
