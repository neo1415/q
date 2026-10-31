import { describe, expect, it } from "vitest";

import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 ~17:24Z on production 656719a90 (fictional
 * investor "Skerry Lantern Ventures", founder "Vesiveski Parcel Docks",
 * typed). No live model: readers and the category chooser are fakes
 * answering as the live ones did.
 *
 * 1. "fintech and industrial automation": the reader gave each its own
 *    item; the lookup abstained on "industrial automation" (LOW_CONFIDENCE),
 *    the chooser named none of the 66 offered, and that item was refused
 *    UNMATCHED on its own, so only Fintech saved and the words were lost.
 * 2. "Mostly B2B with recurring revenue": "recurring revenue" was read as
 *    Consumer Subscription; the chooser was told nothing about who their
 *    customers are.
 * 3. "We have 40 lockers live in 12 towns and 3 courier companies paying
 *    us": read as "Paying customers"; the lockers and towns were nowhere.
 * 4. "skip the rest" took 26.5 s: the answer to their latest words waited
 *    behind a reread of the earlier words over every step (14.7 s).
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
const COMPANY = {
  type: "COMPANY" as const,
  id: "e0000000-0000-4000-8000-0000000000aa",
};
const SESSION = "11111111-1111-4111-8111-111111111111";
const lineOf = (journeyType: "investor" | "founder"): ConversationLine => ({
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType },
});
type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

const SECTORS = "I3.sectors";
const NODE = {
  fintech: "d0000000-0000-4000-8000-0000000000f1",
  manufacturing: "d0000000-0000-4000-8000-0000000000f2",
  workflow: "d0000000-0000-4000-8000-0000000000f3",
  b2b: "d0000000-0000-4000-8000-0000000000f4",
} as const;
/** The field's whole list, as the live vocabularies serve it. */
const SECTOR_LIST = [
  { id: NODE.fintech, code: "fintech", name: "Fintech" },
  {
    id: NODE.manufacturing,
    code: "manufacturing",
    name: "Manufacturing & Industrial",
  },
  { id: NODE.workflow, code: "workflow", name: "Workflow Automation" },
].map((n) => ({
  id: n.id,
  canonicalCode: n.code,
  displayName: n.name,
  parentNodeId: null,
  depth: 0,
}));
const SECTORS_SAID =
  "We invest in the Nordics and Germany. Sectors: fintech and industrial automation.";

function sectorWorld() {
  return investorSession({
    currentStepKey: SECTORS,
    subject: FIRM,
    servesTurnSteps: true,
    recorded: {
      "I0.investor_type": "vc",
      "I0.organisation_name": "Skerry Lantern Ventures",
    },
    // "fintech" is found by the lookup; "industrial automation" is not.
    taxonomy: { fintech: NODE.fintech, b2b: NODE.b2b },
    taxonomyNodes: SECTOR_LIST,
  });
}

function ids(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null) return [];
  if ("resourceIds" in value && Array.isArray(value.resourceIds)) {
    return [...(value.resourceIds as string[])].sort();
  }
  return [];
}

describe("1. a sector phrase no category holds, given as its own item, is kept beside the others", () => {
  it('"industrial automation" (chooser names none of the whole list) is the note beside Fintech, and read back', async () => {
    const w = sectorWorld();
    const offered: number[] = [];
    const port = createOnboardingPort({
      session: turn(w, SECTORS_SAID).session,
      onboardingSessionId: turn(w, SECTORS_SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [SECTORS_SAID],
      authority: () => Promise.resolve(authorityReading({ stated: [SECTORS] })),
      // As live: offered the whole list, it named none.
      chooseCategories: (choice) => {
        offered.push(choice.candidates.length);
        return Promise.resolve([]);
      },
    });
    const item = (value: string) => ({
      stepKey: SECTORS,
      value: [value],
      quote: "Sectors: fintech and industrial automation.",
      basis: "STATED" as const,
      ownWords: false,
    });
    const results = await port.record([
      item("fintech"),
      item("industrial automation"),
    ]);
    expect(offered.length).toBeGreaterThan(0);
    expect(results.map((r) => r.outcome)).toEqual(["COMMITTED", "COMMITTED"]);
    expect(ids(w.recordedValue(SECTORS))).toEqual([NODE.fintech]);
    expect(w.recordedNote(SECTORS)).toBe("industrial automation");
    const state = await port.state();
    const row = state.steps.find((s) => s.stepKey === SECTORS);
    expect(row?.value).toMatch(/Also said: industrial automation/u);
  });

  it("the conversation path, with the reader's separate items, keeps it too", async () => {
    const w = sectorWorld();
    const readings: Reading[] = [
      {
        answers: [
          {
            stepKey: SECTORS,
            value: ["fintech"],
            quote: "Sectors: fintech and industrial automation.",
            ownWords: false,
            source: "STATED",
          },
          {
            stepKey: SECTORS,
            value: ["industrial automation"],
            quote: "Sectors: fintech and industrial automation.",
            ownWords: false,
            source: "STATED",
          },
        ],
        declined: [],
        notKnown: [],
      },
    ];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      categories: () => Promise.resolve([]),
      reader: {
        read: () =>
          Promise.resolve(
            readings.shift() ?? { answers: [], declined: [], notKnown: [] },
          ),
      },
    });
    const line = lineOf("investor");
    await conversation.said?.(line, "Q", "Which sectors?", SECTORS);
    await conversation.said?.(line, "PERSON", SECTORS_SAID);
    await conversation.flush?.(line);
    expect(ids(w.recordedValue(SECTORS))).toEqual([NODE.fintech]);
    expect(w.recordedNote(SECTORS)).toBe("industrial automation");
  });
});

describe("2. a category is read with what else they said, and words no category fits are kept", () => {
  const SAID = "Mostly B2B with recurring revenue, and we need some revenue.";

  it('"recurring revenue" beside "B2B": the chooser is told their customers; none fits, so their words go to their notes', async () => {
    const w = investorSession({
      currentStepKey: "I4.business_models",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Skerry Lantern Ventures",
      },
      taxonomy: { b2b: NODE.b2b },
      taxonomyNodes: [
        {
          id: "d0000000-0000-4000-8000-0000000000c1",
          canonicalCode: "consumer_subscription",
          displayName: "Consumer Subscription",
          parentNodeId: null,
          depth: 0,
        },
      ],
    });
    const contexts: string[] = [];
    const port = createOnboardingPort({
      session: turn(w, SAID).session,
      onboardingSessionId: turn(w, SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [SAID],
      authority: () =>
        Promise.resolve(
          authorityReading({
            stated: ["I4.business_models", "I4.customer_types"],
          }),
        ),
      // A reading told they back B2B companies chooses no consumer model.
      chooseCategories: (choice) => {
        if (choice.phrase === "recurring revenue") {
          contexts.push(choice.context ?? "");
          return Promise.resolve(
            /B2B/u.test(choice.context ?? "")
              ? []
              : choice.candidates.map((c) => c.nodeId),
          );
        }
        return Promise.resolve([]);
      },
    });
    const results = await port.record([
      {
        stepKey: "I4.business_models",
        value: ["recurring revenue"],
        quote: "Mostly B2B with recurring revenue",
        basis: "STATED",
        ownWords: false,
      },
      {
        stepKey: "I4.customer_types",
        value: ["B2B"],
        quote: "Mostly B2B",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every((c) => c.includes("B2B"))).toBe(true);
    expect(w.recordedValue("I4.business_models")).toBeUndefined();
    expect(ids(w.recordedValue("I4.customer_types"))).toEqual([NODE.b2b]);
    const notes = w.recordedValue("I11.additional_context");
    expect(notes?.type === "TEXT" ? notes.text : "").toMatch(
      /recurring revenue/u,
    );
    const models = results.find((r) => r.stepKey === "I4.business_models");
    expect(models?.outcome).toBe("UNMATCHED");
    expect(models?.reason).toMatch(/kept in their notes/u);
  });
});

describe("3. their words beyond the option they were read as are kept and read back", () => {
  const SAID =
    "We have 40 lockers live in 12 towns and 3 courier companies paying us. We are raising 1.2 million euros.";

  function founderWorld() {
    return investorSession({
      journey: "founder",
      currentStepKey: "F5.signal",
      subject: COMPANY,
      servesTurnSteps: true,
      recorded: { "F1.stage": "seed" },
    });
  }

  function portFor(
    w: ReturnType<typeof founderWorld>,
    beyond: string | undefined,
  ) {
    return createOnboardingPort({
      session: turn(w, SAID).session,
      onboardingSessionId: turn(w, SAID).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [SAID],
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["F5.signal"] })),
      chooseCategories: (choice) => {
        const paying = choice.candidates.find(
          (c) => c.displayName === "Paying customers",
        );
        const picked = paying === undefined ? [] : [paying.nodeId];
        return Promise.resolve(
          beyond === undefined ? picked : Object.assign(picked, { beyond }),
        );
      },
    });
  }

  const item = {
    stepKey: "F5.signal",
    value: "40 lockers live in 12 towns and 3 courier companies paying us",
    quote:
      "We have 40 lockers live in 12 towns and 3 courier companies paying us.",
    basis: "STATED" as const,
    ownWords: true,
  };

  it('"40 lockers live in 12 towns" is the note beside "Paying customers", and in the read-back', async () => {
    const w = founderWorld();
    const port = portFor(w, "40 lockers live in 12 towns");
    const [result] = await port.record([item]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(w.recordedValue("F5.signal")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "paying",
    });
    expect(w.recordedNote("F5.signal")).toBe("40 lockers live in 12 towns");
    expect(result?.recorded).toMatch(
      /Paying customers\. Also said: 40 lockers live in 12 towns/u,
    );
    const state = await port.state();
    expect(state.steps.find((s) => s.stepKey === "F5.signal")?.value).toMatch(
      /Paying customers\. Also said: 40 lockers live in 12 towns/u,
    );
  });

  it("words the chooser gives back that they never said are dropped", async () => {
    const w = founderWorld();
    const port = portFor(w, "500 lockers across Finland");
    await port.record([item]);
    expect(w.recordedValue("F5.signal")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "paying",
    });
    expect(w.recordedNote("F5.signal")).toBeUndefined();
  });
});

describe("4. a reread for the steps a save opened reads only those steps", () => {
  it("the latest words are not held behind a reread of every step", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F6.raising",
      subject: COMPANY,
      servesTurnSteps: true,
      opensAfter: {
        "F6.currency": "F6.raising",
        "F6.target_amount": "F6.raising",
      },
      listsOnlyOpened: true,
    });
    const seen: string[][] = [];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: (input) => {
          const keys = input.steps.map((s) => s.stepKey);
          seen.push(keys);
          const quote = "We are raising 1.5 million euros";
          const optionId = (stepKey: string, label: string) =>
            (input.steps.find((s) => s.stepKey === stepKey)?.options ?? "")
              .split("; ")
              .find((pair) => pair.endsWith(`: ${label}`))
              ?.split(":")[0] ?? "";
          const answers: NonNullable<Reading>["answers"][number][] = [];
          if (keys.includes("F6.raising")) {
            answers.push({
              stepKey: "F6.raising",
              value: optionId("F6.raising", "Yes, actively"),
              quote,
              ownWords: false,
              source: "STATED",
            });
          }
          if (keys.includes("F6.currency")) {
            answers.push(
              {
                stepKey: "F6.target_amount",
                value: 1_500_000,
                quote,
                ownWords: false,
                source: "STATED",
              },
              {
                stepKey: "F6.currency",
                value: optionId("F6.currency", "Euro"),
                quote,
                ownWords: false,
                source: "STATED",
              },
            );
          }
          return Promise.resolve({ answers, declined: [], notKnown: [] });
        },
      },
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "Q", "Are you raising?", "F6.raising");
    await conversation.said?.(
      line,
      "PERSON",
      "Yes, actively. We are raising 1.5 million euros.",
    );
    await conversation.flush?.(line);
    expect(seen.length).toBe(2);
    expect(seen[0]).toContain("F6.raising");
    // Only what the save opened, never every step again.
    expect([...(seen[1] ?? [])].sort()).toEqual(
      ["F6.currency", "F6.target_amount"].sort(),
    );
    expect(world.recordedValue("F6.target_amount")).toBeDefined();
    expect(world.recordedValue("F6.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "eur",
    });
  });
});
