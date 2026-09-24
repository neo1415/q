import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * Material values are read back, and the runtime owns the reading back
 * (QX-004 core gate §5).
 *
 * Money is confirmed before it is recorded, which is deliberate: a cheque
 * range is what an investor is matched on. The failure was not the rule
 * but who enforced it. The runtime held the value; the model chose the
 * question; and the two came apart. Live, asked for a minimum cheque, the
 * person said "around seventy-five thousand"; Q replied "Got it — minimum
 * cheque is around seventy-five thousand dollars" and asked for the
 * typical cheque instead. The value sat pending, nobody confirmed it,
 * every later answer was refused for wanting it, and the journey stopped
 * with Q having said "got it".
 *
 * So the runtime asks for what the runtime is holding. These drive the
 * three ways that conversation can go — yes, a correction, and no — and
 * the fourth case that broke it: a person who answers something else
 * entirely while a value is waiting.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-22T09:00:00.000Z";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

/** A founder session sitting on a material step: the target amount. */
function view(recorded: Record<string, string> = {}): OnboardingSessionView {
  return {
    session: {
      id: SESSION_ID,
      journeyType: "founder",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: 2,
      status: "ACTIVE",
      subject: null,
      currentStepKey: "F6.target_amount",
      version: 3,
      startedAt: NOW,
      lastActivityAt: NOW,
      completedAt: null,
    },
    phases: [],
    currentStep: {
      stepKey: "F6.target_amount",
      stepType: "range",
      required: false,
      prompt: "How much are you raising?",
      presentation: {
        stepType: "range",
        min: "0",
        max: "100000000",
        unit: "USD",
      },
    },
    progress: {
      currentStepKey: "F6.target_amount",
      currentPhaseKey: null,
      eligibleSteps: [
        {
          stepKey: "F6.target_amount",
          required: false,
          status:
            recorded["F6.target_amount"] === undefined
              ? "IN_PROGRESS"
              : "COMPLETED",
        },
      ],
      eligibleStepCount: 1,
      completedEligibleStepCount: Object.keys(recorded).length,
      canGoBack: false,
      canSkipCurrentStep: true,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: Object.entries(recorded).map(([stepKey, text], index) => ({
      id: `33333333-3333-4333-8333-00000000000${String(index)}`,
      stepKey,
      responseType: "TEXT",
      value: { type: "TEXT", text },
      sourceModality: "TYPED_TEXT",
      createdAt: NOW,
    })),
    pendingQuestions: [],
  } as unknown as OnboardingSessionView;
}

/** Records what was written, so a test can assert on the record itself. */
function api() {
  const written: { stepKey: string; value: unknown }[] = [];
  const state: Record<string, string> = {};
  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";
    if (url.includes("/taxonomy/")) {
      return Promise.resolve(Response.json({ candidates: [] }));
    }
    if (method === "POST" && url.includes("/responses")) {
      const raw = typeof init?.body === "string" ? init.body : "{}";
      const body: unknown = JSON.parse(raw);
      const parsed = body as {
        stepKey: string;
        response: { value: { value?: string; text?: string } };
      };
      written.push({ stepKey: parsed.stepKey, value: parsed.response.value });
      state[parsed.stepKey] =
        parsed.response.value.value ?? parsed.response.value.text ?? "";
      return Promise.resolve(Response.json(view(state)));
    }
    return Promise.resolve(Response.json(view(state)));
  };
  return { fetchFake, written, state };
}

const base: InterviewConductorResult = {
  reply: "",
  intent: "ANSWER",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: null,
  showOptions: false,
  questionForQ: null,
  answerFromState: null,
  navigate: null,
  lookup: null,
  pronounce: null,
  skipRemainingOptional: false,
  unrestricted: [],
  frustrated: false,
  reading: null,
};

/** A gateway that returns each queued result in turn. */
function gateway(...results: readonly InterviewConductorResult[]) {
  const queue = [...results];
  const seen: InterviewConductorResult[] = [];
  const port: InterviewGateway = {
    execute: () => {
      const next = queue.shift() ?? base;
      seen.push(next);
      return Promise.resolve({
        output: { kind: "STRUCTURED", value: next },
      } as never);
    },
  };
  return port;
}

function turn(fetchFake: typeof fetch, utterance: string) {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      fetch: fetchFake,
    },
    onboardingSessionId: SESSION_ID,
    journeyType: "founder" as const,
    channel: "voice" as const,
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      correlationId: "cor_test",
    },
    utterance,
    recentTurns: [],
  };
}

const proposes = (value: string): InterviewConductorResult => ({
  ...base,
  reply: `${value}, got it. What does the company do?`,
  answers: [
    {
      stepKey: "F6.target_amount",
      value,
      confidence: "HIGH",
      clarity: "SETTLED",
    },
  ],
});

describe("a material value waits for a yes", () => {
  it("is not written until it is confirmed, and the runtime asks", async () => {
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway(proposes("500000")),
      logger,
    });

    const held = await interviewer.turn(turn(fetchFake, "Half a million."));
    // Nothing is on the record yet.
    expect(written).toEqual([]);
    expect(held.recorded).toEqual([]);
    // And Q asks about the value it is holding, not about the next step.
    expect(held.asking?.stepKey).toBe("F6.target_amount");
    // Read back the way a person says it. The canonical 500000 is what
    // reaches the owning service; it is not what reaches the person
    // (Workstream A).
    expect(held.reply).toContain("500,000");
    expect(held.reply).not.toMatch(/\b500000\b/);
    expect(held.reply.toLowerCase()).toContain("is that right");
    // The model wanted to move on. It does not get to.
    expect(held.reply).not.toContain("What does the company do");
  });

  it("writes it once they say yes, and only then", async () => {
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway(proposes("500000"), {
        ...base,
        reply: "Five hundred thousand, confirmed.",
        confirmations: [{ stepKey: "F6.target_amount", decision: "CONFIRMED" }],
      }),
      logger,
    });

    await interviewer.turn(turn(fetchFake, "Half a million."));
    const done = await interviewer.turn(turn(fetchFake, "Yes, that's right."));
    expect(done.recorded).toContain("F6.target_amount");
    expect(written).toHaveLength(1);
    expect(written[0]?.stepKey).toBe("F6.target_amount");
  });

  it("takes a correction during confirmation, and writes only the corrected value", async () => {
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway(
        proposes("500000"),
        {
          ...base,
          reply: "Seven hundred and fifty thousand, then.",
          confirmations: [
            {
              stepKey: "F6.target_amount",
              decision: "REVISED",
              value: "750000",
            },
          ],
        },
        {
          ...base,
          reply: "Confirmed.",
          confirmations: [
            { stepKey: "F6.target_amount", decision: "CONFIRMED" },
          ],
        },
      ),
      logger,
    });

    await interviewer.turn(turn(fetchFake, "Half a million."));
    const revised = await interviewer.turn(
      turn(fetchFake, "No, I meant seven hundred and fifty thousand."),
    );
    // A correction is still a candidate: it is read back, not written.
    expect(written).toEqual([]);
    expect(revised.reply).toContain("750,000");

    const done = await interviewer.turn(turn(fetchFake, "Yes."));
    expect(done.recorded).toContain("F6.target_amount");
    // Exactly one write, and it is the corrected figure. The first value
    // never reaches the record at all.
    expect(written).toHaveLength(1);
    expect(JSON.stringify(written[0]?.value)).toContain("750000");
    expect(JSON.stringify(written[0]?.value)).not.toContain("500000");
  });

  it("writes nothing when they say no, and asks again", async () => {
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway(proposes("500000"), {
        ...base,
        reply: "Righto — how much are you raising?",
        confirmations: [{ stepKey: "F6.target_amount", decision: "REJECTED" }],
        askNext: "F6.target_amount",
      }),
      logger,
    });

    await interviewer.turn(turn(fetchFake, "Half a million."));
    const refused = await interviewer.turn(turn(fetchFake, "No."));
    expect(written).toEqual([]);
    expect(refused.recorded).toEqual([]);
    expect(refused.asking?.stepKey).toBe("F6.target_amount");
  });

  it("keeps the pending value when they answer something else entirely", async () => {
    // The case that broke the journey: a person who answers a later field
    // while a material value is waiting. The waiting value must not be
    // lost, and the thing they just said must not be written to the step
    // that is waiting.
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway(proposes("500000"), {
        ...base,
        reply: "Lagos, got it.",
        answers: [],
      }),
      logger,
    });

    await interviewer.turn(turn(fetchFake, "Half a million."));
    const aside = await interviewer.turn(turn(fetchFake, "We're in Lagos."));
    expect(written).toEqual([]);
    expect(aside.recorded).toEqual([]);
    // Nothing was mapped onto the waiting step behind their back.
    expect(written.some((entry) => entry.stepKey === "F6.target_amount")).toBe(
      false,
    );
  });
});

describe("a held value the model restates instead of deciding", () => {
  it("is not read back again, and the turn belongs to what was actually said", async () => {
    /**
     * The loop, in three turns (local, 2026-09-23).
     *
     * A cheque range was held. Asked to decide it, the model put the same
     * figures in `answers` again rather than in `confirmations` -- and
     * because the runtime compared the sentence describing a held value
     * rather than the value, "500000" and "£500,000" looked like a
     * correction. So Q read the figure back, turn after turn, never
     * committed it, and dropped whatever else was said in the meantime.
     *
     * A restatement is not a decision. It changes nothing, so it earns no
     * second read-back, and the sentence in front of Q is the one that
     * gets answered.
     */
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway(proposes("500000"), {
        ...base,
        reply: "Lagos, got it. What does the company do?",
        // The same money, said differently. Not a correction.
        answers: [
          {
            stepKey: "F6.target_amount",
            value: "500000",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });

    const held = await interviewer.turn(turn(fetchFake, "Half a million."));
    expect(held.reply).toContain("500,000");

    const next = await interviewer.turn(turn(fetchFake, "We're in Lagos."));
    // Still unconfirmed, so still unwritten: a restatement is not a yes.
    expect(written).toEqual([]);
    // And Q does not spend a second turn asking the same question.
    expect(next.reply).not.toContain("Is that right?");
    expect(next.reply).toContain("Lagos");
  });
});
