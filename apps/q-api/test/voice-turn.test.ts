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
      for await (const chunk of response) {
        speaker.spoken.push(chunk);
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
    // Spoken sentence by sentence as the deltas arrived, then the bridge back.
    expect(speaker.spoken).toEqual([
      "Seed rounds in Nigeria typically run from $500k.",
      "Most close within a quarter.",
      "Back to where we were. What stage is the company at?",
    ]);
    expect(bound.thread.conversationId).toBe(CONVERSATION_ID);
    expect(runtime.calls.cancelRun).toHaveLength(0);
  });

  it("stops at an interruption: the run is cancelled and nothing stale is spoken (§38)", async () => {
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
    const outcome = await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "user", content: "Tell me about seed rounds" }],
      controller.signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "INTERRUPTED", path: "Q" });
    expect(speaker.spoken).toEqual(["First point."]);
    expect(speaker.spoken.join(" ")).not.toContain("Third");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.calls.cancelRun).toHaveLength(1);
    expect(runtime.calls.cancelRun[0]).toMatchObject({
      actor: CONTEXT,
      runId: RUN_ID,
    });
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
    expect(speaker.spoken.join(" ")).toBe(
      "I couldn't answer that right now. Please try again.",
    );
    expect(runtime.calls.cancelRun).toHaveLength(0);
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
