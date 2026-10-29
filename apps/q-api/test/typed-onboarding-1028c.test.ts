import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QTurnAuthority,
  TaxonomyChooser,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type {
  PendingWrite,
  PendingWriteRepository,
} from "@capital-q/onboarding";
import { createDefaultPromptRegistry } from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import { createHeldWritesStore } from "../src/voice/held-writes.js";
import { confirmedContent } from "../src/voice/onboarding-conductor.js";
import { createOnboardingConversation } from "../src/voice/onboarding-conversation.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import { createTypedOnboarding } from "../src/voice/typed-onboarding.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Typed onboarding, production re-test #3 (2026-10-28 22:26-22:42 UTC,
 * deployed f87847eac; investor typed-e2e-1028c session f6be6a92, founder
 * d80d2050). Each case is one defect, the readers faked to say what the
 * live ones did.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000001",
};
const FINTECH = "eacf7107-9af3-5b76-91a2-3c169e396347";
const HEALTHCARE = "e79290bb-1839-5433-b458-669edfd33f1e";
const DIGITAL_HEALTH = "7c953fc5-a6bc-5014-afef-068150e5209a";
const HEALTH_ACCESS = "caf102db-3bf3-518c-a6e3-b3b28c6c6a22";

/** The investor's opening sentence, as typed in the re-test. */
const OPENING =
  "I'm an angel, also run a small syndicate called Harmattan Angels, website harmattanangels dot com, pre-seed and seed, Nigeria Ghana Kenya, fintech and health, cheques 25 to 100k dollars, I'm actively investing";

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

function replies() {
  return {
    execute: () =>
      Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: { reply: "Thanks. Next?", asking: null, readBack: false },
        },
      }),
  } as unknown as ModelGateway;
}

function memoryPendingWrites(): PendingWriteRepository {
  const rows: (PendingWrite & { status: string })[] = [];
  return {
    hold: (_sql, input) => {
      for (const r of rows) {
        if (r.stepKey === input.stepKey && r.status === "PENDING") {
          r.status = "DISCARDED";
        }
      }
      const row = {
        ...input,
        id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
        attempts: 0,
        createdAt: new Date(Date.now() - 60_000),
        status: "PENDING",
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    listPending: (_sql, sessionId, userId) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            r.sessionId === sessionId &&
            r.userId === userId &&
            r.status === "PENDING",
        ),
      ),
    settle: (_sql, id, status) => {
      const row = rows.find((r) => r.id === id && r.status === "PENDING");
      if (row !== undefined) row.status = status;
      return Promise.resolve();
    },
    recordAttempt: () => Promise.resolve(),
  };
}

function typedWorld(options: {
  readonly world: ReturnType<typeof investorSession>;
  readonly readings?: Reading[];
  readonly authority?: QTurnAuthority;
  readonly categories?: TaxonomyChooser;
  readonly held?: boolean;
}) {
  const readings = options.readings ?? [{ answers: [], declined: [] }];
  const reader: OnboardingTranscriptReader = {
    read: () =>
      Promise.resolve(
        readings.length > 1
          ? (readings.shift() ?? null)
          : (readings[0] ?? null),
      ),
  };
  let keys = 0;
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: options.world.fetch,
    logger,
    readAfterMs: 5,
    reader,
    categories: options.categories,
    ...(options.held === true
      ? {
          heldWrites: createHeldWritesStore({
            sql: {} as never,
            repository: memoryPendingWrites(),
            newKey: () =>
              `10000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`,
          }),
        }
      : {}),
  });
  const typed = createTypedOnboarding({
    conversation,
    gateway: replies(),
    delegation: readerOf(options.authority ?? reading({})),
    logger,
  });
  return async (words: string) => {
    const outcome = await typed.turn({ ...turn(options.world, words), actor });
    if (outcome === null) throw new Error("the typed path declined the turn");
    return outcome;
  };
}

async function settled(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sectorsOf = (world: ReturnType<typeof investorSession>) => {
  const value = world.recordedValue("I3.sectors");
  return value?.type === "RESOURCE_REFERENCE" ? [...value.resourceIds] : null;
};

describe("defect 1: the investor's sectors are never lost to free text", () => {
  const ambiguousHealth = {
    health: [
      { nodeId: DIGITAL_HEALTH, displayName: "Digital Health" },
      { nodeId: HEALTHCARE, displayName: "Healthcare" },
      { nodeId: HEALTH_ACCESS, displayName: "Health Access" },
    ],
  };

  it('"fintech and health": the ambiguous "health" is chosen among the lookup\'s own candidates by meaning; both are sectors', async () => {
    const world = investorSession({
      currentStepKey: "I3.sectors",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
      taxonomy: { fintech: FINTECH },
      taxonomyAmbiguous: ambiguousHealth,
    });
    const asked: { phrase: string; offered: string[] }[] = [];
    const say = typedWorld({
      world,
      categories: (input) => {
        asked.push({
          phrase: input.phrase,
          offered: input.candidates.map((c) => c.nodeId),
        });
        // A chooser that also names an id it was never offered: dropped.
        return Promise.resolve(
          input.phrase === "health"
            ? [HEALTHCARE, "ffffffff-ffff-4fff-8fff-ffffffffffff"]
            : [],
        );
      },
      readings: [
        {
          answers: [
            {
              stepKey: "I3.sectors",
              value: ["fintech", "health"],
              quote: "fintech and health",
              ownWords: false,
            },
          ],
          declined: [],
        },
      ],
    });
    await say(OPENING);
    await settled(() => (sectorsOf(world)?.length ?? 0) >= 2);
    expect(sectorsOf(world)).toEqual([FINTECH, HEALTHCARE]);
    // Only the ambiguous word went to the chooser, with the lookup's ids.
    expect(asked.length).toBeGreaterThan(0);
    for (const one of asked) {
      expect(one).toEqual({
        phrase: "health",
        offered: [DIGITAL_HEALTH, HEALTHCARE, HEALTH_ACCESS],
      });
    }
  });

  it('live sequence: fintech saved, health kept beside it; a later reading of "fintech and health" as words never replaces the categories', async () => {
    const world = investorSession({
      currentStepKey: "I3.sectors",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
      taxonomy: { fintech: FINTECH },
      taxonomyAmbiguous: ambiguousHealth,
    });
    const say = typedWorld({
      world,
      // No reading of the word to be had: kept in their words, as before.
      categories: () => Promise.resolve(null),
      readings: [
        {
          answers: [
            {
              stepKey: "I3.sectors",
              value: ["fintech", "health"],
              quote: "fintech and health",
              ownWords: false,
            },
          ],
          declined: [],
        },
        {
          answers: [
            {
              stepKey: "I3.sectors",
              value: "fintech and health",
              quote: "fintech and health",
              ownWords: true,
            },
          ],
          declined: [],
        },
      ],
    });
    await say(OPENING);
    await settled(() => sectorsOf(world) !== null);
    expect(sectorsOf(world)).toEqual([FINTECH]);
    expect(world.recordedNote("I3.sectors")).toBe("health");
    await say("hold on, my dog is barking");
    await settled(() => (world.recordedNote("I3.sectors") ?? "") !== "health");
    // Still the categories, never the text; their words beside them.
    expect(world.recordedValue("I3.sectors")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [FINTECH],
    });
    expect(world.recordedNote("I3.sectors")).toContain("fintech and health");
    expect(
      world.history("I3.sectors").every((v) => v.type === "RESOURCE_REFERENCE"),
    ).toBe(true);
  });
});

describe('defect 2: "we like to lead sometimes but mostly follow" is follow', () => {
  it("the active transcript reader reads what they mainly do, not the exception", () => {
    const active = createDefaultPromptRegistry().getActive(
      "ONBOARDING_TRANSCRIPT_READER",
    );
    expect(active.definition.version).toBe(3);
    expect(active.definition.template).toMatch(
      /what they mainly do: the exception is not one of their choices/u,
    );
  });

  it("the reading by option key is saved as it is: follow only", async () => {
    const world = investorSession({
      currentStepKey: "I2.investment_role",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
    });
    const say = typedWorld({
      world,
      readings: [
        {
          answers: [
            {
              stepKey: "I2.investment_role",
              value: ["follow"],
              quote: "we like to lead sometimes but mostly follow",
              ownWords: false,
            },
          ],
          declined: [],
        },
      ],
    });
    await say(
      "ok I'm back. we do about 6 deals a year and we like to lead sometimes but mostly follow",
    );
    await settled(
      () => world.recordedValue("I2.investment_role") !== undefined,
    );
    expect(world.recordedValue("I2.investment_role")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["follow"],
    });
  });
});

describe("defect 3: a correction to a held cheque keeps its history (25000 -> 50000)", () => {
  it("the held original is written first, then the correction", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      subject: FIRM,
      recorded: { "I0.organisation_name": "Harmattan Angels" },
      // The firm is not set up until how they invest is saved.
      setUpBy: ["I0.investor_type"],
    });
    const say = typedWorld({
      world,
      held: true,
      readings: [
        {
          answers: [
            {
              stepKey: "I2.cheque_min",
              value: 25000,
              quote: "cheques 25 to 100k dollars",
              ownWords: false,
            },
          ],
          declined: [],
        },
        {
          answers: [
            {
              stepKey: "I0.investor_type",
              value: "angel",
              quote: "I'm an angel",
              ownWords: false,
            },
            {
              stepKey: "I2.cheque_min",
              value: 50000,
              quote: "make that 50 to 100k, not 25",
              ownWords: false,
            },
          ],
          declined: [],
        },
      ],
    });
    await say(OPENING);
    await settled(() => world.attempts().includes("I2.cheque_min"));
    expect(world.recordedValue("I2.cheque_min")).toBeUndefined();
    await say("actually sorry, make that 50 to 100k, not 25");
    await settled(
      () =>
        JSON.stringify(world.recordedValue("I2.cheque_min")) ===
        JSON.stringify({ type: "RANGE", value: "50000" }),
    );
    expect(world.history("I2.cheque_min")).toEqual([
      { type: "RANGE", value: "25000" },
      { type: "RANGE", value: "50000" },
    ]);
  });
});

/** Every required non-review step answered, plus the given extras. */
function everyEssential(
  steps: typeof INVESTOR_DEFINITION_V1.steps,
  extra: Record<string, string> = {},
): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const step of steps) {
    if (!step.required) continue;
    const c = step.configuration;
    if (c.stepType === "confirmation") continue;
    recorded[step.stepKey] =
      c.stepType === "single_select" || c.stepType === "multi_select"
        ? (c.options[0]?.optionKey ?? "")
        : c.stepType === "reference_select"
          ? "d0000000-0000-4000-8000-000000000001"
          : c.stepType === "range"
            ? "10"
            : "Ajali Health";
  }
  return { ...recorded, ...extra };
}

describe("defect 4: a review is confirmed only after its read-back, which lists every essential", () => {
  it('the journey standing on the review is not the person seeing it: "that\'s all" reads back first', async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: everyEssential(INVESTOR_DEFINITION_V1.steps),
    });
    const say = typedWorld({ world, authority: reading({ finishing: true }) });
    const first = await say("that's all");
    expect(first.reply).toMatch(/^Here's what I have saved: /u);
    expect(world.recordedValue("I11.review")).toBeUndefined();
    const second = await say("yes");
    expect(second.view.session.status).toBe("COMPLETED");
  });

  it("the founder's read-back names the revenue, its currency, the raise and the instrument, grouped", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F6.confirm",
      subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000000002" },
      recorded: everyEssential(FOUNDER_DEFINITION_CURRENT.steps, {
        "F1.website": "https://ajalihealth.co.ke",
        "F1.description": "A telemedicine app for nurses in Kenya.",
        "F5.customers": "1200",
        "F5.fin_currency": "kes",
        "F5.monthly_revenue": "2100000",
        "F5.revenue_trend": "growing",
        "F5.gross_margin": "61",
        "F6.currency": "usd",
        "F6.target_amount": "400000",
        "F6.instrument": "safe",
        "F6.use_of_funds": "gtm",
      }),
    });
    const say = typedWorld({ world, authority: reading({ finishing: true }) });
    const outcome = await say("that's all");
    expect(outcome.reply).toMatch(/^Here's what I have saved: /u);
    expect(world.recordedValue("F6.confirm")).toBeUndefined();
    expect(outcome.reply).toMatch(/Traction: /u);
    expect(outcome.reply).toMatch(/Raise: /u);
    expect(outcome.reply).toMatch(/SAFE/u);
    expect(outcome.reply).toMatch(/Kenyan shilling/u);
    expect(outcome.reply).toMatch(/400/u);
    expect(outcome.reply).not.toMatch(/\.\./u);
  });
});

describe("defect 6: wording", () => {
  it('"I still need 2 things: discovery and inbound" is now the open count and the question in its own words', () => {
    const line = finishingLine(
      "investor",
      {
        completed: false,
        missing: [
          { stepKey: "I9.discovery_mode", question: "Discovery?" },
          { stepKey: "I10.inbound_preference", question: "Inbound?" },
        ],
      },
      {
        labelOf: (key) =>
          key === "I9.discovery_mode" ? "Discovery" : "Inbound",
        questionOf: () =>
          "When I show you companies, should I stick closely to what you've told me?",
      },
    );
    expect(line?.reply).not.toMatch(/discovery|inbound/iu);
    expect(line?.reply).toMatch(/2 more answers/u);
  });

  it('"6 deals a year." in a read-back has one full stop', () => {
    const line = finishingLine(
      "investor",
      { completed: false, missing: [], reason: undefined },
      { labelOf: () => undefined, questionOf: () => null },
    );
    expect(line).toBeNull();
    const reviewed = finishingLine(
      "investor",
      {
        completed: false,
        missing: [],
        reason:
          "The review has not been shown to them yet: read back what is saved and ask if it is right; finish on their yes.",
      },
      {
        labelOf: () => undefined,
        questionOf: () => null,
        review: {
          stepKey: "I11.review",
          saved: ["Review: Anything we missed: We do about 6 deals a year."],
        },
      },
    );
    expect(reviewed?.reply).toContain("6 deals a year. Is that all right?");
    expect(reviewed?.reply).not.toMatch(/\.\./u);
  });

  it('"Sector: 1 selected" in the review names the sectors', async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F3.review",
      recorded: {
        "F1.company_name": "Ajali Health",
        "F1.categories": "b74391cc-44f2-5513-b3fa-96f7bbeb8139",
      },
    });
    const view = (await (
      await world.fetch("http://api.test/v1/onboarding/sessions/x")
    ).json()) as OnboardingSessionView;
    const content = confirmedContent(
      view,
      "founder",
      "F3.review",
      new Map([["b74391cc-44f2-5513-b3fa-96f7bbeb8139", "Telehealth"]]),
    );
    expect(content).toContain("Telehealth");
    expect(content).not.toMatch(/selected/u);
  });
});
