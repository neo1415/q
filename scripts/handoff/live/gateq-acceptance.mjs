// Live GateQ founder-to-investor acceptance on FICTIONAL accounts only.
//
// A signed-in fictional founder applies through a fictional investor's
// published gateway: account-confirmed contact → form answers → Q opens the
// interview → a few real turns (each timed) → coverage → explicit Submit.
// Then the investor's inbox must hold exactly that one application with its
// frozen dossier and transcript, and a second fictional investor must get a
// 404 for it (cross-tenant negative).
//
// Env: CQ_SEED_ACCOUNT_PASSWORD, CQ_SB_URL + CQ_SB_PUBLISHABLE (or
// CQ_PUBLIC_JSON), NODE_USE_ENV_PROXY=1 in the cloud sandbox. Optional
// CQ_GATEQ_FOUNDER, CQ_GATEQ_INVESTOR, CQ_GATEQ_OTHER_INVESTOR,
// CQ_GATEQ_PUBLIC_ID. Each run creates one application and a few model
// turns (small, bounded cost); it sends no email and approves nothing.
// Prints timings and ids only — never a token or the founder's answers.
import { randomUUID } from "node:crypto";

import {
  applicationTurn,
  getApplicationCoverage,
  getCurrentInvestorOrganisation,
  getGateqInbox,
  getGateqInboxItem,
  getPublicGateway,
  listGateways,
  openApplicationInterview,
  saveAccountApplicationContact,
  saveApplicationAnswers,
  startApplication,
  submitApplication,
} from "../../../packages/api-client/dist/index.js";
import { API, signIn } from "./fictional-session.mjs";

const FOUNDER =
  process.env.CQ_GATEQ_FOUNDER ?? "founder.maji-loop@fictional.capitalq.local";
const INVESTOR =
  process.env.CQ_GATEQ_INVESTOR ??
  "investor.savanna-seed@fictional.capitalq.local";
const OTHER =
  process.env.CQ_GATEQ_OTHER_INVESTOR ??
  "investor.rift-valley-seed@fictional.capitalq.local";

const TURNS = [
  "We sell water-quality sensors to municipal utilities in Kenya; utilities pay a yearly subscription per site.",
  "We have 14 paying sites and about USD 9,000 in monthly recurring revenue, growing roughly 12% a month.",
  "We are raising USD 750,000 on a SAFE, mostly for hardware inventory and two field engineers.",
];

const timed = async (label, fn) => {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - start);
  console.log(`${label}: ${ms} ms`);
  return { value, ms };
};

const expectStatus = async (label, fn, status) => {
  try {
    await fn();
  } catch (error) {
    const got = error?.status ?? error?.problem?.status;
    if (got === status) {
      console.log(`${label}: ${status} as expected`);
      return;
    }
    throw new Error(`${label}: expected ${status}, got ${got ?? error}`, {
      cause: error,
    });
  }
  throw new Error(`${label}: expected ${status}, got success`);
};

const investor = await signIn(INVESTOR, API);
const organisation = await getCurrentInvestorOrganisation(investor);
const gateways = await listGateways(investor, organisation.id);
const gateway = gateways.gateways.find(
  (g) =>
    g.status === "ACTIVE" &&
    (process.env.CQ_GATEQ_PUBLIC_ID === undefined ||
      g.publicId === process.env.CQ_GATEQ_PUBLIC_ID),
);
if (gateway === undefined) throw new Error("no ACTIVE gateway to apply to");
await getPublicGateway(API, gateway.publicId); // published, publicly readable
console.log(`gateway ${gateway.id} (/g/${gateway.publicId})`);

const founder = await signIn(FOUNDER, API);
const started = await timed("start", () =>
  startApplication(API, gateway.publicId, "form"),
);
const token = started.value.sessionToken;

const contact = await timed("contact (account)", () =>
  saveAccountApplicationContact(founder, {
    sessionToken: token,
    name: "Maji Loop Founder",
    email: FOUNDER,
    role: "CEO",
    companyName: "Maji Loop",
  }),
);
if (contact.value.contact.emailConfirmed !== true)
  throw new Error("account contact was not confirmed by the server");

await timed("answers", () =>
  saveApplicationAnswers(API, token, {
    companyName: "Maji Loop",
    oneLiner: "Water-quality sensors sold to utilities as a subscription",
    country: "KE",
    raise: { amount: "750000", currency: "USD" },
  }),
);

const opened = await timed("interview open (Q's first question)", () =>
  openApplicationInterview(API, token),
);
if (opened.value.turns.length === 0 || opened.value.turns[0].role !== "Q")
  throw new Error("interview did not open with Q's question");
const reopened = await timed("interview reopen (no model call)", () =>
  openApplicationInterview(API, token),
);
if (reopened.value.turns.length !== opened.value.turns.length)
  throw new Error("reopening the interview changed the transcript");

const turnMs = [];
for (const [index, message] of TURNS.entries()) {
  const clientTurnId = randomUUID();
  const turn = await timed(`turn ${index + 1}`, () =>
    applicationTurn(API, token, { message, clientTurnId }),
  );
  turnMs.push(turn.ms);
  if (index === 0) {
    const retry = await applicationTurn(API, token, { message, clientTurnId });
    if (retry.deduplicated !== true)
      throw new Error("a retried turn was not deduplicated");
    console.log("turn 1 retry: deduplicated");
  }
}

const coverage = await timed("coverage", () =>
  getApplicationCoverage(API, token),
);
console.log(`coverage keys: ${Object.keys(coverage.value).join(", ")}`);

const requestId = randomUUID();
const submitted = await timed("submit", () =>
  submitApplication(API, token, requestId),
);
const again = await submitApplication(API, token, requestId);
if (again.deduplicated !== true)
  throw new Error("a retried submit was not deduplicated");
const reference = submitted.value.application.reference;
console.log(`submitted ${reference}; retry deduplicated`);

const inbox = await getGateqInbox(investor, gateway.id, "INBOX");
const matches = inbox.items.filter((i) => i.reference === reference);
if (matches.length !== 1)
  throw new Error(`inbox holds ${matches.length} copies, expected 1`);
const applicationId = matches[0].applicationId;
const detail = await getGateqInboxItem(investor, gateway.id, applicationId);
if (detail.dossier == null) throw new Error("dossier missing from inbox item");
if (!Array.isArray(detail.transcript) || detail.transcript.length === 0)
  throw new Error("transcript missing from inbox item");
console.log(
  `inbox: 1 item, dossier ${detail.dossier.schemaVersion ?? "present"}, transcript ${detail.transcript.length} turns`,
);

const other = await signIn(OTHER, API);
await expectStatus(
  "other investor reads the item",
  () => getGateqInboxItem(other, gateway.id, applicationId),
  404,
);

const sorted = [...turnMs].sort((a, b) => a - b);
console.log(
  `interview turn latency ms: ${turnMs.join(", ")} (median ${sorted[Math.floor(sorted.length / 2)]})`,
);
console.log("GATEQ ACCEPTANCE PASS");
