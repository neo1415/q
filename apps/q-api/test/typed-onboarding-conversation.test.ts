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
import { createTypedOnboarding } from "../src/voice/typed-onboarding.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Owner 2026-10-28 (production re-test the same day): typed onboarding is
 * the voice line's conversation (DECISIONS 39). A typed line is kept in
 * the thread and read by meaning in the background; Q's reply is one model
 * call that records nothing; pausing and finishing are the delegation
 * reader's, answered from the record by code. No live model: the readers
 * and the reply are fakes saying what a live one would.
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

type Reply = { reply: string; asking?: string | null; readBack?: boolean };

/** Q's reply model: each call says the next scripted line. */
function replies(script: readonly Reply[]) {
  const seen: string[] = [];
  let index = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      const next = script[Math.min(index, script.length - 1)];
      index += 1;
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            reply: next?.reply ?? "",
            asking: next?.asking ?? null,
            readBack: next?.readBack ?? false,
          },
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

function transcriptReader(readings: Reading[]) {
  const seen: { role: string; text: string }[][] = [];
  const reader: OnboardingTranscriptReader = {
    read: (input) => {
      seen.push([...input.turns]);
      return Promise.resolve(
        readings.length > 1
          ? (readings.shift() ?? null)
          : (readings[0] ?? null),
      );
    },
  };
  return { reader, seen };
}

function typedWorld(options: {
  readonly world: ReturnType<typeof investorSession>;
  readonly readings?: Reading[];
  readonly script: readonly Reply[];
  readonly authority?: QTurnAuthority | (() => QTurnAuthority);
}) {
  const { reader, seen: read } = transcriptReader(
    options.readings ?? [{ answers: [], declined: [] }],
  );
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: options.world.fetch,
    logger,
    readAfterMs: 5,
    reader,
  });
  const { gateway, seen } = replies(options.script);
  const typed = createTypedOnboarding({
    conversation,
    gateway,
    delegation: readerOf(options.authority ?? reading({})),
    logger,
  });
  const say = async (words: string) => {
    const outcome = await typed.turn({
      ...turn(options.world, words),
      actor,
    });
    if (outcome === null) throw new Error("the typed path declined the turn");
    return outcome;
  };
  const flush = () =>
    conversation.flush?.({
      voiceSessionId: "typed:a",
      actor,
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      onboarding: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        journeyType: options.world.journey ?? "investor",
      },
    });
  return { say, read, seen, flush };
}

/** Until the background reading has read and saved (bounded). */
async function settled(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const SENTENCE =
  "I'm actively investing, pre-seed and seed, cheques in dollars from 25k up to 100k, we like to lead sometimes but mostly follow, stick closely to my mandate, I'm the managing partner, open to well-matched founders";

describe("typed onboarding is the conversation (owner 2026-10-28)", () => {
  it("the investor's sentence: kept in the thread, Q asks one next thing and records nothing; the reading saves 8 steps", async () => {
    const world = investorSession({
      currentStepKey: "I1.deployment_status",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
    });
    const answers: readonly (readonly [
      string,
      string | number | string[],
      string,
    ])[] = [
      ["I1.deployment_status", "actively_investing", "I'm actively investing"],
      ["I2.stages", ["pre_seed", "seed"], "pre-seed and seed"],
      ["I2.currency", "usd", "cheques in dollars"],
      ["I2.cheque_min", 25000, "from 25k"],
      ["I2.cheque_max", 100000, "up to 100k"],
      [
        "I2.investment_role",
        ["lead", "co_invest"],
        "we like to lead sometimes but mostly follow",
      ],
      ["I9.discovery_mode", "strict", "stick closely to my mandate"],
      ["I10.inbound_preference", "qualified", "open to well-matched founders"],
    ];
    const { say, seen } = typedWorld({
      world,
      readings: [
        {
          answers: answers.map(([stepKey, value, quote]) => ({
            stepKey,
            value,
            quote,
            ownWords: false,
          })),
          declined: [],
        },
      ],
      script: [
        {
          reply:
            "Thanks, that's a clear picture. Which sectors do you focus on?",
          asking: "I3.sectors",
        },
      ],
    });
    const outcome = await say(SENTENCE);
    expect(outcome.reply).toBe(
      "Thanks, that's a clear picture. Which sectors do you focus on?",
    );
    expect(outcome.recorded).toEqual([]);
    expect(outcome.asking?.stepKey).toBe("I3.sectors");
    // One model call for the reply; the checklist and the thread went in.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("PERSON: I'm actively investing");
    // Their line and Q's are in the thread, typed.
    await settled(() => world.thread().length >= 2);
    expect(world.thread().map((t) => t.role)).toEqual(["PERSON", "Q"]);
    // Live e11: Q's line is kept with the step it asked, so a reopening
    // asks the question the conversation had open.
    expect(world.keptSteps()).toEqual([null, "I3.sectors"]);
    await settled(
      () => world.recordedValue("I10.inbound_preference") !== undefined,
    );
    const saved = answers.filter(
      ([stepKey]) => world.recordedValue(stepKey) !== undefined,
    );
    expect(saved.length).toBeGreaterThanOrEqual(8);
    expect(world.recordedValue("I2.investment_role")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["lead", "co_invest"],
    });
  });

  it("a correction supersedes: the latest settled word is saved", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
        "I2.currency": "usd",
        "I2.cheque_min": "25000",
      },
    });
    const { say } = typedWorld({
      world,
      readings: [
        {
          answers: [
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
      script: [
        { reply: "Got it, 50k up. Which sectors?", asking: "I3.sectors" },
      ],
    });
    await say("actually sorry, make that 50 to 100k, not 25");
    await settled(
      () =>
        JSON.stringify(world.recordedValue("I2.cheque_min")) ===
        JSON.stringify({ type: "RANGE", value: "50000" }),
    );
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "50000",
    });
  });

  it('"that\'s all" finishes: nothing is recorded as an answer, and the open things are named', async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
    });
    const { say } = typedWorld({
      world,
      script: [{ reply: "Sure.", asking: "I2.stages" }],
      authority: reading({ finishing: true }),
    });
    const outcome = await say("that's all");
    expect(outcome.reply).toMatch(/^Before I can finish, I still need /u);
    // Re-test #3: the open count and the first one's own question, never
    // field labels ("discovery and inbound").
    expect(outcome.reply).toMatch(/\d+ more answers from you/u);
    expect(outcome.reply).toMatch(/\?$/u);
    expect(outcome.navigate).toBeNull();
    // "that's all" is nobody's answer.
    expect(world.attempts()).toEqual([]);
    expect(outcome.view.session.status).toBe("ACTIVE");
  });

  it("finishing reads the whole record back first, and completes on their yes (the snapshot is never confirmed unseen)", async () => {
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
              : "Harmattan Angels";
    }
    const world = investorSession({
      currentStepKey: "I9.discovery_mode",
      recorded,
      subject: FIRM,
    });
    const { say } = typedWorld({
      world,
      script: [{ reply: "Sure." }],
      authority: reading({ finishing: true }),
    });
    const first = await say("that's all");
    expect(first.reply).toMatch(/^Here's what I have saved:\n/u);
    expect(first.asking?.stepKey).toBe("I11.review");
    expect(world.recordedValue("I11.review")).toBeUndefined();
    expect(first.view.session.status).toBe("ACTIVE");
    const second = await say("yes, that's right, finish");
    expect(second.view.session.status).toBe("COMPLETED");
    expect(second.navigate).toBe("DISCOVER");
    expect(second.reply).toMatch(/saved and live/u);
  });

  it('"skip that" sets an optional topic aside and the next question follows', async () => {
    const world = investorSession({
      currentStepKey: "I8.portfolio",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
    });
    const { say } = typedWorld({
      world,
      readings: [
        {
          answers: [],
          declined: [{ stepKey: "I8.portfolio", quote: "skip that" }],
        },
      ],
      script: [
        {
          reply: "No problem. Which stages do you like to back?",
          asking: "I2.stages",
        },
      ],
    });
    const outcome = await say("skip that");
    expect(outcome.asking?.stepKey).toBe("I2.stages");
    await settled(() => world.skippedSteps().includes("I8.portfolio"));
    expect(world.skippedSteps()).toContain("I8.portfolio");
  });

  it('"what do you have so far" is read back from the record, after what they said is saved', async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
    });
    const { say } = typedWorld({
      world,
      script: [{ reply: "Here's where we are.", readBack: true }],
    });
    const outcome = await say("what do you have so far?");
    expect(outcome.reply).toMatch(/^Here's where we are\. Saved so far: /u);
    expect(outcome.reply).toContain("Harmattan Angels");
    expect(outcome.reply).toMatch(/Still to cover: .*stages/iu);
  });

  it('"I\'ll continue this later": one line of what is saved and open, and into the app', async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
    });
    const { say } = typedWorld({
      world,
      script: [{ reply: "Sure, see you later." }],
      authority: reading({ pausing: true }),
    });
    const outcome = await say("I'll continue this later");
    expect(outcome.reply).toMatch(/^Of course\. /u);
    expect(outcome.reply).not.toMatch(/\?/u);
    expect(outcome.navigate).toBe("DISCOVER");
    expect(outcome.pausing).toBe(true);
    expect(outcome.view.session.status).toBe("ACTIVE");
  });
});
