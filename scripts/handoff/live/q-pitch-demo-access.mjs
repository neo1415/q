// Q Pitch precondition (owner decision 15 Oct): the tour's investor
// (investor.savanna-seed, fictional) can open the data room and deck of each
// named tour company. Uses ONLY the product's own endpoints, as the people
// who own each step: the investor expresses interest (server-confirmed), the
// company's founder accepts it. Never a database write.
//
// Re-runnable: each step is skipped when its state is already reached.
// Paced: at least 2 s between requests; any 5xx backs off 5 minutes.
//
//   CQ_SB_URL=… CQ_SB_PUBLISHABLE=… CQ_SEED_ACCOUNT_PASSWORD=… \
//     node scripts/handoff/live/q-pitch-demo-access.mjs [--dry-run]
//
// Prints identifiers and states only, never a token or document content.
import { randomUUID } from "node:crypto";

import { API, signIn } from "./fictional-session.mjs";

const INVESTOR = "investor.savanna-seed@fictional.capitalq.local";
/** Keep in step with DEMO_COMPANIES (packages/q-pitch/src/demo-companies.ts). */
const COMPANIES = [
  {
    key: "harbourline-cargo",
    companyId: "ceb6ec2d-4a4a-41a2-9b71-377d72c26407",
    founder: "babatunde.tunde-cargo@fictional.capitalq.local",
  },
  {
    key: "clinicrest",
    companyId: "6b2f9851-d7e3-4197-9fd1-beffbdc153fe",
    founder: "founder.clinicrest@fictional.capitalq.local",
  },
];
const DRY = process.argv.includes("--dry-run");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let last = 0;
async function call(token, method, path, body) {
  for (;;) {
    const wait = last + 2_000 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const response = await fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "idempotency-key": `qpitch-access:${randomUUID()}`,
            }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status >= 500) {
      console.log(`${method} ${path} -> ${response.status}; backing off 5 min`);
      await sleep(300_000);
      continue;
    }
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  }
}

const investor = (await signIn(INVESTOR)).accessToken;
const report = [];
for (const company of COMPANIES) {
  const roomPath = `/v1/companies/${company.companyId}/data-room`;
  let room = await call(investor, "GET", roomPath);
  const before = room.json?.access ?? null;
  const steps = [];
  if (before !== "CONNECTED") {
    const interest = await call(
      investor,
      "GET",
      `/v1/network/companies/${company.companyId}/interest`,
    );
    if (interest.json?.interest == null) {
      if (DRY) steps.push("would express interest");
      else {
        const expressed = await call(
          investor,
          "POST",
          `/v1/network/companies/${company.companyId}/express-interest`,
          { surface: "COMPANY_PROFILE" },
        );
        steps.push(`express-interest ${String(expressed.status)}`);
      }
    } else steps.push(`interest already ${interest.json.interest.status}`);
    const founder = (await signIn(company.founder)).accessToken;
    const incoming = await call(
      founder,
      "GET",
      `/v1/network/companies/${company.companyId}/incoming-interest`,
    );
    const pending = (incoming.json?.items ?? []).filter(
      (item) =>
        item.response === "PENDING" && /savanna seed/iu.test(item.investorName),
    );
    for (const item of pending) {
      if (DRY) steps.push(`would accept ${item.interestId}`);
      else {
        const accepted = await call(
          founder,
          "POST",
          `/v1/network/interests/${item.interestId}/accept`,
          {},
        );
        steps.push(`founder accept ${String(accepted.status)}`);
      }
    }
    room = await call(investor, "GET", roomPath);
  }
  const deck = await call(
    investor,
    "GET",
    `/v1/companies/${company.companyId}/deck/open`,
  );
  report.push({
    key: company.key,
    accessBefore: before,
    steps,
    accessAfter: room.json?.access ?? null,
    lockedReason: room.json?.locked?.reason ?? null,
    documentsListed: room.json?.documents?.length ?? 0,
    deckOpen: deck.status,
  });
}
console.log(JSON.stringify(report, null, 2));
