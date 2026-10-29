import { describe, expect, it } from "vitest";

import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QTurnAuthority,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import { createOnboardingConversation } from "../src/voice/onboarding-conversation.js";
import {
  createTypedOnboarding,
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

function typedWorld(options: {
  readonly world: ReturnType<typeof investorSession>;
  readonly authority: () => QTurnAuthority;
}) {
  const reader: OnboardingTranscriptReader = {
    read: () => Promise.resolve({ answers: [], declined: [] }),
  };
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: options.world.fetch,
    logger,
    readAfterMs: 5,
    reader,
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
