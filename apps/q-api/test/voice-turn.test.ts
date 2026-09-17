import { FILLERS_RESEARCH } from "../src/voice/navigation.js";
import { describe, expect, it } from "vitest";

import type {
  OnboardingSessionView,
  QStreamEvent,
  SayOnboardingResponse,
} from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type {
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import {
  createVoiceTurnHandler,
  latestUtterance,
  spokenAcknowledgement,
} from "../src/voice/turn.js";

/**
 * One spoken turn, with every collaborator faked (CQ-Q-VOICE-001 C
 * §35-§40; §82-§84): the onboarding API, the Q runtime, the run stream and
 * the speaker. What is proven: a spoken interview answer reaches `say`
 * under the bound person's own token and Q speaks the acknowledgement and
 * the next question; a spoken question becomes a Q run with modality VOICE
 * in the bound conversation and is spoken as it streams; an interruption
 * cancels the run and speaks nothing stale; a stale transcript from
 * nobody reaches nothing.
 */

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
void AuthUserIdSchema;
const BEARER = "eyPRIVATE.NEVER-EMITTED.bearer";
const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const RUN_ID = "f0000000-0000-4000-8000-000000000020";
const CONVERSATION_ID = "f0000000-0000-4000-8000-000000000021";
const NOW = "2026-09-15T09:00:00.000Z";

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
      eligibleSteps: [],
      eligibleStepCount: 0,
      completedEligibleStepCount: 0,
      canGoBack: false,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [],
    pendingQuestions: [],
    ...overrides,
  };
}

function binding(thread: VoiceSessionBinding["thread"]): VoiceSessionBinding {
  return {
    voiceSessionId: "vs-1",
    providerConversationId: "conv_1",
    actor: CONTEXT,
    accessToken: BEARER,
    voice: "FEMALE",
    thread,
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

function fakeSpeaker(): VoiceSpeaker & { readonly spoken: string[] } {
  const speaker = {
    providerConversationId: "conv_1",
    isOpen: true,
    spoken: [] as string[],
    speak: async (response: string | AsyncIterable<string>) => {
      if (typeof response === "string") {
        speaker.spoken.push(response);
        return;
      }
      const parts: string[] = [];
      for await (const chunk of response) {
        parts.push(chunk);
      }
      if (parts.length > 0) {
        speaker.spoken.push(parts.join(" ").replace(/\s+/g, " ").trim());
      }
    },
    close: () => undefined,
  };
  return speaker;
}

const RUN = {
  id: RUN_ID,
  conversationId: CONVERSATION_ID,
  status: "RECEIVED",
} as unknown as QRunRecord;

function fakeRuntime() {
  const calls = { createRun: [] as unknown[], cancelRun: [] as unknown[] };
  const service = {
    createRun: (command: unknown) => {
      calls.createRun.push(command);
      return Promise.resolve({
        run: RUN,
        conversation: {} as never,
        message: {} as never,
        created: true,
      });
    },
    cancelRun: (command: unknown) => {
      calls.cancelRun.push(command);
      return Promise.resolve({
        run: { ...RUN, status: "CANCELLED" },
        changed: true,
        summary: {} as never,
      });
    },
    getRun: () => Promise.reject(new Error("not used")),
    appendMessage: () => Promise.reject(new Error("not used")),
  } as unknown as QRuntimeService;
  return { service, calls };
}

function fakeStream(
  events: readonly QStreamEvent[],
  options: {
    readonly abortAfter?: number;
    readonly controller?: AbortController;
  } = {},
): QRunStreamService {
  return {
    authorize: () => Promise.resolve(RUN),
    open: async function* (input) {
      for (const [index, event] of events.entries()) {
        if (input.signal.aborted) {
          return;
        }
        yield { kind: "durable" as const, event };
        if (options.abortAfter === index) {
          options.controller?.abort();
        }
        await Promise.resolve();
      }
      yield { kind: "end" as const, reason: "TERMINAL" as const };
    },
    stats: () => ({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
      deltasDropped: 0,
    }),
  };
}

const event = (type: string, data: Record<string, unknown>): QStreamEvent =>
  ({
    type,
    runId: RUN_ID,
    sequence: 1,
    occurredAt: NOW,
    data,
  }) as unknown as QStreamEvent;

describe("latestUtterance", () => {
  it("takes the person's last line only, bounded", () => {
    expect(
      latestUtterance([
        { role: "user", content: "first" },
        { role: "agent", content: "Noted." },
        { role: "user", content: "  We're seed stage.  " },
      ]),
    ).toBe("We're seed stage.");
    expect(latestUtterance([{ role: "agent", content: "Hello" }])).toBeNull();
  });
});

describe("spokenAcknowledgement", () => {
  it("says what was noted, what was picked up, and asks the next question", () => {
    const after = view({
      currentStep: {
        stepKey: "F1.description",
        stepType: "long_text",
        required: false,
        prompt: "In a sentence or two, what does the company do?",
        presentation: { stepType: "long_text", minLength: 1, maxLength: 2000 },
      },
    });
    expect(
      spokenAcknowledgement(
        { kind: "ANSWERED", stepKey: "F1.stage", summary: "Seed", proposed: 2 },
        view(),
        after,
      ),
    ).toBe(
      "Noted. I also picked up 2 other things from that; they're on screen for you to confirm. In a sentence or two, what does the company do?",
    );
    expect(
      spokenAcknowledgement(
        {
          kind: "AMBIGUOUS",
          stepKey: "F1.stage",
          optionKeys: ["seed", "series_a"],
        },
        view(),
        view(),
      ),
    ).toBe(
      "I can see more than one that fits: Seed, or Series A. Which do you mean?",
    );
  });
});

describe("a spoken interview answer", () => {
  it("reaches the onboarding runtime's say under the bound person's token, then Q speaks the acknowledgement", async () => {
    const requests: {
      url: string;
      method: string;
      auth: string | null;
      body: unknown;
    }[] = [];
    const after = view({
      session: {
        ...view().session,
        version: 4,
        currentStepKey: "F1.description",
      },
      currentStep: {
        stepKey: "F1.description",
        stepType: "long_text",
        required: false,
        prompt: "In a sentence or two, what does the company do?",
        presentation: { stepType: "long_text", minLength: 1, maxLength: 2000 },
      },
    });
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
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.endsWith("/say")) {
        const body: SayOnboardingResponse = {
          view: after,
          understood: {
            kind: "ANSWERED",
            stepKey: "F1.stage",
            summary: "Seed",
          },
        };
        return Promise.resolve(Response.json(body));
      }
      return Promise.resolve(Response.json(view()));
    };
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([]),
      onboarding: { apiBaseUrl: "http://api.test", fetch: fetchFake },
      logger,
    });
    const speaker = fakeSpeaker();
    const outcome = await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
      }),
      [{ role: "user", content: "We're at seed." }],
      new AbortController().signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "SPOKEN", path: "INTERVIEW" });
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ["GET", `http://api.test/v1/onboarding/sessions/${SESSION_ID}`],
      ["POST", `http://api.test/v1/onboarding/sessions/${SESSION_ID}/say`],
    ]);
    // The person's own authority, exactly: no service credential, no tenant header.
    expect(requests.every((r) => r.auth === `Bearer ${BEARER}`)).toBe(true);
    expect(requests[1]?.body).toEqual({
      text: "We're at seed.",
      expectedSessionVersion: 3,
    });
    expect(speaker.spoken).toEqual([
      "Noted. In a sentence or two, what does the company do?",
    ]);
    expect(runtime.calls.createRun).toHaveLength(0);
  });

  it("pauses and resumes from the session, without touching the runtime", async () => {
    let says = 0;
    const fetchFake: typeof fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/say")) {
        says += 1;
      }
      void init;
      return Promise.resolve(Response.json(view()));
    };
    const handle = createVoiceTurnHandler({
      qRuntime: fakeRuntime().service,
      qStream: fakeStream([]),
      onboarding: { apiBaseUrl: "http://api.test", fetch: fetchFake },
      logger,
    });
    const speaker = fakeSpeaker();
    const bound = binding({
      conversationId: undefined,
      subjects: undefined,
      onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
    });
    await handle(
      bound,
      [{ role: "user", content: "Let's stop here." }],
      new AbortController().signal,
      speaker,
    );
    await handle(
      bound,
      [{ role: "user", content: "Where were we?" }],
      new AbortController().signal,
      speaker,
    );
    expect(speaker.spoken).toEqual([
      "Of course. Everything so far is saved. Come back whenever suits you and we'll pick up exactly here.",
      "Right, back to it. What stage is the company at?",
    ]);
    expect(says).toBe(0);
  });
});

describe("a spoken category confirmation", () => {
  it("accepts Q's pending proposal on the category step with the same ACCEPT the tap performs", async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    const categoriesStep = view({
      session: { ...view().session, currentStepKey: "F1.categories" },
      currentStep: {
        stepKey: "F1.categories",
        stepType: "reference_select",
        required: false,
        prompt: "How would you categorise the company?",
        presentation: {
          stepType: "reference_select",
          resourceType: "TAXONOMY_NODE",
          vocabularyCodes: ["industry"],
          minItems: 1,
          maxItems: 8,
        },
      },
      pendingSuggestions: [
        {
          id: "f0000000-0000-4000-8000-000000000040",
          stepKey: "F1.categories",
          targetField: "categories",
          suggestedValue: {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: ["f0000000-0000-4000-8000-000000000041"],
          },
          confidence: "0.9",
          status: "PENDING",
          createdAt: NOW,
        },
      ],
    });
    const after = view({
      session: {
        ...view().session,
        version: 4,
        currentStepKey: "F2.materials",
      },
      currentStep: {
        stepKey: "F4.founder_role",
        stepType: "short_text",
        required: true,
        prompt: "What do you already have?",
        presentation: { stepType: "short_text", minLength: 1, maxLength: 120 },
      },
    });
    const fetchFake: typeof fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push({
        url,
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.includes("/suggestions/")) {
        return Promise.resolve(Response.json(after));
      }
      return Promise.resolve(Response.json(categoriesStep));
    };
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([]),
      onboarding: { apiBaseUrl: "http://api.test", fetch: fetchFake },
      logger,
    });
    const speaker = fakeSpeaker();
    const outcome = await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
      }),
      [{ role: "user", content: "Yes, keep these." }],
      new AbortController().signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "SPOKEN", path: "INTERVIEW" });
    expect(requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(requests[1]?.url).toBe(
      `http://api.test/v1/onboarding/sessions/${SESSION_ID}/suggestions/f0000000-0000-4000-8000-000000000040/resolve`,
    );
    expect(requests[1]?.body).toEqual({
      resolution: "ACCEPT",
      expectedSessionVersion: 3,
    });
    expect(speaker.spoken).toEqual(["Noted. What do you already have?"]);
    expect(runtime.calls.createRun).toHaveLength(0);
  });
});

describe("a spoken question for Q", () => {
  it("starts a VOICE run in the bound conversation, speaks it as it streams, and returns to the interview", async () => {
    const runtime = fakeRuntime();
    const fetchFake: typeof fetch = () =>
      Promise.resolve(Response.json(view()));
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.run.started", { status: "RECEIVED", capability: "ANSWER" }),
        event("q.message.delta", {
          messageId: "m1",
          text: "Seed rounds in Nigeria ",
        }),
        event("q.message.delta", {
          messageId: "m1",
          text: "typically run from $500k. Most ",
        }),
        event("q.message.delta", {
          messageId: "m1",
          text: "close within a quarter.",
        }),
        event("q.message.completed", {
          message: {
            messageId: "m1",
            runId: RUN_ID,
            role: "Q",
            text: "Seed rounds in Nigeria typically run from $500k. Most close within a quarter.",
            createdAt: NOW,
          },
        }),
        event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
      ]),
      onboarding: { apiBaseUrl: "http://api.test", fetch: fetchFake },
      logger,
    });
    const speaker = fakeSpeaker();
    const bound = binding({
      conversationId: undefined,
      subjects: [
        { kind: "COMPANY", companyId: "f0000000-0000-4000-8000-000000000030" },
      ],
      onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
    });
    const outcome = await handle(
      bound,
      [{ role: "user", content: "How big are seed rounds in Nigeria?" }],
      new AbortController().signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "SPOKEN", path: "Q" });
    const command = runtime.calls.createRun[0] as {
      actor: ActorContext;
      input: Record<string, unknown>;
    };
    expect(command.actor).toEqual(CONTEXT);
    expect(command.input).toMatchObject({
      capability: "ANSWER",
      modality: "VOICE",
      message: { text: "How big are seed rounds in Nigeria?" },
      subjects: [{ kind: "COMPANY" }],
    });
    // Spoken as the deltas arrived (one line), then the bridge back.
    expect(speaker.spoken).toEqual([
      // Money is said the way a person says it: "$500k" was read aloud as
      // a dollar sign, a number and a letter.
      "Seed rounds in Nigeria typically run from 500 thousand dollars. Most close within a quarter.",
      "Back to where we were. What stage is the company at?",
    ]);
    expect(bound.thread.conversationId).toBe(CONVERSATION_ID);
    expect(runtime.calls.cancelRun).toHaveLength(0);
  });

  it("pauses at an interruption: nothing stale is spoken, the run keeps going, and 'go on' resumes the answer (rework)", async () => {
    const runtime = fakeRuntime();
    const controller = new AbortController();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream(
        [
          event("q.message.delta", { messageId: "m1", text: "First point. " }),
          event("q.message.delta", { messageId: "m1", text: "Second point. " }),
          event("q.message.delta", { messageId: "m1", text: "Third point." }),
          event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
        ],
        { abortAfter: 1, controller },
      ),
      logger,
    });
    const speaker = fakeSpeaker();
    const bound = binding({
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    });
    const outcome = await handle(
      bound,
      [{ role: "user", content: "Tell me about seed rounds" }],
      controller.signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "INTERRUPTED", path: "Q" });
    expect(speaker.spoken).toEqual(["First point."]);
    expect(speaker.spoken.join(" ")).not.toContain("Third");
    // The run is not cancelled: the answer finishes in the background.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.calls.cancelRun).toHaveLength(0);
    // "Go on" acknowledges the cut and speaks only what was not heard.
    const resumed = await handle(
      bound,
      [
        { role: "user", content: "Tell me about seed rounds" },
        { role: "user", content: "okay, go on" },
      ],
      new AbortController().signal,
      speaker,
    );
    expect(resumed).toEqual({ kind: "SPOKEN", path: "Q" });
    const last = speaker.spoken.at(-1) ?? "";
    expect(last).toMatch(/Second point\. Third point\.$/);
    expect(last).not.toContain("First point.");
    expect(last.length).toBeGreaterThan("Second point. Third point.".length);
    expect(runtime.calls.cancelRun).toHaveLength(0);
  });

  it("offers a paused answer after the person's next subject, once it has finished (rework)", async () => {
    const runtime = fakeRuntime();
    const controller = new AbortController();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream(
        [
          event("q.message.delta", {
            messageId: "m1",
            text: "Seed rounds run small. ",
          }),
          event("q.message.delta", {
            messageId: "m1",
            text: "Most close fast.",
          }),
          event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
        ],
        { abortAfter: 0, controller },
      ),
      logger,
    });
    const speaker = fakeSpeaker();
    const bound = binding({
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    });
    await handle(
      bound,
      [{ role: "user", content: "Tell me about seed rounds" }],
      controller.signal,
      speaker,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A new question: answered first (a fresh run), then the paused answer.
    const next = await handle(
      bound,
      [{ role: "user", content: "Let me think" }],
      new AbortController().signal,
      speaker,
    );
    expect(next).toEqual({ kind: "SPOKEN", path: "MOVE" });
    expect(speaker.spoken.at(-1)).toBe(
      "And to finish what I was saying earlier: Seed rounds run small. Most close fast.",
    );
  });

  it("says it is looking at public sources when the run reaches that stage, once (D §56)", async () => {
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.stage.changed", { stage: "SEARCHING_PUBLIC_SOURCES" }),
        event("q.stage.changed", { stage: "SEARCHING_PUBLIC_SOURCES" }),
        event("q.message.completed", {
          message: {
            messageId: "m1",
            runId: RUN_ID,
            role: "Q",
            text: "Paystack raised a Series A in 2018.",
            createdAt: NOW,
          },
        }),
        event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
      ]),
      logger,
    });
    const speaker = fakeSpeaker();
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "user", content: "What did Paystack raise?" }],
      new AbortController().signal,
      speaker,
    );
    expect(speaker.spoken).toHaveLength(1);
    const said = speaker.spoken[0] ?? "";
    expect(
      FILLERS_RESEARCH.some((line) =>
        said.startsWith(`${line} Paystack raised a Series A in 2018.`),
      ),
      said,
    ).toBe(true);
  });

  it("speaks a run's public failure and nothing internal", async () => {
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.run.failed", {
          status: "FAILED",
          failure: {
            code: "MODEL_UNAVAILABLE",
            message: "I couldn't answer that right now. Please try again.",
            retryable: true,
          },
        }),
      ]),
      logger,
    });
    const speaker = fakeSpeaker();
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "user", content: "What is our runway?" }],
      new AbortController().signal,
      speaker,
    );
    // A recovery line in Q's words, never the failure's own message and
    // never anything internal; it says what Q can still do.
    const said = speaker.spoken.join(" ");
    expect(said).not.toContain("I couldn't answer that right now.");
    expect(said).not.toMatch(/provider|schema|policy|internal/i);
    expect(said).toMatch(
      /ask (?:me|it) again|try it another way|tell me what/i,
    );
    expect(runtime.calls.cancelRun).toHaveLength(0);
  });

  it("says nothing more when a run fails after its answer was spoken", async () => {
    // Live: Q answered, then said it had hit a snag and to ask again. A
    // failure after the answer has been heard is not the person's to act
    // on; it is logged, and nothing follows the answer.
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.delta", { messageId: "m1", text: "First point. " }),
        event("q.message.delta", { messageId: "m1", text: "Second point. " }),
        event("q.run.failed", {
          status: "FAILED",
          failure: {
            code: "Q_UNAVAILABLE",
            message: "I couldn't answer that right now. Please try again.",
            retryable: true,
          },
        }),
      ]),
      logger,
    });
    const speaker = fakeSpeaker();
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "user", content: "What is our runway?" }],
      new AbortController().signal,
      speaker,
    );
    const said = speaker.spoken.join(" ");
    expect(said).toContain("First point.");
    expect(said).toContain("Second point.");
    expect(said).not.toMatch(/snag|ask (?:me|it) again|try it another way/i);
  });

  it("speaks what Q prepared, and a spoken yes is the approval (CQ-Q-008, ADR 0011)", async () => {
    const runtime = fakeRuntime();
    const approvals = { approve: [] as unknown[], reject: [] as unknown[] };
    const resumed: unknown[] = [];
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.delta", {
          messageId: "m1",
          text: "I've prepared that change to your profile. ",
        }),
        event("q.action.proposed", {
          proposal: {
            proposalId: "p1",
            summary:
              "Update your company profile. Website: https://thevaultlyne.com",
          },
        }),
        event("q.approval.required", {
          approvalId: "33333333-3333-4333-8333-333333333333",
          proposalId: "p1",
        }),
      ]),
      orchestration: {
        orchestrator: {
          start: () => Promise.resolve(),
          resume: (command: unknown) => {
            resumed.push(command);
            return Promise.resolve();
          },
        } as never,
        autostart: false,
      },
      approvals: {
        approve: (command: unknown) => {
          approvals.approve.push(command);
          return Promise.resolve({
            decided: true,
            action: { runId: RUN_ID },
            view: {},
          } as never);
        },
        reject: (command: unknown) => {
          approvals.reject.push(command);
          return Promise.resolve({} as never);
        },
      },
      logger,
    });
    const thread = {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    };
    const bound = binding(thread);
    const speaker = fakeSpeaker();
    await handle(
      bound,
      [{ role: "user", content: "Put our website as thevaultlyne.com" }],
      new AbortController().signal,
      speaker,
    );
    expect(speaker.spoken.join(" ")).toContain("Shall I go ahead?");
    expect(speaker.spoken.join(" ")).toContain("thevaultlyne.com");

    const yes = fakeSpeaker();
    await handle(
      bound,
      [
        { role: "user", content: "Put our website as thevaultlyne.com" },
        { role: "agent", content: "Shall I go ahead?" },
        { role: "user", content: "Yes." },
      ],
      new AbortController().signal,
      yes,
    );
    expect(approvals.approve).toHaveLength(1);
    expect((approvals.approve[0] as { approvalId: string }).approvalId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(resumed).toHaveLength(1);
    expect(yes.spoken.join(" ")).toMatch(/Done/);
    // A yes was the decision; no run was started for the word "yes".
    expect(runtime.calls.createRun).toHaveLength(1);
  });

  it("does nothing for a transcript with no words from the person", async () => {
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([]),
      logger,
    });
    const speaker = fakeSpeaker();
    const outcome = await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "agent", content: "Hello" }],
      new AbortController().signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "NOTHING" });
    expect(runtime.calls.createRun).toHaveLength(0);
    expect(speaker.spoken).toEqual([]);
  });
});
