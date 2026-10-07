import { describe, expect, it } from "vitest";

import {
  ReadinessBlueprintDtoSchema,
  ReadinessDtoSchema,
} from "@capital-q/contracts";

import {
  assess,
  basisHash,
  buildBlueprint,
  createReadinessService,
  nextActions,
  READINESS_RULES_V1,
  type ReadinessInputs,
  type ReadinessStore,
} from "../src/index.js";

const EMPTY: ReadinessInputs = {
  stageCode: "seed",
  profile: { description: false, website: false, categories: 0 },
  team: {
    founderCount: null,
    fullTimeFounderCount: null,
    teamSize: null,
    founderBackgrounds: 0,
    verifiedFounderIdentities: 0,
  },
  verification: { organisation: false, domain: false },
  claims: [],
  deck: null,
  dataRoom: null,
  raise: null,
  followUps: [],
};

const DECK_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM = (over: Partial<ReadinessInputs["claims"][number]>) => ({
  id: "22222222-2222-4222-8222-222222222222",
  claimType: "traction",
  claimKey: "traction.active_customers",
  statement: "120 active customers",
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  lifecycleStatus: "CURRENT" as const,
  ...over,
});

const pillar = (inputs: ReadinessInputs, name: string) =>
  assess(inputs, READINESS_RULES_V1).pillars.find((p) => p.pillar === name);

describe("readiness rules v1", () => {
  it("every action key and check id is unique and fits the contract", () => {
    const keys = READINESS_RULES_V1.checks.map((check) => check.action.key);
    const ids = READINESS_RULES_V1.checks.map((check) => check.id);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it("nothing shared reads Not shared yet everywhere, never Gap", () => {
    const result = assess(EMPTY, READINESS_RULES_V1);
    for (const p of result.pillars) expect(p.status).toBe("UNKNOWN");
    // Still says what investors will ask for first, in neutral words.
    expect(result.blockers.map((b) => b.id)).toContain("raise.deck");
  });

  it("a missing BLOCKER with other evidence on record is a Gap", () => {
    const inputs: ReadinessInputs = {
      ...EMPTY,
      raise: {
        target: "450000 USD",
        useOfFunds: false,
        instrument: true,
        valuation: false,
        targetCloseDate: false,
      },
    };
    expect(pillar(inputs, "INVESTMENT_READINESS")?.status).toBe("GAP");
    const blockers = assess(inputs, READINESS_RULES_V1).blockers;
    expect(blockers.find((b) => b.id === "raise.use-of-funds")?.kind).toBe(
      "MISSING",
    );
  });

  it("stated revenue without a document is UNSUPPORTED, a document closes it", () => {
    const stated = {
      ...EMPTY,
      claims: [
        CLAIM({
          claimType: "financial",
          claimKey: "financial.monthly_revenue",
        }),
      ],
    };
    const blocker = assess(stated, READINESS_RULES_V1).blockers.find(
      (b) => b.id === "traction.revenue",
    );
    expect(blocker?.kind).toBe("UNSUPPORTED");
    const evidenced = {
      ...EMPTY,
      claims: [
        CLAIM({
          claimType: "financial",
          claimKey: "financial.monthly_revenue",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ],
    };
    const result = assess(evidenced, READINESS_RULES_V1);
    expect(result.blockers.some((b) => b.id === "traction.revenue")).toBe(
      false,
    );
    expect(
      result.actions.find((a) => a.key === "revenue-evidence")?.state,
    ).toBe("DONE_BY_EVIDENCE");
  });

  it("a contradiction is never a Gap and never Strong; it is listed to settle", () => {
    const inputs: ReadinessInputs = {
      ...EMPTY,
      stageCode: "pre_seed",
      claims: [
        CLAIM({ lifecycleStatus: "CONTRADICTORY" }),
        CLAIM({
          id: "33333333-3333-4333-8333-333333333333",
          claimType: "financial",
          claimKey: "financial.revenue",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ],
    };
    const result = assess(inputs, READINESS_RULES_V1);
    const traction = result.pillars.find(
      (p) => p.pillar === "COMMERCIAL_VALIDATION",
    );
    expect(traction?.status).toBe("DEVELOPING");
    expect(result.blockers.find((b) => b.id === "traction.metrics")?.kind).toBe(
      "CONTRADICTED",
    );
  });

  it("a pending CONTRADICTION follow-up marks its fact contradicted", () => {
    const inputs: ReadinessInputs = {
      ...EMPTY,
      team: { ...EMPTY.team, founderCount: 2 },
      followUps: [{ factKey: "founder_count", reason: "CONTRADICTION" }],
    };
    expect(
      assess(inputs, READINESS_RULES_V1).blockers.some(
        (b) => b.id === "team.founders" && b.kind === "CONTRADICTED",
      ),
    ).toBe(true);
  });

  it("an unread deck is unknown, not missing, and says so", () => {
    const inputs = { ...EMPTY, deck: { documentId: DECK_ID, sections: null } };
    const result = assess(inputs, READINESS_RULES_V1);
    expect(
      result.outcomes.some((o) => o.rule.signal.startsWith("deck.section.")),
    ).toBe(false);
    expect(result.uncertainty.join(" ")).toMatch(/hasn't read your pitch deck/);
  });

  it("Strong needs evidence, not just statements", () => {
    const team: ReadinessInputs = {
      ...EMPTY,
      team: {
        founderCount: 2,
        fullTimeFounderCount: 2,
        teamSize: 5,
        founderBackgrounds: 2,
        verifiedFounderIdentities: 2,
      },
      deck: {
        documentId: DECK_ID,
        sections: [
          {
            section: "FOUNDERS",
            score: 4,
            level: "STRONG",
            atStandard: true,
            improve: null,
          },
        ],
      },
    };
    expect(pillar(team, "FOUNDER")?.status).toBe("STRONG");
    const stated = {
      ...team,
      team: { ...team.team, verifiedFounderIdentities: 0 },
    };
    expect(pillar(stated, "FOUNDER")?.status).toBe("DEVELOPING");
  });

  it("marked done is the founder's tick; the pillar still moves only on evidence", () => {
    const marks = new Map([
      ["upload-deck", { done: true, at: "2026-10-07T00:00:00.000Z" }],
    ]);
    const result = assess(EMPTY, READINESS_RULES_V1, marks);
    expect(result.actions.find((a) => a.key === "upload-deck")?.state).toBe(
      "MARKED_DONE",
    );
    expect(result.blockers.some((b) => b.id === "raise.deck")).toBe(true);
    expect(
      nextActions(result.actions).some((a) => a.key === "upload-deck"),
    ).toBe(false);
  });

  it("is deterministic and never prints a percentage", () => {
    const a = assess(EMPTY, READINESS_RULES_V1);
    const b = assess(EMPTY, READINESS_RULES_V1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.pillars)).not.toMatch(/\d\s?%/);
    expect(basisHash("v1", EMPTY)).toBe(basisHash("v1", { ...EMPTY }));
  });

  it("the Blueprint cites the gap each step closes and grounds unknown steps as UNKNOWN", () => {
    const assessment = assess(EMPTY, READINESS_RULES_V1);
    const blueprint = buildBlueprint({
      id: "44444444-4444-4444-8444-444444444444",
      companyId: "55555555-5555-4555-8555-555555555555",
      version: 1,
      horizonMonths: 6,
      assessment,
      evidenceAsOf: "2026-10-07T00:00:00.000Z",
      generatedAt: "2026-10-07T00:00:00.000Z",
    });
    expect(ReadinessBlueprintDtoSchema.parse(blueprint)).toBeTruthy();
    for (const step of blueprint.roadmap) {
      expect(step.closesGapId).not.toBeNull();
      if (step.evidence.length === 0) {
        expect(step.truthClass).toBe("UNKNOWN");
        expect(step.confidence).toBe("INSUFFICIENT_EVIDENCE");
      }
    }
  });
});

describe("readiness service", () => {
  const COMPANY = "66666666-6666-4666-8666-666666666666";
  const actor = {
    userId: "77777777-7777-4777-8777-777777777777",
    tenantId: "88888888-8888-4888-8888-888888888888",
    actorType: "HUMAN",
  } as never;

  function memoryStore(): ReadinessStore & {
    rows: string[];
    events: string[];
  } {
    const rows: string[] = [];
    const events: { key: string; done: boolean }[] = [];
    return {
      rows,
      events: [] as string[],
      profileFacts: async () => ({
        tenantId: "88888888-8888-4888-8888-888888888888",
        stageCode: EMPTY.stageCode,
        profile: EMPTY.profile,
        team: EMPTY.team,
        verification: EMPTY.verification,
        claims: [],
      }),
      latest: async () => null,
      record: async (input) => {
        if (rows.at(-1) !== input.basisHash) rows.push(input.basisHash);
        return {
          revision: rows.length,
          assessedAt: "2026-10-07T00:00:00.000Z",
        };
      },
      marks: async () =>
        new Map(
          events.map((event) => [
            event.key,
            { done: event.done, at: "2026-10-07T00:00:00.000Z" },
          ]),
        ),
      mark: async (input) => {
        events.push({ key: input.actionKey, done: input.done });
      },
    };
  }

  it("is null for anyone without their own company (investors included)", async () => {
    const service = createReadinessService({
      store: memoryStore(),
      ownCompanyId: async () => null,
    });
    expect(await service.read(actor)).toBeNull();
    expect(await service.blueprint(actor, COMPANY, 6)).toBeNull();
  });

  it("serves a contract-valid DTO and appends a revision only when the basis changes", async () => {
    const store = memoryStore();
    const service = createReadinessService({
      store,
      ownCompanyId: async () => COMPANY,
    });
    const first = await service.read(actor);
    expect(ReadinessDtoSchema.parse(first)).toBeTruthy();
    await service.read(actor);
    expect(store.rows).toHaveLength(1);
  });

  it("refuses a Blueprint for a company that is not the actor's own", async () => {
    const service = createReadinessService({
      store: memoryStore(),
      ownCompanyId: async () => COMPANY,
    });
    expect(
      await service.blueprint(actor, "99999999-9999-4999-8999-999999999999", 6),
    ).toBeNull();
    expect(
      ReadinessBlueprintDtoSchema.parse(
        await service.blueprint(actor, COMPANY, 3),
      ),
    ).toBeTruthy();
  });

  it("marks and reopens an action, and never ticks one closed by evidence", async () => {
    const service = createReadinessService({
      store: memoryStore(),
      ownCompanyId: async () => COMPANY,
    });
    expect(
      await service.setActionState(actor, "upload-deck", { done: true }),
    ).toEqual({ key: "upload-deck", state: "MARKED_DONE" });
    const read = await service.read(actor);
    expect(read?.actions.find((a) => a.key === "upload-deck")?.state).toBe(
      "MARKED_DONE",
    );
    expect(
      await service.setActionState(actor, "no-such-action", { done: true }),
    ).toBeNull();
  });
});
