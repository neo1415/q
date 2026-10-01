import { describe, expect, it, vi } from "vitest";

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
import { createVoiceTurnBoard } from "../src/voice/turn-board.js";
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
          // No interviewer is composed in this build, so the API answered
          // without Q's words and the spoken line is composed from what
          // the runtime understood (QX-004 core gate: one Q).
          reply: null,
          navigate: null,
          researching: null,
          degraded: false,
          askingAbout: [],
          pending: { recommendations: [], held: [] },
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
      // The thread travels with the turn so the one interviewer has the
      // same context typed as aloud (QX-004 core gate: one Q). Empty here:
      // this turn is the first thing said.
      recentTurns: [],
    });
    expect(speaker.spoken).toEqual([
      "Noted. In a sentence or two, what does the company do?",
    ]);
    expect(runtime.calls.createRun).toHaveLength(0);
  });

  it("takes a name offered mid-interview as a tangent, not as a profile change to approve (QX-004 §0.6)", async () => {
    // Hosted, 2026-09-22: asked what kind of investor they were, the
    // person said "Oh, right. My name is Joe", and Q abandoned its own
    // unanswered question to ask "I'll set what I call you to Joe. Shall
    // I?". The name matcher was intercepting the turn before the
    // interviewer — which is the right thing on a free conversation and
    // the wrong thing while somebody is being interviewed.
    const said: string[] = [];
    const fetchFake: typeof fetch = (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/say")) {
        said.push(url);
        const body: SayOnboardingResponse = {
          view: view(),
          understood: {
            kind: "UNCLEAR",
            stepKey: "F1.stage",
            proposed: 0,
          },
          // No interviewer is composed in this build, so the API answered
          // without Q's words and the spoken line is composed from what
          // the runtime understood (QX-004 core gate: one Q).
          reply: null,
          navigate: null,
          researching: null,
          degraded: false,
          askingAbout: [],
          pending: { recommendations: [], held: [] },
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
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
      }),
      [{ role: "user", content: "Oh, right. My name is Joe." }],
      new AbortController().signal,
      speaker,
    );
    const spoken = speaker.spoken.join(" ");
    expect(spoken).not.toContain("Shall I?");
    expect(spoken).not.toContain("what I call you");
    // It went to the interview, which is what was conducting.
    expect(said.length).toBeGreaterThan(0);
  });

  it("reads no pause or resume from the words: without the loop both go to the one the API delegates to (P0-1, ADR 0011)", async () => {
    let says = 0;
    const fetchFake: typeof fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      void init;
      if (url.endsWith("/say")) {
        says += 1;
        const body: SayOnboardingResponse = {
          view: view(),
          understood: null,
          reply: "Of course, we can stop here.",
          navigate: null,
          researching: null,
          degraded: false,
          askingAbout: [],
          pending: { recommendations: [], held: [] },
        };
        return Promise.resolve(Response.json(body));
      }
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
    // No word list answered them: both turns went to the interview.
    expect(says).toBe(2);
    expect(speaker.spoken.join(" ")).not.toContain(
      "Everything so far is saved",
    );
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
          sourceRefs: [],
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
  it("is not pre-sorted by its words: it goes to the one interviewer, which reads and answers it (CQ-QX-005, ADR 0011)", async () => {
    const requests: string[] = [];
    const fetchFake: typeof fetch = (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push(url);
      if (url.endsWith("/say")) {
        const body: SayOnboardingResponse = {
          view: view(),
          understood: null,
          reply:
            "Seed rounds there tend to be small. Back to you: what stage is the company at?",
          navigate: null,
          researching: null,
          degraded: false,
          askingAbout: [],
          pending: { recommendations: [], held: [] },
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
      [{ role: "user", content: "How big are seed rounds in Nigeria?" }],
      new AbortController().signal,
      speaker,
    );
    expect(outcome).toEqual({ kind: "SPOKEN", path: "INTERVIEW" });
    // No Q run was started behind the interviewer's back.
    expect(runtime.calls.createRun).toHaveLength(0);
    expect(requests.some((url) => url.endsWith("/say"))).toBe(true);
    expect(speaker.spoken.join(" ")).toContain("Seed rounds there");
  });

  it("goes through the same tool-calling Q loop as a typed turn (ADR 0016, M5)", async () => {
    const runtime = fakeRuntime();
    const seen: {
      channel: string;
      actorUserId: string | undefined;
      said: string;
    }[] = [];
    const outcomeOf = (reply: string) =>
      ({
        reply,
        intent: "ANSWER",
        asking: null,
        recorded: ["F1.stage"],
        skipped: [],
        questionForQ: null,
        researching: null,
        navigate: null,
        handoff: null,
        pronounce: null,
        warnings: 0,
        view: view(),
        degraded: false,
        reading: null,
        resume: null,
        qualitative: [],
        trace: null,
      }) as const;
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([]),
      onboarding: {
        apiBaseUrl: "http://api.test",
        fetch: () => Promise.resolve(Response.json(view())),
      },
      interviewAgent: {
        turn: (input) => {
          seen.push({
            channel: input.channel,
            actorUserId: input.actor?.userId,
            said: input.utterance,
          });
          return Promise.resolve(outcomeOf("Seed it is. Where are you based?"));
        },
        researchEnded: () => undefined,
      },
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
    expect(seen).toEqual([
      { channel: "voice", actorUserId: CONTEXT.userId, said: "We're at seed." },
    ]);
    expect(speaker.spoken.join(" ")).toContain("Seed it is.");
    expect(runtime.calls.createRun).toHaveLength(0);
  });

  it("speaks the loop's reply as it is written, before the turn ends, and says nothing twice (voice latency)", async () => {
    // Live: 8 to 11 s from the end of the person's turn to Q's first
    // sound, because the whole loop finished before a word was spoken.
    const timeline: string[] = [];
    const outcomeOf = (reply: string) =>
      ({
        reply,
        intent: "ANSWER",
        asking: null,
        recorded: [],
        skipped: [],
        questionForQ: null,
        researching: null,
        navigate: null,
        handoff: null,
        pronounce: null,
        warnings: 0,
        view: view(),
        degraded: false,
        reading: null,
        resume: null,
        qualitative: [],
        trace: null,
      }) as const;
    const handle = createVoiceTurnHandler({
      qRuntime: fakeRuntime().service,
      qStream: fakeStream([]),
      onboarding: {
        apiBaseUrl: "http://api.test",
        fetch: () => Promise.resolve(Response.json(view())),
      },
      interviewAgent: {
        turn: async (input) => {
          input.onSentence?.("Seed it is.");
          // The model is still writing; the first sentence is already out.
          await new Promise((resolve) => setTimeout(resolve, 20));
          timeline.push("model still writing");
          input.onSentence?.("Where are you based?");
          timeline.push("turn ends");
          return outcomeOf("Seed it is. Where are you based?");
        },
        researchEnded: () => undefined,
      },
      logger,
    });
    const speaker: VoiceSpeaker = {
      providerConversationId: "conv_1",
      isOpen: true,
      speak: async (response) => {
        if (typeof response === "string") {
          timeline.push(`spoke: ${response.trim()}`);
          return;
        }
        for await (const part of response) {
          timeline.push(`spoke: ${part.trim()}`);
        }
      },
      close: () => undefined,
    };
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
    // The first sentence was voiced while the model was still writing.
    expect(timeline.indexOf("spoke: Seed it is.")).toBeLessThan(
      timeline.indexOf("model still writing"),
    );
    // Every sentence once.
    expect(timeline.filter((line) => line.startsWith("spoke:"))).toEqual([
      "spoke: Seed it is.",
      "spoke: Where are you based?",
    ]);
  });

  it("hands a look-up to Q, reports how it ended to the loop, and returns to the open question (P0-1)", async () => {
    const runtime = fakeRuntime();
    const ended: [string, boolean][] = [];
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.delta", {
          messageId: "m1",
          text: "Three funds back seed fintech in Lagos.",
        }),
        event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
      ]),
      onboarding: {
        apiBaseUrl: "http://api.test",
        fetch: () => Promise.resolve(Response.json(view())),
      },
      interviewAgent: {
        turn: () =>
          Promise.resolve({
            reply: "Let me look that up.",
            intent: "ANSWER",
            asking: null,
            recorded: [],
            skipped: [],
            questionForQ: "who backs seed fintech in Lagos?",
            researching: "who backs seed fintech in Lagos?",
            navigate: null,
            handoff: null,
            pronounce: null,
            warnings: 0,
            view: view(),
            degraded: false,
            reading: null,
            resume: { stepKey: "F2.stage", question: "What stage are you at?" },
            qualitative: [],
            trace: null,
          }),
        researchEnded: (sessionId, ok) => {
          ended.push([sessionId, ok]);
        },
      },
      logger,
    });
    const speaker = fakeSpeaker();

    const outcome = await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
      }),
      [{ role: "user", content: "Who backs seed fintech in Lagos?" }],
      new AbortController().signal,
      speaker,
    );

    expect(outcome.kind).toBe("SPOKEN");
    expect(runtime.calls.createRun).toHaveLength(1);
    expect(ended).toEqual([[SESSION_ID, true]]);
    const said = speaker.spoken.join(" ");
    expect(said).toContain("Let me look that up.");
    expect(said).toContain("What stage are you at?");
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

  it("drops a paused answer once the person has moved on to something else", async () => {
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
    // A new subject: answered on its own. What was cut is not appended
    // (live it read as Q answering two things at once); "go on" is how a
    // person asks for it, and after this it is gone.
    const next = await handle(
      bound,
      [{ role: "user", content: "Let me think" }],
      new AbortController().signal,
      speaker,
    );
    // No word list takes "let me think" any more (P0-1): it is Q's to read.
    expect(next).toEqual({ kind: "SPOKEN", path: "Q" });
    expect(speaker.spoken.join(" ")).not.toContain(
      "to finish what I was saying",
    );
    // With nothing held any more, "go on" is an ordinary sentence for Q
    // (a fresh run), not a resumption of the dropped answer.
    await handle(
      bound,
      [{ role: "user", content: "go on" }],
      new AbortController().signal,
      speaker,
    );
    // Three runs: the first question, "let me think" (Q's to read now),
    // and "go on" as a fresh sentence.
    expect(runtime.calls.createRun).toHaveLength(3);
    expect(speaker.spoken.join(" ")).not.toMatch(/picking up|where I stopped/i);
  });

  it("says nothing about searching public sources: only the answer is heard (R38)", async () => {
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
    expect(speaker.spoken).toEqual(["Paystack raised a Series A in 2018."]);
  });

  it("never narrates progress once the answer has been said (directive I)", async () => {
    // A slow run: the quiet window has long passed when its events arrive.
    const realNow = Date.now.bind(Date);
    const started = realNow();
    let offset = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => {
      offset += 2_000;
      return started + offset;
    });
    try {
      const runtime = fakeRuntime();
      const handle = createVoiceTurnHandler({
        qRuntime: runtime.service,
        qStream: fakeStream([
          event("q.message.completed", {
            message: {
              messageId: "m1",
              runId: RUN_ID,
              role: "Q",
              text: "Your deck is ready.",
              createdAt: NOW,
            },
          }),
          // Work the run does after its answer (an action, a follow-up
          // lookup) is not something to announce over the answer.
          event("q.stage.changed", { stage: "COMPARING_OPPORTUNITIES" }),
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
        [{ role: "user", content: "Make me a deck" }],
        new AbortController().signal,
        speaker,
      );
      const said = speaker.spoken.join(" ");
      expect(said).toContain("Your deck is ready.");
      expect(said).not.toMatch(/comparing the opportunities/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("carries the screen to the planner, and the screen follows the answer's navigation block, never the words (R21, ADR 0011)", async () => {
    const runtime = fakeRuntime();
    const board = createVoiceTurnBoard();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.completed", {
          message: {
            id: "f0000000-0000-4000-8000-000000000030",
            role: "Q",
            text: "Taking you to Discover.",
            blocks: [
              {
                kind: "UI_INTENT",
                intent: { kind: "NAVIGATE", destination: "DISCOVER" },
              },
              {
                kind: "UI_INTENT",
                intent: { kind: "SET_THEME", theme: "dark" },
              },
            ],
          },
        }),
        event("q.run.completed", { status: "COMPLETED" }),
      ]),
      logger,
      board,
    });
    const speaker = fakeSpeaker();
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
        screen: { route: "PROFILE" },
        viewing: {
          kind: "PITCH_PLAYBACK",
          companyId: "c0000000-0000-4000-8000-0000000000c1",
          mediaAssetId: "d0000000-0000-4000-8000-0000000000d1",
          positionSeconds: 62,
        },
      }),
      [{ role: "user", content: "take me to discover" }],
      new AbortController().signal,
      speaker,
    );
    // Asked of Q, like a typed turn, with the screen it was asked from.
    expect(runtime.calls.createRun).toHaveLength(1);
    expect(
      (runtime.calls.createRun[0] as { input: { screen?: unknown } }).input
        .screen,
    ).toEqual({ route: "PROFILE" });
    // R35: and the pitch moment on it, authorised by the run or dropped.
    expect(
      (runtime.calls.createRun[0] as { input: { viewing?: unknown } }).input
        .viewing,
    ).toMatchObject({ kind: "PITCH_PLAYBACK", positionSeconds: 62 });
    const turn = board.read("vs-1");
    expect(turn.navigate).toBe("DISCOVER");
    expect(turn.clientAction).toEqual({ kind: "SET_THEME", theme: "dark" });
    expect(speaker.spoken.join(" ")).toContain("Taking you to Discover.");
  });

  it("moves nothing when Q's answer carries no navigation, whatever was said", async () => {
    const runtime = fakeRuntime();
    const board = createVoiceTurnBoard();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.completed", {
          message: {
            id: "f0000000-0000-4000-8000-000000000031",
            role: "Q",
            text: 'Capital Q doesn\'t have a "queue" page. The nearest is Discover. Shall I take you there?',
          },
        }),
        event("q.run.completed", { status: "COMPLETED" }),
      ]),
      logger,
      board,
    });
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "user", content: "take me to the queue page" }],
      new AbortController().signal,
      fakeSpeaker(),
    );
    expect(board.read("vs-1").navigate).toBeNull();
    expect(
      (runtime.calls.createRun[0] as { input: { screen?: unknown } }).input
        .screen,
    ).toBeUndefined();
  });

  it("PRESENCE: puts the answer's gestures on the board for the screen, keyed by the answer", async () => {
    const runtime = fakeRuntime();
    const board = createVoiceTurnBoard();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.completed", {
          message: {
            messageId: "f0000000-0000-4000-8000-000000000041",
            role: "Q",
            text: "Revenue doubled last year. Impressive work.",
            gestures: [
              { sentence: 0, gesture: "CHART_UP" },
              { sentence: 1, gesture: "CLAP" },
            ],
          },
        }),
        event("q.run.completed", { status: "COMPLETED" }),
      ]),
      logger,
      board,
    });
    await handle(
      binding({
        conversationId: undefined,
        subjects: undefined,
        onboarding: undefined,
      }),
      [{ role: "user", content: "how did we do last year" }],
      new AbortController().signal,
      fakeSpeaker(),
    );
    expect(board.read("vs-1").presence).toEqual({
      answerId: "f0000000-0000-4000-8000-000000000041",
      gestures: [
        { sentence: 0, gesture: "CHART_UP" },
        { sentence: 1, gesture: "CLAP" },
      ],
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

  it("starts the conversation with what Q said aloud first, once (founder live 2026-10-01)", async () => {
    const runtime = fakeRuntime();
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.message.delta", { messageId: "m1", text: "Here they are. " }),
      ]),
      logger,
    });
    const bound = binding({
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
      opening: "Welcome back. There are companies in your feed.",
    });
    await handle(
      bound,
      [{ role: "user", content: "What are those companies?" }],
      new AbortController().signal,
      fakeSpeaker(),
    );
    expect(runtime.calls.createRun[0]).toMatchObject({
      input: { opening: "Welcome back. There are companies in your feed." },
    });
    expect(bound.thread.opening).toBeUndefined();
  });

  it.each([
    "Change my website to thevaultlyne.com",
    "Please make my company visible to investors",
    "Call me Dan",
  ])(
    "takes %j to Q, never to a word pattern that writes on its own say-so (ADR 0011/0016)",
    async (words) => {
      // Live before: a regex read these, asked its own yes/no and wrote
      // through the API outside the approval ledger. Now Q reads them like
      // any turn and the platform's approval binds the exact change.
      const runtime = fakeRuntime();
      const apiCalls: string[] = [];
      const handle = createVoiceTurnHandler({
        qRuntime: runtime.service,
        qStream: fakeStream([
          event("q.message.delta", { messageId: "m1", text: "Sure. " }),
        ]),
        onboarding: {
          apiBaseUrl: "http://api.test",
          fetch: ((url: string) => {
            apiCalls.push(String(url));
            return Promise.resolve(new Response("{}", { status: 500 }));
          }) as never,
        },
        logger,
      });
      const speaker = fakeSpeaker();
      await handle(
        binding({
          conversationId: undefined,
          subjects: undefined,
          onboarding: undefined,
        }),
        [{ role: "user", content: words }],
        new AbortController().signal,
        speaker,
      );
      expect(runtime.calls.createRun).toHaveLength(1);
      expect(apiCalls).toEqual([]);
      expect(speaker.spoken.join(" ")).not.toMatch(/Just to confirm/);
    },
  );

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
    // The fake run never reports its end, so Q says the yes is recorded
    // and under way rather than claiming it is done.
    expect(yes.spoken.join(" ")).toMatch(/^(Saved|Approved)\./);
    // A yes was the decision; no run was started for the word "yes".
    expect(runtime.calls.createRun).toHaveLength(1);
  });

  it("reads 'Approved.' as the approval through the decision reader, and carries the rest of the reply on (ADR 0011)", async () => {
    // Live: "Approved." matched no word list, fell through to a Q run,
    // and Q said "your approval has been noted" with nothing approved.
    const runtime = fakeRuntime();
    const approvals = { approve: [] as unknown[], reject: [] as unknown[] };
    const asked: string[] = [];
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.action.proposed", {
          proposal: {
            proposalId: "p1",
            summary: "Change what I call you to John.",
          },
        }),
        event("q.approval.required", {
          approvalId: "33333333-3333-4333-8333-333333333333",
          proposalId: "p1",
        }),
      ]),
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
      decisions: {
        read: (input) => {
          asked.push(input.question);
          // A model's reading of "Approved. And what's the weather like?"
          return Promise.resolve({
            decision: "YES" as const,
            remainder: "what's the weather like?",
          });
        },
      },
      logger,
    });
    const bound = binding({
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    });
    await handle(
      bound,
      [{ role: "user", content: "Call me John." }],
      new AbortController().signal,
      fakeSpeaker(),
    );
    const yes = fakeSpeaker();
    await handle(
      bound,
      [
        { role: "user", content: "Call me John." },
        {
          role: "agent",
          content: "Change what I call you to John. Shall I go ahead?",
        },
        { role: "user", content: "Approved. And what's the weather like?" },
      ],
      new AbortController().signal,
      yes,
    );
    expect(asked).toEqual([
      "Change what I call you to John. Shall I go ahead?",
    ]);
    expect(approvals.approve).toHaveLength(1);
    expect(yes.spoken.join(" ")).toMatch(/^(Saved|Approved)\./);
    // The remainder became the next turn: a run of its own, after the yes.
    expect(runtime.calls.createRun).toHaveLength(2);
    expect(
      (runtime.calls.createRun[1] as { input: { message: { text: string } } })
        .input.message.text,
    ).toBe("what's the weather like?");
  });

  it("leaves a proposal on screen when the reply is about something else", async () => {
    const runtime = fakeRuntime();
    const approvals = { approve: [] as unknown[], reject: [] as unknown[] };
    const handle = createVoiceTurnHandler({
      qRuntime: runtime.service,
      qStream: fakeStream([
        event("q.approval.required", {
          approvalId: "33333333-3333-4333-8333-333333333333",
          proposalId: "p1",
        }),
      ]),
      approvals: {
        approve: (command: unknown) => {
          approvals.approve.push(command);
          return Promise.resolve({} as never);
        },
        reject: (command: unknown) => {
          approvals.reject.push(command);
          return Promise.resolve({} as never);
        },
      },
      decisions: {
        read: () =>
          Promise.resolve({ decision: "UNRELATED" as const, remainder: null }),
      },
      logger,
    });
    const bound = binding({
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    });
    await handle(
      bound,
      [{ role: "user", content: "Put our website as thevaultlyne.com" }],
      new AbortController().signal,
      fakeSpeaker(),
    );
    await handle(
      bound,
      [
        { role: "user", content: "Put our website as thevaultlyne.com" },
        { role: "agent", content: "Shall I go ahead?" },
        { role: "user", content: "Hmm, what does that change exactly?" },
      ],
      new AbortController().signal,
      fakeSpeaker(),
    );
    expect(approvals.approve).toHaveLength(0);
    expect(approvals.reject).toHaveLength(0);
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
