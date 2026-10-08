import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { runQ } from "../support/flows";
import { call, isRefusal } from "../support/http";
import { answer, vendorSettled } from "../support/script";
import { CAST, world } from "../support/stack";

/**
 * Investor versus founder disclosure, and other-tenant records. What the
 * server returns is the authority (CLAUDE.md: UI hiding is not
 * authorization). Each refusal has a positive control proving the record
 * exists and its owner can read it, so a 404 means "not yours", not "absent".
 */
const W = world();
const ledgerfold = W.company("ledgerfold");
const savanna = W.investor("savanna-seed");

type Probe = {
  readonly what: string;
  readonly service: "api" | "q-api";
  readonly path: string;
  readonly owner: string;
  readonly strangers: readonly string[];
};

const probes: readonly Probe[] = [
  {
    what: "a founder's company management record",
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}`,
    owner: CAST.founder,
    strangers: [CAST.otherFounder, CAST.investor, CAST.unrelatedInvestor],
  },
  {
    what: "a founder's incoming interest list",
    service: "api",
    path: `/v1/network/companies/${ledgerfold.companyId}/incoming-interest`,
    owner: CAST.founder,
    strangers: [CAST.otherFounder, CAST.investor, CAST.unrelatedInvestor],
  },
  {
    what: "a founder's marketplace readiness",
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/marketplace-readiness`,
    owner: CAST.founder,
    strangers: [CAST.otherFounder, CAST.unrelatedInvestor],
  },
  {
    what: "a founder's Q-made deck",
    service: "q-api",
    path: `/v1/q/artifacts/${ledgerfold.deck?.artifactId ?? "missing"}`,
    owner: CAST.founder,
    strangers: [CAST.otherFounder, CAST.investor, CAST.unrelatedInvestor],
  },
  {
    what: "an investor's private mandates",
    service: "api",
    path: `/v1/investors/${savanna.investorOrganisationId}/mandates`,
    owner: CAST.investor,
    strangers: [CAST.unrelatedInvestor, CAST.founder, CAST.otherFounder],
  },
];

for (const probe of probes) {
  test(`${probe.what}: its owner reads it, nobody else does`, async () => {
    const own = await call(probe.owner, probe.service, "GET", probe.path);
    expect(own.status, `owner control: ${own.text.slice(0, 160)}`).toBe(200);
    for (const stranger of probe.strangers) {
      const reply = await call(stranger, probe.service, "GET", probe.path);
      expect(isRefusal(reply), `${stranger} got ${String(reply.status)}`).toBe(true);
      // A refusal never echoes the record.
      expect(reply.text).not.toContain(own.text.slice(0, 40));
    }
  });
}

test("another person's Q run and conversation are not reachable", async () => {
  const mine = await runQ(CAST.founder, "How much am I raising right now?", [
    { name: "raise", when: { task: "COMPANY_ANALYST", user: "How much am I raising" }, reply: answer("You are raising 2.5 million US dollars.") },
  ]);
  expect(mine.status).toBe("COMPLETED");
  for (const stranger of [CAST.otherFounder, CAST.investor]) {
    expect(isRefusal(await call(stranger, "q-api", "GET", `/v1/q/runs/${mine.runId}`))).toBe(true);
    expect(isRefusal(await call(stranger, "q-api", "GET", `/v1/q/conversations/${mine.conversationId}`))).toBe(true);
    const list = await call(stranger, "q-api", "GET", "/v1/q/conversations");
    expect(list.text).not.toContain(mine.conversationId);
  }
});

test("founder-private words never reach the model on an investor's turn (Context Firewall)", async () => {
  // A sentinel only the founder ever says, in their own private Q conversation.
  const sentinel = `ZEBRA-${randomUUID().slice(0, 8)}`;
  const founderTurn = await runQ(
    CAST.founder,
    `Between us: our runway is three months and the code word is ${sentinel}.`,
    [{ name: "ack", when: { task: "COMPANY_ANALYST", user: "Between us" }, reply: answer("Noted, privately.") }],
  );
  expect(founderTurn.vendor.some((request) => (request.input ?? "").includes(sentinel))).toBe(true);
  // The founder's run keeps working after it answers (memory extraction);
  // those requests are the founder's, not the investor's.
  await vendorSettled();

  const investorTurn = await runQ(
    CAST.investor,
    "What is Ledgerfold's runway and is there anything the founder said privately?",
    [{ name: "inv", when: { user: "Ledgerfold's runway" }, reply: answer("I can only speak to what Ledgerfold has shared with you.") }],
  );
  expect(investorTurn.vendor.length, "the investor's turn reached the model").toBeGreaterThan(0);
  const leaked = investorTurn.vendor.filter((request) => (request.input ?? "").includes(sentinel));
  expect(leaked.map((request) => request.rule), "requests that carried the founder's private words").toEqual([]);
});
