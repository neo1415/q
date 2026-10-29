import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import {
  INVESTOR_DEFINITION_V1,
  INVESTOR_STEPS,
  stageChequePatch,
} from "@capital-q/investor-onboarding";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  briefOf,
  createOnboardingConversation,
  openingOf,
  readBack,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";
import { SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";
import { reading } from "./authority-fixtures.js";
import { investorSession, type InvestorWorld } from "./interviewer-fixtures.js";

/** Every required spoken answer, valid for its step; reviews left open. */
const SPOKEN_REQUIRED: Readonly<Record<string, string>> = Object.fromEntries(
  INVESTOR_DEFINITION_V1.steps
    .filter(
      (step) => step.required && step.configuration.stepType !== "confirmation",
    )
    .map((step) => {
      const c = step.configuration;
      const value =
        c.stepType === "single_select" || c.stepType === "multi_select"
          ? (c.options[0]?.optionKey ?? "x")
          : c.stepType === "range"
            ? c.min
            : c.stepType === "reference_select"
              ? "a0000000-0000-4000-8000-000000000099"
              : "value";
      return [step.stepKey, value] as const;
    }),
);

/**
 * Owner 2026-10-27: voice onboarding is a conversation first. Q talks;
 * what is said is kept in the onboarding thread as it is said, and the
 * whole thread is read by meaning and saved through the checked path,
 * shortly after each thing they say and again when the line ends. No
 * live model: the reading is a fake that returns what a reading of the
 * conversation would, and asserts it was given the whole conversation.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

type Kept = {
  role: "PERSON" | "Q";
  text: string;
  channel: string;
  createdAt?: string;
};

/** The world's onboarding service, plus the interview thread it keeps. */
function withThread(world: InvestorWorld) {
  const thread: Kept[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : (input as Request).url,
    );
    if (url.pathname.endsWith("/turns")) {
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as {
          turns: { role: "PERSON" | "Q"; text: string; channel: string }[];
        };
        // Stamped when written, as the API does: a turn said after an
        // answer was saved is newer than it.
        const at = new Date().toISOString();
        thread.push(...body.turns.map((turn) => ({ ...turn, createdAt: at })));
        return Response.json({ written: true }, { status: 201 });
      }
      const limit = Number(url.searchParams.get("limit") ?? "100");
      return Response.json({
        items: thread.slice(-limit),
      });
    }
    return world.fetch(input, init);
  };
  return { thread, fetch };
}

function line(): ConversationLine {
  return {
    voiceSessionId: "1200506d-494e-4a34-be3a-681e50b9c208",
    actor,
    accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
    onboarding: { sessionId: SESSION_ID, journeyType: "investor" },
  };
}

function readerReturning(
  reading: Awaited<ReturnType<OnboardingTranscriptReader["read"]>>,
  seen: { turns: { role: string; text: string }[] }[] = [],
): OnboardingTranscriptReader {
  return {
    read: (input) => {
      seen.push({ turns: [...input.turns] });
      return Promise.resolve(reading);
    },
  };
}

async function stateOf(world: InvestorWorld) {
  return createOnboardingPort({
    session: {
      baseUrl: "http://api.test",
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      fetch: world.fetch,
    },
    onboardingSessionId: SESSION_ID,
    journeyType: "investor",
    ownerUserId: actor.userId,
    personTurns: [],
  }).state();
}

describe("voice onboarding as a conversation (owner 2026-10-27)", () => {
  it("opens with a real introduction and a plain first question, built by code", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const opening = openingOf({
      state: await stateOf(world),
      firstName: "Tiara",
      resumed: false,
    });
    expect(opening).toMatch(
      /^Hi Tiara, I'm Q, your analyst here at Capital Q\./,
    );
    expect(opening).toContain("investment mandate");
    expect(opening).toContain("stop any time and pick up later");
    expect(opening).toContain("the form's right there");
    // Never the bare form label (live: "How do you invest?" alone).
    expect(opening).toContain(
      "How do you invest: as an angel, through a fund, a family office, an accelerator, or something else?",
    );
  });

  it("welcomes them back and carries on where they left off", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: { "I0.investor_type": "accelerator" },
    });
    const opening = openingOf({
      state: await stateOf(world),
      firstName: "Tiara",
      resumed: true,
    });
    expect(opening).toMatch(/^Welcome back, Tiara\./);
    expect(opening).not.toContain("I'm Q");
    expect(opening).not.toContain("How do you invest");
  });

  it("gives the voice a checklist of topics, never 'How firm is that?' on its own", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: { "I0.investor_type": "accelerator" },
    });
    const brief = briefOf(await stateOf(world));
    expect(brief).toContain("not a script");
    expect(brief).toMatch(/How do you invest.*already saved: Accelerator/);
    expect(brief).toMatch(/Needed: Which stages do you like to back/);
    expect(brief).not.toMatch(/: How firm is that\?/);
    expect(brief).toMatch(
      /How firm is that preference \(about: Where do you invest/,
    );
  });

  it("keeps the call in the thread and saves it from the whole transcript, latest word winning (live 2026-10-27)", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { thread, fetch } = withThread(world);
    const seen: { turns: { role: string; text: string }[] }[] = [];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning(
        {
          answers: [
            {
              stepKey: "I2.stages",
              value: ["pre_seed", "seed", "series_a"],
              quote: "mainly do series A and er pre-seed and seed",
              ownWords: false,
            },
            {
              // Their correction, not the first answer.
              stepKey: "I0.investor_type",
              value: "vc",
              quote: "we're a fund actually, not an accelerator",
              ownWords: false,
            },
          ],
          declined: [],
        },
        seen,
      ),
    });
    const call = line();
    // As the line reports it: fragments, in order.
    conversation.heard(call, [
      { role: "Q", text: "Hi, Tiara, I'm Q." },
      { role: "Q", text: "How do you invest?" },
      {
        role: "USER",
        text: "What do you mean by that question Okay, mm- I- I- I- er- mainly do series A and er pre-seed and seed",
      },
      { role: "Q", text: "Got it. Angel, fund, family office?" },
      { role: "USER", text: "Accelerator" },
      { role: "Q", text: "Nice." },
      {
        role: "USER",
        text: "Sorry, we're a fund actually, not an accelerator",
      },
    ]);
    await conversation.ended(call);

    // Fragments became whole utterances, in order, on the voice channel.
    expect(thread.map((t) => `${t.role}: ${t.text}`)).toEqual([
      "Q: Hi, Tiara, I'm Q. How do you invest?",
      "PERSON: What do you mean by that question Okay, mm- I- I- I- er- mainly do series A and er pre-seed and seed",
      "Q: Got it. Angel, fund, family office?",
      "PERSON: Accelerator",
      "Q: Nice.",
      "PERSON: Sorry, we're a fund actually, not an accelerator",
    ]);
    expect(thread.every((t) => t.channel === "VOICE")).toBe(true);
    // The reading was given the whole conversation, not the latest turn.
    expect(seen.at(-1)?.turns).toHaveLength(6);
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed", "series_a"],
    });
    expect(world.recordedValue("I0.investor_type")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "vc",
    });
  });

  it("re-reading an answer already on record writes nothing (live 2026-10-28: rewritten on every reading)", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: { "I0.investor_type": "accelerator" },
    });
    world.record("I2.stages", {
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
    const { fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({
        answers: [
          {
            stepKey: "I0.investor_type",
            value: "accelerator",
            quote: "We're an accelerator",
            ownWords: false,
          },
          {
            stepKey: "I2.stages",
            value: ["seed", "pre_seed"],
            quote: "Just pre-seed and seed",
            ownWords: false,
          },
        ],
        declined: [],
      }),
    });
    const call = line();
    conversation.heard(call, [
      { role: "USER", text: "We're an accelerator" },
      { role: "Q", text: "Got it." },
      { role: "USER", text: "Just pre-seed and seed" },
    ]);
    await conversation.ended(call);
    expect(world.attempts()).toEqual([]);
  });

  it("never saves words the person did not say, whatever the reading claims", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      taxonomy: { kenya: "a0000000-0000-4000-8000-0000000000ee" },
    });
    const { fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({
        answers: [
          {
            // Q's words, not theirs.
            stepKey: "I0.investor_type",
            value: "angel",
            quote: "Are you an angel investor?",
            ownWords: false,
          },
        ],
        declined: [],
      }),
    });
    const call = line();
    conversation.heard(call, [
      { role: "Q", text: "Are you an angel investor?" },
      { role: "USER", text: "Can you tell me more about Capital Q first?" },
    ]);
    await conversation.ended(call);
    expect(world.recordedValue("I0.investor_type")).toBeUndefined();
  });

  it("reads back from the record, not from memory, when the voice asks", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: { "I0.investor_type": "accelerator" },
    });
    const { fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({ answers: [], declined: [] }),
    });
    const { commentary: said } = await conversation.settle(
      line(),
      "What do you have so far?",
    );
    expect(said).toContain("From Capital Q's own records");
    expect(said).toMatch(/Saved: .*Accelerator/);
    expect(said).toMatch(/Still needed: .*Which stages do you like to back/);
    expect(readBack(await stateOf(world))).toBe(said);
  });

  it("finishes on their word once everything needed is in, the reviews confirmed by finish itself", async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      recorded: SPOKEN_REQUIRED,
    });
    const { fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({ answers: [], declined: [] }),
      delegation: {
        read: () => Promise.resolve(reading({ finishing: true })),
      },
    });
    const { commentary: said } = await conversation.settle(
      line(),
      "Yes, that's all right, let's finish",
    );
    expect(said).toContain("Their mandate is saved and live");
    expect(said).not.toMatch(/on screen/);
    expect(world.recordedValue("I11.review")).toEqual({
      type: "CONFIRMATION",
      confirmed: true,
    });
  });

  it("stopping for now keeps everything and says so", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: { "I0.investor_type": "accelerator" },
    });
    const { fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({ answers: [], declined: [] }),
      delegation: { read: () => Promise.resolve(reading({ pausing: true })) },
    });
    const { commentary: said, leave } = await conversation.settle(
      line(),
      "Can we continue this later?",
    );
    expect(said).toContain("They want to stop for now");
    expect(said).toContain("pick up any time");
    expect(said).toContain("to Discover");
    // The call ends after the goodbye and they go into Capital Q.
    expect(leave).toBe(true);
  });

  it("starts research on their firm as Q introduces itself, and again once its name is saved", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { fetch } = withThread(world);
    const considered: { firmName: string; personName?: string | null }[] = [];
    const research = {
      consider: (request: {
        readonly identity: { firmName: string; personName?: string | null };
      }) => {
        considered.push({
          firmName: request.identity.firmName,
          personName: request.identity.personName ?? null,
        });
        return true;
      },
      offerReady: () => Promise.resolve(0),
      status: () => "IDLE",
      unsaid: () => new Set<string>(),
    } as unknown as NonNullable<
      Parameters<typeof createOnboardingConversation>[0]["research"]
    >["investor"];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      research: { investor: research },
      reader: readerReturning({
        answers: [
          {
            stepKey: "I0.organisation_name",
            value: "Vaultlyne Capital",
            quote: "Vaultlyne Capital",
            ownWords: false,
          },
        ],
        declined: [],
      }),
    });
    await conversation.opening({
      actor,
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      onboarding: { sessionId: SESSION_ID, journeyType: "investor" },
      firstName: "Tiara",
      displayName: "Tiara Ade",
      organisationName: "The Vaultlyne",
    });
    expect(considered).toEqual([
      { firmName: "The Vaultlyne", personName: "Tiara Ade" },
    ]);
    const call = line();
    conversation.heard(call, [
      { role: "Q", text: "What's your firm called?" },
      { role: "USER", text: "Vaultlyne Capital" },
    ]);
    await conversation.ended(call);
    expect(considered.at(-1)?.firmName).toBe("Vaultlyne Capital");
  });

  it("a reading that fails saves nothing and loses nothing: the thread is kept", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { thread, fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning(null),
    });
    const call = line();
    conversation.heard(call, [
      { role: "Q", text: "How do you invest?" },
      { role: "USER", text: "Accelerator" },
    ]);
    await conversation.ended(call);
    expect(thread.map((t) => t.text)).toEqual([
      "How do you invest?",
      "Accelerator",
    ]);
    expect(world.recordedValue("I0.investor_type")).toBeUndefined();
  });
});

/** Every required answer in except the last two, and the cheques: Tiara's call. */
const TIARA_SO_FAR: Readonly<Record<string, string>> = Object.fromEntries([
  ...Object.entries(SPOKEN_REQUIRED).filter(
    ([key]) =>
      key !== INVESTOR_STEPS.discoveryMode &&
      key !== INVESTOR_STEPS.inboundPreference,
  ),
  [INVESTOR_STEPS.businessTitle, "Partner"],
  [INVESTOR_STEPS.chequeMin, "1000000"],
  [INVESTOR_STEPS.chequeTypical, "3000000"],
  [INVESTOR_STEPS.chequeMax, "10000000"],
]);

describe("voice onboarding, owner live run 2026-10-28 (Tiara)", () => {
  it("a currency named twice keeps the first as the answer, notes the second, and never saves her sentence", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.currency,
      recorded: { [INVESTOR_STEPS.investorType]: "vc" },
    });
    world.record(INVESTOR_STEPS.chequeMin, { type: "RANGE", value: "1000000" });
    world.record(INVESTOR_STEPS.chequeMax, {
      type: "RANGE",
      value: "10000000",
    });
    const { fetch } = withThread(world);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({
        answers: [
          {
            stepKey: INVESTOR_STEPS.currency,
            value: ["usd", "gbp"],
            quote: "I do the dollars and Um, pounds",
            ownWords: false,
          },
        ],
        declined: [],
      }),
    });
    const call = line();
    conversation.heard(call, [
      { role: "Q", text: "What currency do you usually write in?" },
      { role: "USER", text: "Uh- e-uh I do the dollars and Um, pounds" },
    ]);
    await conversation.ended(call);
    expect(world.recordedValue(INVESTOR_STEPS.currency)).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "usd",
    });
    expect(world.recordedNote(INVESTOR_STEPS.currency)).toMatch(
      /^Also named: Pound sterling\..*ask which is their main one/,
    );
    // Q is told, from the record, to ask which one is the main one.
    const said = readBack(await stateOf(world));
    expect(said).toMatch(/US dollar \(Also named: Pound sterling/);
    // The mandate row gets its currency and cheque amounts from it.
    const values = new Map(
      [
        INVESTOR_STEPS.currency,
        INVESTOR_STEPS.chequeMin,
        INVESTOR_STEPS.chequeMax,
      ].flatMap((key) => {
        const value = world.recordedValue(key);
        return value === undefined ? [] : [[key, value] as const];
      }),
    ) as unknown as Parameters<typeof stageChequePatch>[0];
    expect(stageChequePatch(values).chequeRange).toEqual({
      currency: "USD",
      min: "1000000",
      max: "10000000",
    });
  });

  it("a currency in no option's words is handed back with the options, never kept as free text", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.currency,
      recorded: { [INVESTOR_STEPS.investorType]: "vc" },
    });
    const said = "We write cheques in seashells.";
    const [result] = await createOnboardingPort({
      session: {
        baseUrl: "http://api.test",
        accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
        fetch: world.fetch,
      },
      onboardingSessionId: SESSION_ID,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () =>
        Promise.resolve({
          stated: new Set([INVESTOR_STEPS.currency]),
          declined: new Set<string>(),
          handed: new Set<string>(),
          approved: new Set<string>(),
          finishing: false,
          lookup: null,
        }),
    }).record([
      {
        stepKey: INVESTOR_STEPS.currency,
        value: "seashells",
        quote: said,
        basis: "STATED",
        ownWords: true,
      },
    ]);
    expect(result?.outcome).toBe("UNMATCHED");
    expect(result?.candidates?.some((c) => c.includes("US dollar"))).toBe(true);
    expect(world.recordedValue(INVESTOR_STEPS.currency)).toBeUndefined();
  });

  it("the typed checklist carries each topic's id; voice's never does (live 2026-10-29)", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.hardExclusions,
    });
    const state = await stateOf(world);
    expect(briefOf(state, { withIds: true })).toContain(
      `(id: ${INVESTOR_STEPS.hardExclusions})`,
    );
    expect(briefOf(state)).not.toContain("(id: ");
  });

  it("briefOf lists the optional topics in groups, every one to be asked", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.investmentRole,
      recorded: TIARA_SO_FAR,
    });
    const brief = briefOf(await stateOf(world));
    expect(brief).toContain("Optional topics, grouped");
    expect(brief).toMatch(/- Group 1: .*lead rounds/);
    expect(brief).toMatch(/- Group 2: /);
    expect(brief).toContain(
      "Finish only when every topic has been asked or they declined it, or they ask to finish.",
    );
  });

  it("a resumed call carries on in setup order, optional steps included (the question the line dropped is asked again)", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.discoveryMode,
      recorded: TIARA_SO_FAR,
    });
    const opening = openingOf({
      state: await stateOf(world),
      firstName: "Tiara",
      resumed: true,
    });
    expect(opening).toContain(
      SPOKEN_QUESTIONS[INVESTOR_STEPS.investmentRole] ?? "missing",
    );
    expect(opening).not.toContain(
      SPOKEN_QUESTIONS[INVESTOR_STEPS.discoveryMode] ?? "missing",
    );
  });

  it("the read-back counts the optional topics left until each is asked or declined", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.investmentRole,
      recorded: SPOKEN_REQUIRED,
    });
    const state = await stateOf(world);
    const said = readBack(state);
    expect(said).toMatch(/The essentials are in\. \d+ optional topics left/);
    expect(said).not.toContain("Everything needed is in");
    expect(said).toContain("Do not wrap up yet");
    const declinedAll = readBack({
      ...state,
      steps: state.steps.map((step) =>
        step.required || step.status !== "OPEN"
          ? step
          : { ...step, status: "SET_ASIDE" as const },
      ),
    });
    expect(declinedAll).toContain("Everything needed is in");
    expect(declinedAll).toContain("whether they'd like to finish");
  });

  it("a list said in two goes adds up; a reading that replaces the list replaces it", async () => {
    const run = async (replaces: boolean) => {
      const world = investorSession({
        currentStepKey: INVESTOR_STEPS.hardExclusions,
        recorded: { [INVESTOR_STEPS.investorType]: "vc" },
      });
      world.record(INVESTOR_STEPS.hardExclusions, {
        type: "MULTI_SELECT",
        optionKeys: ["crypto_speculation", "gambling"],
      });
      const { fetch } = withThread(world);
      const conversation = createOnboardingConversation({
        apiBaseUrl: "http://api.test",
        fetch,
        logger,
        readAfterMs: 5,
        reader: readerReturning({
          answers: [
            {
              stepKey: INVESTOR_STEPS.hardExclusions,
              value: ["adult_content"],
              quote: "adult content as well",
              ownWords: false,
              replaces,
            },
          ],
          declined: [],
        }),
      });
      const call = line();
      conversation.heard(call, [
        { role: "Q", text: "Anything you never want to see?" },
        { role: "USER", text: "adult content as well" },
      ]);
      await conversation.ended(call);
      return world.recordedValue(INVESTOR_STEPS.hardExclusions);
    };
    expect(await run(false)).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["crypto_speculation", "gambling", "adult_content"],
    });
    expect(await run(true)).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content"],
    });
  });

  it("finishing takes them into Capital Q, and so does anything asked once setup is done", async () => {
    const world = investorSession({
      currentStepKey: INVESTOR_STEPS.review,
      recorded: SPOKEN_REQUIRED,
    });
    const { fetch } = withThread(world);
    let finishing = true;
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({ answers: [], declined: [] }),
      delegation: {
        read: () => Promise.resolve(reading({ finishing })),
      },
    });
    const finished = await conversation.settle(line(), "That's done");
    expect(finished.leave).toBe(true);
    expect(finished.commentary).toContain("taking them to Discover");
    finishing = false;
    const later = await conversation.settle(
      line(),
      "can you now take me to my Discover page",
    );
    expect(later.leave).toBe(true);
    expect(later.commentary).toContain("already finished");
    expect(later.commentary).toContain("to Discover");
  });
});
