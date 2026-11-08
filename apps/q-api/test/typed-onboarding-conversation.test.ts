import { describe, expect, it } from "vitest";

import {
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_DEFINITION_V1,
} from "@capital-q/investor-onboarding";
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
    // As production wires it: a held value (an inference, or a figure for
    // its read-back, D-OWN-3) waits there for their yes.
    recommendations: options.world.recommendations,
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
  it("the investor's sentence: kept in the thread, Q asks one next thing and records nothing; the reading saves what they stated and holds the figures for their read-back (D-OWN-3)", async () => {
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
    await settled(() => world.recordedValue("I9.discovery_mode") !== undefined);
    const saved = answers.filter(
      ([stepKey]) => world.recordedValue(stepKey) !== undefined,
    );
    // Live final re-check 2026-10-31: whether they are deploying now and
    // how open they are to founders are judgements about their current
    // state (askOnly): said unasked, they are held for their yes, never
    // read in. D-OWN-3 (DECISIONS 78): the cheque figures are read back for
    // their yes, so they are held too; the other four are saved.
    expect(saved.map(([stepKey]) => stepKey)).toEqual([
      "I2.stages",
      "I2.currency",
      "I2.investment_role",
      "I9.discovery_mode",
    ]);
    expect(
      world
        .heldSuggestions()
        .filter((s) => s.stepKey.startsWith("I2.cheque_"))
        .map((s) => [s.stepKey, s.value]),
    ).toEqual([
      ["I2.cheque_min", { type: "RANGE", value: "25000" }],
      ["I2.cheque_max", { type: "RANGE", value: "100000" }],
    ]);
    expect(world.recordedValue("I1.deployment_status")).toBeUndefined();
    expect(world.recordedValue("I10.inbound_preference")).toBeUndefined();
    expect(world.recordedValue("I2.investment_role")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["lead", "co_invest"],
    });
  });

  it("a correction is held for its read-back; the record keeps the earlier figure until their yes (D-OWN-3)", async () => {
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
              // A correction of what they said for it (v6 reading).
              aboutStep: true,
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
    await settled(() =>
      world.heldSuggestions().some((s) => s.stepKey === "I2.cheque_min"),
    );
    // D-OWN-3 (DECISIONS 78): a number is read back for their yes, always;
    // the correction is held as exactly the figure they gave, and the
    // record keeps the earlier one until they agree.
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "25000",
    });
    expect(
      world.heldSuggestions().find((s) => s.stepKey === "I2.cheque_min")?.value,
    ).toEqual({ type: "RANGE", value: "50000" });
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

  it('"skip that" on a mandatory list answers it "None" (batch 7), and the next question follows', async () => {
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
    await settled(() => world.recordedValue("I8.portfolio") !== undefined);
    expect(world.recordedValue("I8.portfolio")).toEqual({
      type: "TEXT",
      text: "None",
    });
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
    // Sweep D7: the record, from code, with the setup's own labels; the
    // model's line is not put around it.
    expect(outcome.reply).toMatch(/^Here's what I have saved so far:\n\n/u);
    expect(outcome.reply).not.toContain("Here's where we are");
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

/**
 * e2e run 6 (production batch 10): "Are those musts, or more of a
 * preference?" was asked 13 times, word for word, to "Yes, that's right.
 * That's all for now." DECISIONS 77: a needed question is asked once more
 * with why and its choices, then left for now; never looped.
 */
describe("a needed question is never looped word for word (e2e run 6)", () => {
  it("plain, then with why and its choices, then another one -- never the same line twice", async () => {
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
    const nonAnswer = "Yes, that's right. That's all for now.";
    const first = await say(nonAnswer);
    const second = await say(nonAnswer);
    const third = await say(nonAnswer);
    expect(first.asking?.stepKey).toBeDefined();
    const asked = first.asking?.stepKey;
    // Once more for the same step: why, and its choices, never verbatim.
    expect(second.asking?.stepKey).toBe(asked);
    expect(second.reply).not.toBe(first.reply);
    expect(second.reply).toMatch(/^Just so I can match you well/u);
    // Then it is left for now: another needed one is asked instead.
    expect(third.asking?.stepKey).not.toBe(asked);
    expect(new Set([first.reply, second.reply, third.reply]).size).toBe(3);
  });
});

/**
 * e2e run 8 (production batch 12): every needed answer was in, Q wrote
 * "That's all set …" and asked nothing, and nothing finished. A reply that
 * asks nothing, once nothing needed is open, goes on to the finish: the
 * read-back for their yes.
 */
describe("all answered: a reply that asks nothing goes on to the finish (e2e run 8)", () => {
  it("Q's line leads the read-back for their yes", async () => {
    const steps = INVESTOR_DEFINITION_CURRENT.steps.filter((step) =>
      ["I0.organisation_name", "I11.review"].includes(step.stepKey),
    );
    const world = investorSession({
      steps,
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: { "I0.organisation_name": "Harmattan Angels" },
    });
    const { say } = typedWorld({
      world,
      script: [{ reply: "That's all set.", asking: null }],
    });
    const outcome = await say("No, that's everything.");
    expect(outcome.reply).toMatch(/^That's all set\./u);
    expect(outcome.reply).toMatch(/Here's what I have saved/u);
    expect(outcome.reply).toMatch(/Is that all right\?/u);
  });
});

/**
 * e2e run 8 (founder): "What are your approximate gross margin, monthly
 * spend…?" asked seven times, reworded each time, to an unrelated answer.
 * DECISIONS 77, whoever words it: the third time, its reason once, then it
 * is left for now and the next one is asked.
 */
describe("a needed step Q's own replies keep asking is left for now (e2e run 8)", () => {
  it("twice as written, then its reason once and the next question; never a fourth", async () => {
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
      script: [
        {
          reply: "Got it. Which stages do you invest in?",
          asking: "I2.stages",
        },
        {
          reply: "Thanks. And which stages do you back?",
          asking: "I2.stages",
        },
        {
          reply: "Understood. What stages are you investing at?",
          asking: "I2.stages",
        },
        { reply: "Sure. Which stages, again?", asking: "I2.stages" },
      ],
    });
    const first = await say("Product and hiring.");
    const second = await say("Product and hiring.");
    const third = await say("Product and hiring.");
    const fourth = await say("Product and hiring.");
    expect(first.asking?.stepKey).toBe("I2.stages");
    expect(second.asking?.stepKey).toBe("I2.stages");
    expect(third.reply).toMatch(/let's leave it for now/u);
    expect(third.reply).not.toMatch(/What stages are you investing at\?/u);
    expect(third.asking?.stepKey).not.toBe("I2.stages");
    // Asked again anyway: the next one is asked instead.
    expect(fourth.asking?.stepKey).not.toBe("I2.stages");
    expect(fourth.reply).not.toMatch(/Which stages, again\?/u);
  });
});
