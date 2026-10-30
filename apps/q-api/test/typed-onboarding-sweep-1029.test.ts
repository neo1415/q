import { describe, expect, it } from "vitest";

import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QTurnAuthority,
  TaxonomyChooser,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import { createOnboardingConversation } from "../src/voice/onboarding-conversation.js";
import {
  createTypedOnboarding,
  savedSoFar,
  tappedReview,
} from "../src/voice/typed-onboarding.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live onboarding sweep 2026-10-29 (production ed9be6cc4), D1: the read-back
 * said "Say yes and I'll finish", the person tapped "Looks right", and Q
 * answered "Confirmed. Noted." with an optional question. The tap is their
 * yes: it finishes exactly as a typed yes does, server-side. No live model.
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

function replies(): ModelGateway {
  return {
    execute: () =>
      Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            reply: "Anything else you'd like to add, like your team?",
            asking: null,
            readBack: false,
          },
        },
      }),
  } as unknown as ModelGateway;
}

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

function typedWorld(options: {
  readonly world: ReturnType<typeof investorSession>;
  readonly authority: () => QTurnAuthority;
  readonly reading?: Reading;
  readonly categories?: TaxonomyChooser;
}) {
  const reader: OnboardingTranscriptReader = {
    read: () =>
      Promise.resolve(options.reading ?? { answers: [], declined: [] }),
  };
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: options.world.fetch,
    logger,
    readAfterMs: 5,
    reader,
    categories: options.categories,
  });
  const typed = createTypedOnboarding({
    conversation,
    gateway: replies(),
    delegation: readerOf(options.authority),
    logger,
  });
  return async (words: string, confirmReview?: string) => {
    const outcome = await typed.turn({
      ...turn(options.world, words),
      actor,
      ...(confirmReview === undefined ? {} : { confirmReview }),
    });
    if (outcome === null) throw new Error("the typed path declined the turn");
    return outcome;
  };
}

/** Every required non-review step answered. */
function everyEssential(): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const step of INVESTOR_DEFINITION_V1.steps) {
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
  return recorded;
}

describe("sweep D1: confirming the read-back finishes", () => {
  it("the confirm button under the finish read-back completes the setup, with no optional question", async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: everyEssential(),
    });
    // The reader reads nothing at all from the tap: it is not words.
    let calls = 0;
    const say = typedWorld({
      world,
      authority: () =>
        (calls += 1) === 1 ? reading({ finishing: true }) : reading({}),
    });
    const first = await say("that's all");
    expect(first.reply).toMatch(/Say yes and I'll finish/u);
    expect(world.recordedValue("I11.review")).toBeUndefined();

    const tapped = await say("Looks right", "I11.review");
    expect(tapped.view.session.status).toBe("COMPLETED");
    expect(tapped.navigate).toBe("DISCOVER");
    expect(tapped.reply).toMatch(/^That's everything I need\./u);
    expect(tapped.reply).not.toMatch(/\?/u);
    expect(tapped.asking).toBeNull();
  });

  it('a typed "yes" to the read-back, read as agreeing to the review only, still finishes', async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: everyEssential(),
    });
    let calls = 0;
    const say = typedWorld({
      world,
      authority: () =>
        (calls += 1) === 1
          ? reading({ finishing: true })
          : reading({ stated: ["I11.review"] }),
    });
    await say("that's all");
    const yes = await say("yes");
    expect(yes.view.session.status).toBe("COMPLETED");
    expect(yes.reply).not.toMatch(/team/u);
  });

  it("before every essential is in, the button confirms that review alone and asks what comes next", async () => {
    const recorded = everyEssential();
    delete recorded["I9.discovery_mode"];
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded,
    });
    const say = typedWorld({ world, authority: () => reading({}) });
    const outcome = await say("Looks right", "I11.review");
    expect(outcome.view.session.status).toBe("ACTIVE");
    expect(world.recordedValue("I11.review")).toEqual({
      type: "CONFIRMATION",
      confirmed: true,
    });
    expect(outcome.reply).toMatch(/^Thank you, that's confirmed\./u);
    expect(outcome.navigate).toBeNull();
  });

  it("only a confirmation step of the journey counts as a tapped review", () => {
    expect(tappedReview("investor", "I11.review")).toBe("I11.review");
    expect(tappedReview("investor", "I2.cheque_max")).toBeNull();
    expect(tappedReview("investor", undefined)).toBeNull();
    expect(tappedReview("founder", "F3.review")).toBe("F3.review");
  });
});

describe("sweep D7: what is saved so far, read back", () => {
  const row = (
    stepKey: string,
    question: string,
    status: "ANSWERED" | "OPEN",
    value: string | null,
    required = true,
  ) => ({
    stepKey,
    question,
    kind: "ONE_OF" as const,
    required,
    status,
    value,
  });
  const labels: Record<string, string> = {
    "F1.company_name": "Company",
    "F4.team_size": "Team size",
  };
  it("never reads a step back by its internal question, and lists by section", () => {
    const said = savedSoFar(
      {
        journey: "founder",
        currentStepKey: null,
        canComplete: false,
        completed: false,
        checks: [],
        steps: [
          row(
            "F0.intent",
            "What brings you to Capital Q: are you raising…?",
            "ANSWERED",
            "I'm raising for a company",
          ),
          row("F1.company_name", "Company name?", "ANSWERED", "Ferrowick"),
          row("F4.team_size", "How big is the team?", "OPEN", null),
        ],
      },
      "founder",
      (key) => labels[key],
    );
    expect(said).not.toMatch(/What brings you/u);
    expect(said).toMatch(/^Here's what I have saved so far:\n\n/u);
    expect(said).toContain("Company: Ferrowick");
    expect(said).toMatch(/\n\nStill to cover: team size\.$/u);
  });
});

describe("sweep D2: a region that is not a category", () => {
  const NETHERLANDS = "a1000000-0000-4000-8000-000000000001";
  const GERMANY = "a1000000-0000-4000-8000-000000000002";
  it('"Benelux and the Nordics": the field\'s whole list goes to the reader, Benelux is read as its listed member, and the read-back says so', async () => {
    const world = investorSession({
      currentStepKey: "I3.geography",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
      // The lookup finds nothing for either; the field lists two countries.
      taxonomyRoots: { Netherlands: NETHERLANDS, Germany: GERMANY },
    });
    const offered: { phrase: string; ids: string[] }[] = [];
    const say = typedWorld({
      world,
      authority: () => reading({}),
      categories: (input) => {
        offered.push({
          phrase: input.phrase,
          ids: input.candidates.map((c) => c.nodeId),
        });
        // The reader's own reading: Benelux holds the Netherlands; no
        // Nordic country is listed.
        return Promise.resolve(input.phrase === "Benelux" ? [NETHERLANDS] : []);
      },
      reading: {
        answers: [
          {
            stepKey: "I3.geography",
            value: ["Benelux", "the Nordics"],
            quote: "Benelux and the Nordics",
            ownWords: false,
          },
        ],
        declined: [],
      },
    });
    await say("Benelux and the Nordics");
    for (let i = 0; i < 200; i += 1) {
      if (world.recordedValue("I3.geography") !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(world.recordedValue("I3.geography")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [NETHERLANDS],
    });
    expect(world.recordedNote("I3.geography")).toBe(
      "Read as: “Benelux” as Netherlands. Kept as they said it: the Nordics.",
    );
    // The reader chose among the field's own list, never outside it.
    expect([...new Set(offered.map((o) => o.phrase))].sort()).toEqual([
      "Benelux",
      "the Nordics",
    ]);
    for (const one of offered) expect(one.ids).toEqual([NETHERLANDS, GERMANY]);
  });
});

describe("sweep D2: a listed option named with more detail", () => {
  it('"Eindhoven, the Netherlands" is the Netherlands, read among the step\'s own options, never "Somewhere else"', async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.country",
      subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000000002" },
      recorded: { "F0.intent": "raising_now", "F1.company_name": "Ferrowick" },
    });
    const offered: string[][] = [];
    const say = typedWorld({
      world,
      authority: () => reading({}),
      categories: (input) => {
        offered.push(input.candidates.map((c) => c.nodeId));
        return Promise.resolve(
          input.phrase === "Eindhoven, the Netherlands" ? ["nl"] : [],
        );
      },
      reading: {
        answers: [
          {
            stepKey: "F1.country",
            value: "Eindhoven, the Netherlands",
            quote: "Eindhoven, the Netherlands",
            ownWords: true,
          },
        ],
        declined: [],
      },
    });
    await say("We're based in Eindhoven, the Netherlands");
    for (let i = 0; i < 200; i += 1) {
      if (world.recordedValue("F1.country") !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(world.recordedValue("F1.country")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "nl",
    });
    // Offered the step's options, never its catch-all.
    expect(offered[0]).toContain("nl");
    expect(offered[0]).not.toContain("other");
  });
});

describe("sweep D1: asked to finish, the last essential answered", () => {
  it("goes on to the finish's read-back, never to an optional question", async () => {
    const recorded = everyEssential();
    delete recorded["I10.inbound_preference"];
    const world = investorSession({
      currentStepKey: "I10.inbound_preference",
      subject: FIRM,
      recorded,
    });
    let calls = 0;
    const say = typedWorld({
      world,
      // Only their first line reads as finishing; the answer after it
      // reads as nothing in particular.
      authority: () =>
        (calls += 1) === 1 ? reading({ finishing: true }) : reading({}),
    });
    const first = await say("That's everything, please finish my setup.");
    expect(first.reply).toMatch(/^Before I can finish/u);
    // Their answer, saved as the background reading would.
    world.record("I10.inbound_preference", {
      type: "SINGLE_SELECT",
      optionKey: "qualified",
    });
    const second = await say("Only well-matched founders.");
    expect(second.reply).toMatch(/^Here's what I have saved:/u);
    expect(second.reply).not.toMatch(/team/u);
    // The read-back waits for their yes: nothing confirmed yet.
    expect(world.recordedValue("I11.review")).toBeUndefined();
  });
});
