import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * Q conducting the interview, with the model faked: what the model
 * proposes is validated against the step's own kind and options,
 * material values are held back until confirmed, categories go through
 * the platform's classifier, and everything recorded goes through the
 * onboarding API under the person's own token. The model's words are
 * Q's words; nothing else it says has effect.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-15T09:00:00.000Z";
const BEARER = "eyPRIVATE.NEVER-EMITTED.bearer";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function view(
  overrides: Partial<OnboardingSessionView> = {},
): OnboardingSessionView {
  return {
    session: {
      id: SESSION_ID,
      journeyType: "founder",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: 2,
      status: "ACTIVE",
      subject: null,
      currentStepKey: "F1.stage",
      version: 3,
      startedAt: NOW,
      lastActivityAt: NOW,
      completedAt: null,
    },
    phases: [],
    currentStep: {
      stepKey: "F1.stage",
      stepType: "single_select",
      required: true,
      prompt: "What stage is the company at?",
      presentation: {
        stepType: "single_select",
        options: [
          { optionKey: "seed", label: "Seed" },
          { optionKey: "series_a", label: "Series A" },
        ],
      },
    },
    progress: {
      currentStepKey: "F1.stage",
      currentPhaseKey: null,
      eligibleSteps: [
        { stepKey: "F0.intent", required: true, status: "COMPLETED" },
        { stepKey: "F1.company_name", required: true, status: "COMPLETED" },
        { stepKey: "F1.country", required: true, status: "IN_PROGRESS" },
        { stepKey: "F1.stage", required: true, status: "IN_PROGRESS" },
        { stepKey: "F4.founder_role", required: true, status: "PENDING" },
        { stepKey: "F6.target_amount", required: false, status: "PENDING" },
        { stepKey: "F1.categories", required: false, status: "PENDING" },
      ],
      eligibleStepCount: 7,
      completedEligibleStepCount: 2,
      canGoBack: false,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        stepKey: "F1.company_name",
        responseType: "TEXT",
        value: { type: "TEXT", text: "Northstar" },
        sourceModality: "TYPED_TEXT",
        createdAt: NOW,
      },
    ],
    pendingQuestions: [],
    ...overrides,
  };
}

type Request = {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
};

function fakeApi(current: () => OnboardingSessionView) {
  const requests: Request[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.includes("/taxonomy/")) {
      return Promise.resolve(
        Response.json({
          candidates: [
            {
              nodeId: "a1b2c3d4-0001-4000-8000-000000000001",
              displayName: "Logistics & Mobility",
              vocabularyCode: "industry",
              confidence: "0.9",
              matchTypes: ["EXACT_LABEL"],
              rationaleSummary: "exact",
            },
          ],
        }),
      );
    }
    return Promise.resolve(Response.json(current()));
  };
  return { fetchFake, requests };
}

/** A model that answers from a queue, one result per turn, in order. */
function queuedGateway(
  results: readonly InterviewConductorResult[],
): InterviewGateway & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  const queue = [...results];
  return {
    calls,
    execute: (request) => {
      calls.push(request);
      const next = queue.shift();
      if (next === undefined) {
        return Promise.reject(new Error("no more results"));
      }
      return Promise.resolve({
        output: { kind: "STRUCTURED", value: next },
      } as never);
    },
  };
}

const base: InterviewConductorResult = {
  reply: "Seed, got it. Where is the company based?",
  intent: "ANSWER",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: "F1.country",
  showOptions: false,
  questionForQ: null,
};

function turnInput(fetchFake: typeof fetch, utterance: string) {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: BEARER,
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

describe("interviewer", () => {
  it("records a plain option the model read, under the person's token, and speaks the model's words", async () => {
    const api = fakeApi(() => view());
    const gateway = queuedGateway([
      {
        ...base,
        answers: [{ stepKey: "F1.stage", value: "seed", confidence: "HIGH" }],
      },
    ]);
    const interviewer = createInterviewer({ gateway, logger });
    const outcome = await interviewer.turn(
      turnInput(api.fetchFake, "We're at seed."),
    );
    expect(outcome.reply).toBe("Seed, got it. Where is the company based?");
    expect(outcome.recorded).toEqual(["F1.stage"]);
    expect(outcome.asking?.stepKey).toBe("F1.country");
    const submit = api.requests.find((r) => r.url.endsWith("/responses"));
    expect(submit?.method).toBe("POST");
    expect(submit?.auth).toBe(`Bearer ${BEARER}`);
    expect(submit?.body).toEqual({
      stepKey: "F1.stage",
      response: { value: { type: "SINGLE_SELECT", optionKey: "seed" } },
      expectedSessionVersion: 3,
    });
    // The prompt carried the open steps with their real options and the
    // known answers, and nothing that is not the person's business.
    const call = gateway.calls[0] as { messages: { content: string }[] };
    const prompt = call.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("F1.stage");
    expect(prompt).toContain("Northstar");
    expect(prompt).not.toContain(BEARER);
  });

  it("refuses an option that is not one of the step's, a completed step, and a step that does not exist", async () => {
    const api = fakeApi(() => view());
    const gateway = queuedGateway([
      {
        ...base,
        answers: [
          { stepKey: "F1.stage", value: "unicorn", confidence: "HIGH" },
          { stepKey: "F1.company_name", value: "Renamed", confidence: "HIGH" },
          { stepKey: "F9.invented", value: "x", confidence: "HIGH" },
        ],
      },
    ]);
    const interviewer = createInterviewer({ gateway, logger });
    const outcome = await interviewer.turn(
      turnInput(api.fetchFake, "unicorn stage"),
    );
    expect(outcome.recorded).toEqual([]);
    expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("holds a material figure until the person confirms it, then records it (A §13)", async () => {
    const api = fakeApi(() => view());
    const gateway = queuedGateway([
      {
        ...base,
        reply:
          "One and a half million dollars, mostly for sales — is that right?",
        answers: [
          { stepKey: "F6.target_amount", value: "$1.5m", confidence: "HIGH" },
        ],
        askNext: null,
      },
      {
        ...base,
        reply: "Recorded. What's your role?",
        confirmations: [{ stepKey: "F6.target_amount", decision: "CONFIRMED" }],
        askNext: "F4.founder_role",
      },
    ]);
    const interviewer = createInterviewer({ gateway, logger });
    const held = await interviewer.turn(
      turnInput(api.fetchFake, "We're raising $1.5m"),
    );
    expect(held.recorded).toEqual([]);
    expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    // The pending value travels into the next prompt, for the model to settle.
    const confirmed = await interviewer.turn(
      turnInput(api.fetchFake, "Yes, that's right."),
    );
    const second = gateway.calls[1] as { messages: { content: string }[] };
    expect(second.messages.map((m) => m.content).join("\n")).toContain(
      "1500000",
    );
    expect(confirmed.recorded).toEqual(["F6.target_amount"]);
    const submit = api.requests.find((r) => r.url.endsWith("/responses"));
    expect(submit?.body).toMatchObject({
      stepKey: "F6.target_amount",
      response: { value: { type: "RANGE", value: "1500000" } },
    });
  });

  it("maps category phrases through the platform's classifier and holds the result for confirmation", async () => {
    const api = fakeApi(() => view());
    const gateway = queuedGateway([
      {
        ...base,
        reply: "That sounds like logistics and mobility — shall I record that?",
        categoryPhrases: [
          { stepKey: "F1.categories", phrases: ["logistics software"] },
        ],
        askNext: null,
      },
    ]);
    const interviewer = createInterviewer({ gateway, logger });
    const outcome = await interviewer.turn(
      turnInput(api.fetchFake, "We build logistics software"),
    );
    expect(outcome.recorded).toEqual([]);
    expect(api.requests.some((r) => r.url.includes("/taxonomy/"))).toBe(true);
    expect(
      api.requests.filter(
        (r) => r.method === "POST" && r.url.endsWith("/responses"),
      ),
    ).toHaveLength(0);
  });

  it("routes a question for Q instead of answering it here", async () => {
    const api = fakeApi(() => view());
    const gateway = queuedGateway([
      {
        ...base,
        reply: "Let me look at that.",
        intent: "QUESTION_FOR_Q",
        questionForQ: "How big are seed rounds in Nigeria?",
        askNext: null,
      },
    ]);
    const interviewer = createInterviewer({ gateway, logger });
    const outcome = await interviewer.turn(
      turnInput(api.fetchFake, "How big are seed rounds in Nigeria?"),
    );
    expect(outcome.questionForQ).toBe("How big are seed rounds in Nigeria?");
    expect(outcome.recorded).toEqual([]);
  });

  it("speaks a plain fallback when the model is unavailable and records nothing", async () => {
    const api = fakeApi(() => view());
    const gateway: InterviewGateway = {
      execute: () =>
        Promise.reject(
          new Error("provider down at postgres://admin:secret@db"),
        ),
    };
    const interviewer = createInterviewer({ gateway, logger });
    const outcome = await interviewer.turn(
      turnInput(api.fetchFake, "We're at seed"),
    );
    expect(outcome.degraded).toBe(true);
    expect(outcome.reply).toContain("What stage is the company at?");
    expect(outcome.reply).not.toContain("secret");
    expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
