import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import type { LedgerCommitment } from "@capital-q/network";
import { ActorContextSchema } from "@capital-q/security";

import { APP_ACTIONS, readOwn, type AppActionPorts } from "../src/index.js";

/**
 * Founder direction 2026-10-04: "Open a seed round for $1.5M", "I've
 * received Zino's money" and "how much have I raised" work from anywhere,
 * through the declared actions and read_my -- and the money's steps keep
 * their order: both sides confirm the amount before anything is received.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const context = {
  actor,
  idempotencyKey: "q:run-1:step",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "Q" as const,
};
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";
const ROUND = "99999999-0000-4000-8000-000000000001";

const commitment = (
  id: string,
  amount: string,
  status: LedgerCommitment["status"],
  next: LedgerCommitment["next"],
): LedgerCommitment => ({
  id,
  relationshipId: RELATIONSHIP,
  counterpartId: "11111111-0000-4000-8000-000000000001",
  counterpartName: "Ada Capital (fictional)",
  amount,
  currencyCode: "USD",
  level: "FIRM",
  status,
  source: "Q_MEETING",
  quote: null,
  roundId: null,
  statedByYourSide: false,
  transferReference: null,
  at: "2026-10-04T10:00:00.000Z",
  next,
});

function portsWith(commitments: readonly LedgerCommitment[]): AppActionPorts {
  return {
    ownCompanyId: () => Promise.resolve(COMPANY),
    capital: {
      getCurrentCapitalObjective: () =>
        Promise.resolve({ instrumentCode: "safe" }),
    },
    capitalRounds: {
      listRounds: () =>
        Promise.resolve([
          {
            id: ROUND,
            name: "Seed",
            target: { amount: "1500000", currency: "USD" },
            instrument: "SAFE",
            status: "OPEN",
            isCurrent: true,
            openedOn: "2026-10-01",
            closedOn: null,
            createdAt: "2026-10-01T09:00:00.000Z",
          },
        ]),
    },
    commitments: {
      ledger: () =>
        Promise.resolve({
          side: "COMPANY",
          commitments,
          sums: [
            {
              roundId: ROUND,
              currencyCode: "USD",
              received: "250000",
              confirmed: "100000.50",
              pledged: "0",
            },
            {
              roundId: null,
              currencyCode: "USD",
              received: "50000",
              confirmed: "0",
              pledged: "0",
            },
          ],
        }),
    },
  } as unknown as AppActionPorts;
}

const toolNamed = (name: string) => {
  const tool = APP_ACTIONS.find((action) => action.tool?.name === name)?.tool;
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool;
};

describe("commitment_step from their words", () => {
  const step = toolNamed("commitment_step");

  it("refuses receipt until both sides confirmed the amount, saying why", async () => {
    const ports = portsWith([
      commitment(
        "c1000000-0000-4000-8000-000000000001",
        "1000000",
        "DETECTED",
        "CONFIRM_AMOUNT",
      ),
      commitment(
        "c1000000-0000-4000-8000-000000000002",
        "500000",
        "DETECTED",
        "CONFIRM_AMOUNT",
      ),
    ]);
    const said = step.input.parse({
      operation: "CONFIRM_RECEIVED",
      relationship: RELATIONSHIP,
    });
    expect(await step.toCanonical(said, context, ports)).toEqual({
      refused:
        "Not yet: USD 1,000,000 with Ada Capital (fictional) needs the amount confirmed by both sides first.",
    });
  });

  it("asks which one when two amounts wait, and takes the one named", async () => {
    const ports = portsWith([
      commitment(
        "c1000000-0000-4000-8000-000000000001",
        "1000000",
        "DETECTED",
        "CONFIRM_AMOUNT",
      ),
      commitment(
        "c1000000-0000-4000-8000-000000000002",
        "500000",
        "DETECTED",
        "CONFIRM_AMOUNT",
      ),
    ]);
    const vague = step.input.parse({
      operation: "CONFIRM_AMOUNT",
      relationship: RELATIONSHIP,
    });
    expect(await step.toCanonical(vague, context, ports)).toEqual({
      refused:
        "Ada Capital (fictional) has an amount to confirm more than once: USD 1,000,000 or USD 500,000. Which one?",
    });
    const named = step.input.parse({
      operation: "CONFIRM_AMOUNT",
      relationship: RELATIONSHIP,
      amount: "1,000,000.00",
    });
    expect(await step.toCanonical(named, context, ports)).toEqual({
      operation: "CONFIRM_AMOUNT",
      input: {
        commitmentId: "c1000000-0000-4000-8000-000000000001",
        idempotencyKey: "q:run-1:step",
        input: {},
        shown: "USD 1,000,000",
        relationshipId: RELATIONSHIP,
      },
    });
  });

  it("prepares a receipt as a money card a person approves", async () => {
    const ports = portsWith([
      commitment(
        "c1000000-0000-4000-8000-000000000003",
        "1000000",
        "TRANSFER_SENT",
        "CONFIRM_RECEIVED",
      ),
    ]);
    const said = step.input.parse({
      operation: "CONFIRM_RECEIVED",
      relationship: RELATIONSHIP,
    });
    const canonical = await step.toCanonical(said, context, ports);
    expect(canonical).toMatchObject({ operation: "CONFIRM_RECEIVED" });
    const family = APP_ACTIONS.find(
      (action) => action.name === "capital.commitment.step",
    );
    expect(family?.classification).toBe("CONSEQUENTIAL");
    expect(family?.consequence).toBe("MONEY");
    expect(
      family?.card(canonical, { counterpart: "Ada Capital (fictional)" }),
    ).toEqual({
      summary:
        "Confirm you received USD 1,000,000 from Ada Capital (fictional)",
      preview: "It counts as raised in its round.",
    });
  });
});

describe("change_my_raise opens a round", () => {
  const raise = toolNamed("change_my_raise");

  it('"Open a seed round for $1.5M": the name from the stage, the instrument from the raise', async () => {
    const said = raise.input.parse({
      operation: "OPEN_ROUND",
      targetStage: "seed",
      target: { amount: "1500000", currency: "USD" },
    });
    const canonical = await raise.toCanonical(said, context, portsWith([]));
    expect(canonical).toEqual({
      operation: "OPEN_ROUND",
      input: {
        companyId: COMPANY,
        idempotencyKey: "q:run-1:step",
        input: {
          name: "Seed",
          target: { amount: "1500000", currency: "USD" },
          instrument: "SAFE",
        },
      },
    });
    const family = APP_ACTIONS.find(
      (action) => action.name === "capital.objective.change",
    );
    expect(family?.card(canonical)).toEqual({
      summary: "Open a Seed round",
      preview: "Target USD 1,500,000 · SAFE · Becomes your current round",
    });
  });

  it("asks for a target rather than guessing one", async () => {
    const said = raise.input.parse({
      operation: "OPEN_ROUND",
      roundName: "Seed",
    });
    expect(await raise.toCanonical(said, context, portsWith([]))).toEqual({
      refused: "What's the round's target, and in which currency?",
    });
  });
});

describe('read_my("capital"): "how much have I raised"', () => {
  it("reads the rounds with received money as raised, and the all-time total exactly", async () => {
    const items = await readOwn(
      portsWith([
        commitment(
          "c1000000-0000-4000-8000-000000000001",
          "1000000",
          "DETECTED",
          "CONFIRM_AMOUNT",
        ),
      ]),
      actor,
      "capital",
    );
    expect(items?.[0]).toMatchObject({
      title: "Seed round",
      status: "current, open",
      facts: {
        target: "USD 1,500,000",
        raised: "USD 250,000",
        confirmed: "USD 100,000.50",
      },
    });
    expect(items?.[1]).toMatchObject({
      title: "Total raised in USD, all rounds",
      facts: { raised: "USD 300,000", confirmed: "USD 100,000.50" },
    });
    expect(items?.[2]).toMatchObject({
      title: "Ada Capital (fictional): USD 1,000,000",
      facts: { yourNextStep: "confirm the amount", heardInCall: true },
    });
  });
});
