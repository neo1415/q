import { describe, expect, it } from "vitest";

import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import {
  createOnboardingPort,
  mergeListValues,
} from "../src/voice/onboarding-port.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 ~15:15Z on production f42b28f7b (fictional
 * investor "Fjordwerk Frueh Capital", typed). No live model: the reader
 * is a fake answering as reader v13 did, every category its own item.
 *
 * "Nordics and Germany" was saved as Germany only; "fintech and industrial
 * automation" as Manufacturing & Industrial only; the exclusions gambling,
 * tobacco, weapons, speculative crypto as speculative crypto only. Each
 * item was written as its own response in one batch, ~250 ms apart, each
 * superseding the one before. The release before (d6f606053) saved one
 * row with every value.
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
const SESSION = "11111111-1111-4111-8111-111111111111";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "investor" },
};

const GEO = "I3.geography";
const SECTORS = "I3.sectors";
const EXCLUSIONS = "I7.hard_exclusions";
const NODE = {
  nordics: "d0000000-0000-4000-8000-0000000000e1",
  germany: "d0000000-0000-4000-8000-0000000000e2",
  austria: "d0000000-0000-4000-8000-0000000000e3",
  fintech: "d0000000-0000-4000-8000-0000000000f1",
  industrial: "d0000000-0000-4000-8000-0000000000f2",
} as const;
const TAXONOMY = {
  nordics: NODE.nordics,
  germany: NODE.germany,
  austria: NODE.austria,
  fintech: NODE.fintech,
  "industrial automation": NODE.industrial,
};
const GEO_SAID = "Nordics and Germany.";
const SECTORS_SAID = "Fintech and industrial automation.";
const EXCLUSIONS_SAID =
  "Never gambling, tobacco, weapons or speculative crypto.";

/** The reader's option id for an option key (o1 is the step's first). */
function optionId(stepKey: string, key: string): string {
  const step = INVESTOR_DEFINITION_V1.steps.find((s) => s.stepKey === stepKey);
  const c = step?.configuration;
  const options =
    c?.stepType === "multi_select" || c?.stepType === "single_select"
      ? c.options
      : [];
  const at = options.findIndex((o) => o.optionKey === key);
  if (at < 0) throw new Error(`${stepKey} has no option ${key}`);
  return `o${String(at + 1)}`;
}

function ids(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null) return [];
  if ("resourceIds" in value && Array.isArray(value.resourceIds)) {
    return [...(value.resourceIds as string[])].sort();
  }
  if ("optionKeys" in value && Array.isArray(value.optionKeys)) {
    return [...(value.optionKeys as string[])].sort();
  }
  return [];
}

function world(recorded: Record<string, string> = {}) {
  return investorSession({
    currentStepKey: GEO,
    subject: FIRM,
    servesTurnSteps: true,
    recorded: {
      "I0.investor_type": "vc",
      "I0.organisation_name": "Fjordwerk Frueh Capital",
      ...recorded,
    },
    taxonomy: TAXONOMY,
  });
}

describe("each item the reader gives for one list step is one write with them all", () => {
  it("the port writes Nordics and Germany, the two sectors and four exclusions as one response each", async () => {
    const w = world();
    const said = [GEO_SAID, SECTORS_SAID, EXCLUSIONS_SAID];
    const port = createOnboardingPort({
      session: turn(w, EXCLUSIONS_SAID).session,
      onboardingSessionId: turn(w, EXCLUSIONS_SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: said,
      authority: () =>
        Promise.resolve(
          authorityReading({ stated: [GEO, SECTORS, EXCLUSIONS] }),
        ),
      chooseCategories: (choice) =>
        Promise.resolve(choice.candidates.map((c) => c.nodeId)),
    });
    const item = (stepKey: string, value: string, quote: string) => ({
      stepKey,
      value: [value],
      quote,
      basis: "STATED" as const,
      ownWords: false,
    });
    const results = await port.record([
      item(GEO, "Nordics", GEO_SAID),
      item(GEO, "Germany", GEO_SAID),
      item(SECTORS, "fintech", SECTORS_SAID),
      item(SECTORS, "industrial automation", SECTORS_SAID),
      item(EXCLUSIONS, "gambling", EXCLUSIONS_SAID),
      item(EXCLUSIONS, "tobacco", EXCLUSIONS_SAID),
      item(EXCLUSIONS, "weapons", EXCLUSIONS_SAID),
      item(EXCLUSIONS, "crypto_speculation", EXCLUSIONS_SAID),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(
      Array.from({ length: 8 }, () => "COMMITTED"),
    );
    expect(ids(w.recordedValue(GEO))).toEqual(
      [NODE.nordics, NODE.germany].sort(),
    );
    expect(ids(w.recordedValue(SECTORS))).toEqual(
      [NODE.fintech, NODE.industrial].sort(),
    );
    expect(ids(w.recordedValue(EXCLUSIONS))).toEqual(
      ["crypto_speculation", "gambling", "tobacco", "weapons"].sort(),
    );
    // One write each: never one item written over another.
    expect(w.history(GEO)).toHaveLength(1);
    expect(w.history(SECTORS)).toHaveLength(1);
    expect(w.history(EXCLUSIONS)).toHaveLength(1);
    for (const batch of w.batches()) {
      expect(new Set(batch).size).toBe(batch.length);
    }
  });

  it("the live sequence: a reading giving every category as its own item saves them all, once each", async () => {
    const w = world();
    let reads = 0;
    const reader: OnboardingTranscriptReader = {
      read: () => {
        reads += 1;
        const item = (stepKey: string, value: string, quote: string) => ({
          stepKey,
          value: [value],
          quote,
          ownWords: false,
          aboutStep: true,
          source: "STATED" as const,
        });
        return Promise.resolve({
          answers:
            reads === 1
              ? [
                  item(GEO, "Nordics", GEO_SAID),
                  item(GEO, "Germany", GEO_SAID),
                  item(SECTORS, "fintech", SECTORS_SAID),
                  item(SECTORS, "industrial automation", SECTORS_SAID),
                  ...[
                    "gambling",
                    "tobacco",
                    "weapons",
                    "crypto_speculation",
                  ].map((key) =>
                    item(
                      EXCLUSIONS,
                      optionId(EXCLUSIONS, key),
                      EXCLUSIONS_SAID,
                    ),
                  ),
                ]
              : [],
          declined: [],
          notKnown: [],
        });
      },
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
    });
    await conversation.said?.(
      line,
      "PERSON",
      `${GEO_SAID} ${SECTORS_SAID} ${EXCLUSIONS_SAID}`,
    );
    await conversation.flush?.(line);
    expect(ids(w.recordedValue(GEO))).toEqual(
      [NODE.nordics, NODE.germany].sort(),
    );
    expect(ids(w.recordedValue(SECTORS))).toEqual(
      [NODE.fintech, NODE.industrial].sort(),
    );
    expect(ids(w.recordedValue(EXCLUSIONS))).toEqual(
      ["crypto_speculation", "gambling", "tobacco", "weapons"].sort(),
    );
    expect(w.history(GEO)).toHaveLength(1);
    expect(w.history(SECTORS)).toHaveLength(1);
    expect(w.history(EXCLUSIONS)).toHaveLength(1);
  });

  it("a later reading adding to a saved list keeps what is there; one saying it is the whole list replaces it", async () => {
    const ADD = "Austria too.";
    const ONLY = "Actually only Germany and Austria.";
    for (const [said, replaces, expected] of [
      [ADD, false, [NODE.nordics, NODE.germany, NODE.austria]],
      [ONLY, true, [NODE.germany, NODE.austria]],
    ] as const) {
      const w = world({ [GEO]: `${NODE.nordics},${NODE.germany}` });
      const reader: OnboardingTranscriptReader = {
        read: () =>
          Promise.resolve({
            answers: (replaces ? ["Germany", "Austria"] : ["Austria"]).map(
              (value, index) => ({
                stepKey: GEO,
                value: [value],
                quote: said,
                ownWords: false,
                aboutStep: true,
                source: "STATED" as const,
                // The reader marks the whole list on one item only.
                ...(replaces && index === 0 ? { replaces: true } : {}),
              }),
            ),
            declined: [],
            notKnown: [],
          }),
      };
      const conversation = createOnboardingConversation({
        apiBaseUrl: "http://api.test",
        fetch: w.fetch,
        logger,
        readAfterMs: 5,
        reader,
      });
      await conversation.said?.(line, "PERSON", said);
      await conversation.flush?.(line);
      expect(ids(w.recordedValue(GEO))).toEqual([...expected].sort());
      // The seeded answer, then one write.
      expect(w.history(GEO).length).toBeLessThanOrEqual(2);
    }
  });

  it("items held for their yes are one suggestion with them all", async () => {
    const w = world();
    const port = createOnboardingPort({
      session: turn(w, GEO_SAID).session,
      onboardingSessionId: turn(w, GEO_SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [GEO_SAID],
      recommendations: w.recommendations,
    });
    await port.holdInferred([
      { stepKey: GEO, value: ["Nordics"], quote: GEO_SAID, ownWords: false },
      { stepKey: GEO, value: ["Germany"], quote: GEO_SAID, ownWords: false },
    ]);
    const pending = w
      .heldSuggestions()
      .filter((s) => s.stepKey === GEO && s.status === "PENDING");
    expect(pending).toHaveLength(1);
    expect(ids(pending[0]?.value)).toEqual([NODE.nordics, NODE.germany].sort());
    expect(w.recordedValue(GEO)).toBeUndefined();
  });

  it("founder lists too: functions and categories given item by item are one write each", async () => {
    const FUNCTIONS_SAID = "Engineering and sales.";
    const CATEGORIES_SAID = "Fintech and industrial automation.";
    const w = investorSession({
      journey: "founder",
      currentStepKey: FOUNDER_STEPS.functions,
      servesTurnSteps: true,
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Fjordwerk Robotics (fictional)",
        "F1.stage": "seed",
      },
      taxonomy: TAXONOMY,
    });
    const port = createOnboardingPort({
      session: turn(w, FUNCTIONS_SAID).session,
      onboardingSessionId: turn(w, FUNCTIONS_SAID).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [FUNCTIONS_SAID, CATEGORIES_SAID],
      authority: () =>
        Promise.resolve(
          authorityReading({
            stated: [FOUNDER_STEPS.functions, FOUNDER_STEPS.categories],
          }),
        ),
      chooseCategories: (choice) =>
        Promise.resolve(choice.candidates.map((c) => c.nodeId)),
    });
    const item = (stepKey: string, value: string, quote: string) => ({
      stepKey,
      value: [value],
      quote,
      basis: "STATED" as const,
      ownWords: false,
    });
    await port.record([
      item(FOUNDER_STEPS.functions, "engineering", FUNCTIONS_SAID),
      item(FOUNDER_STEPS.functions, "sales", FUNCTIONS_SAID),
      item(FOUNDER_STEPS.categories, "fintech", CATEGORIES_SAID),
      item(FOUNDER_STEPS.categories, "industrial automation", CATEGORIES_SAID),
    ]);
    expect(ids(w.recordedValue(FOUNDER_STEPS.functions))).toEqual(
      ["engineering", "sales"].sort(),
    );
    expect(ids(w.recordedValue(FOUNDER_STEPS.categories))).toEqual(
      [NODE.fintech, NODE.industrial].sort(),
    );
    expect(w.history(FOUNDER_STEPS.functions)).toHaveLength(1);
    expect(w.history(FOUNDER_STEPS.categories)).toHaveLength(1);
  });
});

describe("mergeListValues", () => {
  it("joins lists and their notes; words beside a list join its note", () => {
    expect(
      mergeListValues([
        { value: { type: "TEXT", text: "consumer apps" } },
        {
          value: { type: "MULTI_SELECT", optionKeys: ["gambling"] },
          note: "adult content",
        },
        {
          value: { type: "MULTI_SELECT", optionKeys: ["tobacco", "gambling"] },
        },
      ]),
    ).toEqual({
      value: { type: "MULTI_SELECT", optionKeys: ["gambling", "tobacco"] },
      note: "adult content; consumer apps",
    });
  });
});
