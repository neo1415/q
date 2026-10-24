import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import { APP_ACTIONS, type AppActionPorts } from "../src/index.js";

/**
 * follow-55 (Zino live 2026-10-04, run c8b23349): "I want to edit my
 * profile to make sure that I invest in pre-seed to Series A. Can you save
 * that for me?" was refused as REQUIRED_INPUT_NOT_SAID: change_my_mandate
 * required an `operation` nobody says, and its stage inputs named no
 * codes. A change to fields is an UPDATE; stages are the taxonomy's codes.
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
  idempotencyKey: "q:1",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "Q" as const,
};
const ORG = "f0000000-0000-4000-8000-000000000001";
const MANDATE = "a1000000-0000-4000-8000-000000000001";

const family = APP_ACTIONS.find(
  (candidate) => candidate.tool?.name === "change_my_mandate",
);

const ports = {
  ownInvestorOrganisationId: () => Promise.resolve(ORG),
  investors: {
    listInvestorMandates: () =>
      Promise.resolve({
        items: [{ id: MANDATE, status: "ACTIVE", version: 22 }],
      }),
  },
} as unknown as AppActionPorts;

describe("change_my_mandate from their words (follow-55)", () => {
  it("takes a stage change with no operation said, as an UPDATE of the current mandate", async () => {
    const tool = family?.tool;
    expect(tool).toBeDefined();
    if (tool === undefined) return;
    const said = tool.input.safeParse({
      minStageCode: "pre_seed",
      maxStageCode: "series_a",
    });
    expect(said.success).toBe(true);
    if (!said.success) return;
    const canonical = await tool.toCanonical(said.data, context, ports);
    expect(canonical).toMatchObject({
      operation: "UPDATE",
      input: {
        investorOrganisationId: ORG,
        mandateId: MANDATE,
        input: {
          minStageCode: "pre_seed",
          maxStageCode: "series_a",
          expectedVersion: 22,
        },
        atLatest: true,
      },
    });
  });

  it("refuses an empty update by naming the tool that owns profile answers (live 2026-10-14)", async () => {
    const tool = family?.tool;
    expect(tool).toBeDefined();
    if (tool === undefined) return;
    const said = tool.input.safeParse({});
    expect(said.success).toBe(true);
    if (!said.success) return;
    const canonical = await tool.toCanonical(said.data, context, ports);
    expect(canonical).toHaveProperty("refused");
    expect(JSON.stringify(canonical)).toContain(
      "propose_profile_answer_change",
    );
  });

  it("names the stage codes, and refuses words where a code belongs", () => {
    const tool = family?.tool;
    if (tool === undefined) throw new Error("change_my_mandate missing");
    const shape = (
      tool.input as unknown as {
        shape: Record<string, { description?: string }>;
      }
    ).shape;
    expect(shape["minStageCode"]?.description).toContain(
      "pre_seed, seed, series_a",
    );
    expect(shape["operation"]?.description).toContain("the default");
    expect(
      tool.input.safeParse({
        minStageCode: "Pre-seed",
        maxStageCode: "Series A",
      }).success,
    ).toBe(false);
    expect(tool.description).toContain("maxStageCode");
  });
});

describe("the mandate change card shows each field before and after (F-29)", () => {
  const LONG =
    "We back pre-seed and seed founders building infrastructure for African trade: payments, logistics and credit, with a strong preference for teams that have shipped before and sell to businesses rather than consumers.";
  const withMandate = {
    ownInvestorOrganisationId: () => Promise.resolve(ORG),
    investors: {
      listInvestorMandates: () =>
        Promise.resolve({
          items: [{ id: MANDATE, status: "ACTIVE", version: 22 }],
        }),
      getInvestorMandate: () =>
        Promise.resolve({
          id: MANDATE,
          name: "Africa trade",
          discoveryMode: null,
          minCheque: "100000",
          maxCheque: "500000",
          currencyCode: "USD",
          minStageCode: "seed",
          maxStageCode: "series_a",
          rawMandateText: "Seed fintech in West Africa.",
          constraints: [],
          version: 22,
        }),
    },
  } as unknown as AppActionPorts;

  async function cardFor(
    said: Record<string, unknown>,
    from: AppActionPorts = withMandate,
  ) {
    const action = family;
    const tool = action?.tool;
    if (action === undefined || tool === undefined) {
      throw new Error("change_my_mandate missing");
    }
    const canonical: unknown = await tool.toCanonical(
      tool.input.parse(said),
      context,
      from,
    );
    if (
      typeof canonical !== "object" ||
      canonical === null ||
      "refused" in canonical
    ) {
      throw new Error("no card");
    }
    return action.card(canonical);
  }

  it("one line per changed field, before → after, in words, nothing unchanged listed", async () => {
    const card = await cardFor({
      minStageCode: "pre_seed",
      chequeRange: { currency: "USD", min: "50000", max: "500000" },
    });
    expect(card.summary).toBe("Update your mandate");
    expect(card.preview.split("\n")).toEqual([
      "Earliest stage: Seed → Pre-seed",
      "Cheque: USD from 100,000, up to 500,000 → USD from 50,000, up to 500,000",
    ]);
  });

  it("their own words in full, never cut, with what they replace", async () => {
    const card = await cardFor({ rawMandateText: LONG });
    expect(card.preview).toBe(
      `In your words: Seed fintech in West Africa. → ${LONG}`,
    );
    expect(card.preview).not.toContain("...");
  });

  it("a value that is already so says no change beside one that changes; without a readable mandate, the new values alone", async () => {
    // F-93: a change of nothing at all is refused (below), never a card.
    expect(
      (await cardFor({ minStageCode: "pre_seed", maxStageCode: "series_a" }))
        .preview,
    ).toBe(
      "Earliest stage: Seed → Pre-seed\nLatest stage: Series A (no change)",
    );
    expect((await cardFor({ minStageCode: "pre_seed" }, ports)).preview).toBe(
      "Earliest stage: Pre-seed",
    );
  });
});

// QA F-93 (24 Oct 2026): "Change my mandate to also include Ghana." became
// a card of the mandate's own unchanged words, "(no change)". A change
// that changes nothing is refused, naming the tool that owns geographies.
describe("change_my_mandate never prepares a change that changes nothing", () => {
  const WORDS =
    "A USD 40m fictional seed fund leading rounds for African fintech.";
  const reading = {
    ...ports,
    investors: {
      ...(ports as unknown as { investors: object }).investors,
      getInvestorMandate: () =>
        Promise.resolve({
          id: MANDATE,
          name: "Fund I",
          discoveryMode: null,
          minCheque: "100000",
          maxCheque: "500000",
          currencyCode: "USD",
          minStageCode: "seed",
          maxStageCode: "seed",
          rawMandateText: WORDS,
          constraints: [],
          version: 23,
        }),
    },
  } as unknown as AppActionPorts;

  it("refuses the same words, pointing to propose_profile_answer_change", async () => {
    const tool = family?.tool;
    if (tool === undefined) throw new Error("no tool");
    const said = tool.input.safeParse({ rawMandateText: WORDS });
    if (!said.success) throw new Error("not parsed");
    const canonical = await tool.toCanonical(said.data, context, reading);
    expect(canonical).toHaveProperty("refused");
    expect(JSON.stringify(canonical)).toContain(
      "propose_profile_answer_change",
    );
  });

  it("still prepares a real change", async () => {
    const tool = family?.tool;
    if (tool === undefined) throw new Error("no tool");
    const said = tool.input.safeParse({ maxStageCode: "series_a" });
    if (!said.success) throw new Error("not parsed");
    const canonical = await tool.toCanonical(said.data, context, reading);
    expect(canonical).toMatchObject({ operation: "UPDATE" });
  });
});
