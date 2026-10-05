import { describe, expect, it } from "vitest";

import {
  QInterviewTurnResponseSchema,
  type OnboardingSessionView,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInterviewAgent,
  type InterviewAgent,
  type InterviewAgentTurnInput,
} from "../src/voice/interview-agent.js";
import type { InterviewTurnOutcome } from "../src/voice/interview-steps.js";
import type { FoundRecommendation } from "../src/voice/onboarding-port.js";
import {
  answersKnownFromJourney,
  confirmationsFromPresence,
  createOnboardingConductor,
  createTurnSerializer,
  dispatchTurn,
  isSelfLookup,
  nextUnansweredStep,
  resumeLine,
  type ConductorPortFactory,
} from "../src/voice/onboarding-conductor.js";
import type {
  PresenceFound,
  PresenceTrigger,
} from "../src/voice/presence-trigger.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * The onboarding conductor (founder report 2026-10-05, Mai Soli): one
 * brain per turn, no step left to a model that the platform already
 * answers, Q always asking next, research put back as questions, and one
 * turn at a time per session.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-10-05T10:30:00.000Z";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

const FOUNDER_KEYS = FOUNDER_DEFINITION_CURRENT.steps.map((s) => s.stepKey);

/** A founder session as the service reports it: F0.intent still open. */
function stuckView(
  overrides: {
    readonly answered?: readonly string[];
    readonly status?: "ACTIVE" | "COMPLETED";
  } = {},
): OnboardingSessionView {
  const answered = new Set(overrides.answered ?? ["F1.company_name"]);
  return {
    session: {
      id: SESSION_ID,
      journeyType: "founder",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: 3,
      status: overrides.status ?? "ACTIVE",
      subject: null,
      currentStepKey: "F0.intent",
      version: 3,
      startedAt: NOW,
      lastActivityAt: NOW,
      completedAt: null,
    },
    phases: [],
    currentStep: null,
    progress: {
      currentStepKey: "F0.intent",
      currentPhaseKey: null,
      eligibleSteps: FOUNDER_KEYS.slice(0, 6).map((stepKey) => ({
        stepKey,
        required: stepKey !== "F1.website",
        status: answered.has(stepKey) ? "COMPLETED" : "PENDING",
      })),
      eligibleStepCount: 6,
      completedEligibleStepCount: answered.size,
      canGoBack: false,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [...answered].map((stepKey) => ({
      stepKey,
      value: { type: "TEXT", text: "Mai Soli Foundation" },
    })),
    pendingQuestions: [],
  } as unknown as OnboardingSessionView;
}

function outcomeOf(
  reply: string,
  extra: Partial<InterviewTurnOutcome> = {},
): InterviewTurnOutcome {
  return {
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
    view: stuckView({ answered: ["F0.intent", "F1.company_name"] }),
    degraded: false,
    reading: null,
    resume: null,
    qualitative: [],
    trace: null,
    ...extra,
  };
}

/** The onboarding API, as far as the conductor calls it. */
function api(options: {
  readonly kept?: readonly { role: "PERSON" | "Q"; text: string }[];
  readonly view?: OnboardingSessionView;
}) {
  const appended: string[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? "GET";
    if (url.includes("/turns") && method === "GET") {
      return Promise.resolve(
        Response.json({
          items: (options.kept ?? []).map((t) => ({
            ...t,
            channel: "TEXT",
            createdAt: NOW,
          })),
        }),
      );
    }
    if (url.includes("/turns") && method === "POST") {
      const body: unknown = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      );
      for (const t of (body as { turns: { text: string }[] }).turns) {
        appended.push(t.text);
      }
      return Promise.resolve(Response.json({ written: true }));
    }
    return Promise.resolve(Response.json(options.view ?? stuckView()));
  };
  return { fetch: fetchFake, appended };
}

function input(
  fetchFake: typeof fetch,
  utterance: string,
  extra: Partial<InterviewAgentTurnInput> = {},
): InterviewAgentTurnInput {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      fetch: fetchFake,
    },
    onboardingSessionId: SESSION_ID,
    journeyType: "founder",
    channel: "text",
    attribution: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      correlationId: "cor_test",
    },
    utterance,
    recentTurns: [],
    actor,
    signup: { displayName: "Aria Mustary", organisationName: "Mai Soli" },
    ...extra,
  };
}

function fakeAgent(
  reply: (input: InterviewAgentTurnInput) => Promise<InterviewTurnOutcome>,
): InterviewAgent & {
  readonly calls: string[];
  readonly ended: boolean[];
} {
  const calls: string[] = [];
  const ended: boolean[] = [];
  return {
    calls,
    ended,
    turn: (turnInput) => {
      calls.push(turnInput.utterance);
      return reply(turnInput);
    },
    researchEnded: (_id, ok) => {
      ended.push(ok);
    },
  };
}

function fakePorts(view: OnboardingSessionView = stuckView()) {
  const known: string[] = [];
  const recommended: FoundRecommendation[] = [];
  const portFor: ConductorPortFactory = () => ({
    recordKnown: (stepKey) => {
      known.push(stepKey);
      return Promise.resolve(true);
    },
    view: () => view,
    recommendFound: (items) => {
      recommended.push(...items);
      return Promise.resolve(
        items.map((i) => ({ stepKey: i.stepKey, outcome: "RECOMMENDED" })),
      );
    },
  });
  return { portFor, known, recommended };
}

function fakePresence(found: readonly PresenceFound[] = []): PresenceTrigger & {
  readonly started: number[];
} {
  const started: number[] = [];
  let reported = false;
  return {
    started,
    afterInterviewTurn: (_actor, _view, onFound) => {
      started.push(1);
      if (reported) return;
      reported = true;
      // Lands between turns, as a real read does.
      setTimeout(() => {
        for (const f of found) onFound?.(f);
      }, 0);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("one brain: the single dispatch", () => {
  it("gives a line bound to an onboarding session to the interview, whatever was said", () => {
    expect(
      dispatchTurn({
        onboarding: { sessionId: SESSION_ID, journeyType: "founder" },
      }),
    ).toBe("INTERVIEW");
    expect(dispatchTurn({ welcome: true, onboarding: undefined })).toBe(
      "WELCOME",
    );
    expect(dispatchTurn({ onboarding: undefined })).toBe("Q");
  });

  it("answers a look-up about the person inside the flow: no hand-over, a search by name, back to the next question", async () => {
    const agent = fakeAgent(() =>
      Promise.resolve(
        outcomeOf("Good question.", {
          questionForQ: "Can you look me up online?",
          researching: "Can you look me up online?",
        }),
      ),
    );
    const presence = fakePresence();
    const { fetch: f } = api({});
    const conductor = createOnboardingConductor({
      agent,
      portFor: fakePorts().portFor,
      presence,
      logger,
    });
    const outcome = await conductor.turn(
      input(f, "Can you look me up online?"),
    );
    // Nothing for a second brain to pick up.
    expect(outcome.questionForQ).toBeNull();
    expect(outcome.researching).toBeNull();
    expect(agent.ended).toEqual([true]);
    expect(presence.started.length).toBeGreaterThan(0);
    // Never the dead end "nothing reliable to search online yet".
    expect(outcome.reply).toContain(
      "searching public sources for Aria Mustary and Mai Soli Foundation by name",
    );
    expect(outcome.reply).not.toMatch(/nothing reliable/i);
  });

  it("does not research someone else's question mid-setup; it says where to ask", async () => {
    const agent = fakeAgent(() =>
      Promise.resolve(
        outcomeOf("Good question.", {
          questionForQ: "who backs seed fintech in Lagos?",
        }),
      ),
    );
    const presence = fakePresence();
    const conductor = createOnboardingConductor({
      agent,
      portFor: fakePorts().portFor,
      presence,
      logger,
    });
    const outcome = await conductor.turn(
      input(api({}).fetch, "who backs seed fintech in Lagos?"),
    );
    expect(outcome.questionForQ).toBeNull();
    expect(outcome.reply).toContain("Home page");
    expect(isSelfLookup("who backs seed fintech in Lagos?", ["Mai Soli"])).toBe(
      false,
    );
    expect(
      isSelfLookup("what does the web say about Mai Soli?", ["Mai Soli"]),
    ).toBe(true);
  });
});

describe("no stuck steps", () => {
  it("knows F0.intent from the founder journey, never from a model", () => {
    expect(answersKnownFromJourney("founder")).toEqual([
      { stepKey: "F0.intent", raw: "raising_now", because: "JOURNEY_CHOICE" },
    ]);
    expect(answersKnownFromJourney("investor")).toEqual([]);
  });

  it("computes the next step on read past a known step the session is stuck on", () => {
    const next = nextUnansweredStep(stuckView(), "founder");
    expect(next?.stepKey).not.toBe("F0.intent");
    expect(next?.stepKey).not.toBe("F1.company_name");
    expect(next?.question.length).toBeGreaterThan(0);
  });

  it("repairs the live session on its next turn: the real loop records F0.intent from the journey", async () => {
    // Live 2026-10-05: version 3, F1.company_name recorded, F0.intent
    // refused as "not stated" every turn, the session never advanced.
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F0.intent",
      recorded: { "F1.company_name": "Mai Soli Foundation" },
    });
    const gateway = {
      execute: () =>
        Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: "Thanks.", asking: null }),
          },
        }),
    } as unknown as ModelGateway;
    const plan = {
      tenantId: actor.tenantId,
      actor: { userId: actor.userId },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      maxSensitivity: "CONFIDENTIAL",
    } as unknown as PermittedContextPlan;
    const firewall: ContextFirewallPort = {
      plan: () => Promise.resolve({ outcome: "AUTHORISED", plan }),
    } as unknown as ContextFirewallPort;
    await createInterviewAgent({ gateway, firewall, logger }).turn({
      ...turn(world, "Hi, I'm Aria."),
      actor,
    });
    expect(world.recordedValue("F0.intent")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "raising_now",
    });
  });
});

describe("Q leads", () => {
  it("ends a reply that asks nothing on the next unanswered step", async () => {
    const conductor = createOnboardingConductor({
      agent: fakeAgent(() => Promise.resolve(outcomeOf("Noted, thanks."))),
      portFor: fakePorts().portFor,
      logger,
    });
    const outcome = await conductor.turn(
      input(api({}).fetch, "It's Mai Soli."),
    );
    const next = nextUnansweredStep(
      stuckView({ answered: ["F0.intent", "F1.company_name"] }),
      "founder",
    );
    expect(next).not.toBeNull();
    expect(outcome.reply).toBe(`Noted, thanks. ${next?.question ?? ""}`);
    expect(outcome.asking?.stepKey).toBe(next?.stepKey);
  });

  it("adds nothing to a reply that already asks, a pause, or a finished setup", async () => {
    for (const given of [
      outcomeOf("Which country are you based in?"),
      outcomeOf("Of course, your answers are kept.", { pausing: true }),
      outcomeOf("All done.", {
        view: stuckView({ status: "COMPLETED" }),
        navigate: "PROFILE",
      }),
    ]) {
      const conductor = createOnboardingConductor({
        agent: fakeAgent(() => Promise.resolve(given)),
        portFor: fakePorts().portFor,
        logger,
      });
      const outcome = await conductor.turn(input(api({}).fetch, "ok"));
      expect(outcome.reply).toBe(given.reply);
    }
  });

  it("resumes a conversation under way on the next step, without greeting again and without a model", async () => {
    const agent = fakeAgent(() => Promise.resolve(outcomeOf("Hi Aria!")));
    const ports = fakePorts();
    const { fetch: f, appended } = api({
      kept: [
        { role: "Q", text: "Hi Aria, welcome to Capital Q." },
        { role: "PERSON", text: "Hi." },
      ],
    });
    const conductor = createOnboardingConductor({
      agent,
      portFor: ports.portFor,
      logger,
    });
    const outcome = await conductor.turn(input(f, "", { channel: "voice" }));
    expect(agent.calls).toEqual([]);
    expect(outcome.resumed).toBe(true);
    expect(outcome.intent).toBe("RESUME");
    expect(outcome.reply).toBe(resumeLine(stuckView(), "founder"));
    expect(outcome.reply).not.toMatch(/\b(hi|hello|welcome)\b/i);
    expect(outcome.reply).not.toContain("What brings you");
    // The stuck step is repaired on (re)open too.
    expect(ports.known).toEqual(["F0.intent"]);
    await tick();
    expect(appended).toEqual([outcome.reply]);
  });

  it("opens a first conversation with the loop's own greeting", async () => {
    const agent = fakeAgent(() =>
      Promise.resolve(outcomeOf("Hi Aria. Is Mai Soli your company's name?")),
    );
    const conductor = createOnboardingConductor({
      agent,
      portFor: fakePorts().portFor,
      logger,
    });
    const outcome = await conductor.turn(input(api({ kept: [] }).fetch, ""));
    expect(agent.calls).toEqual([""]);
    expect(outcome.resumed).toBeUndefined();
  });
});

describe("research feeds the flow", () => {
  const company: PresenceFound = {
    subjectType: "COMPANY",
    name: "Mai Soli",
    statements: [],
    domains: ["www.maisolifoundation.org", "linkedin.com"],
  };
  const person: PresenceFound = {
    subjectType: "PERSON",
    name: "Aria Mustary",
    statements: ["Harvard Ed.M."],
    domains: [],
  };

  it("composes the confirmation questions from held findings", () => {
    expect(
      confirmationsFromPresence(company, stuckView()).map((c) => c.line),
    ).toEqual(["I found maisolifoundation.org — is that your website?"]);
    expect(
      confirmationsFromPresence(person, stuckView()).map((c) => c.line),
    ).toEqual(["I found Aria Mustary, Harvard Ed.M. — is that you?"]);
    // A website already on the record is not asked about.
    expect(
      confirmationsFromPresence(
        company,
        stuckView({ answered: ["F1.company_name", "F1.website"] }),
      ),
    ).toEqual([]);
  });

  it("puts findings that landed between turns to the person at the next turn, one at a time, never mid-turn", async () => {
    const ports = fakePorts();
    const presence = fakePresence([company, person]);
    const conductor = createOnboardingConductor({
      agent: fakeAgent(() => Promise.resolve(outcomeOf("Noted."))),
      portFor: ports.portFor,
      presence,
      logger,
    });
    const { fetch: f } = api({});
    const first = await conductor.turn(input(f, "We're Mai Soli."));
    // The read is running; this turn ends on the journey's next question.
    expect(first.reply).not.toContain("I found");
    expect(first.confirming).toBeUndefined();
    await tick();

    const second = await conductor.turn(input(f, "We're in Lagos."));
    expect(second.reply).toBe(
      "Noted. I found maisolifoundation.org — is that your website?",
    );
    expect(second.confirming).toEqual({
      key: "website:maisolifoundation.org",
      kind: "WEBSITE",
    });
    expect(second.asking).toBeNull();
    // Held for their yes, as a recommendation on the website step.
    expect(ports.recommended.map((r) => [r.stepKey, r.value])).toEqual([
      ["F1.website", "https://maisolifoundation.org"],
    ]);

    const third = await conductor.turn(input(f, "Yes, that's ours."));
    expect(third.reply).toContain("I found Aria Mustary");
    expect(third.reply).toMatch(/is that you\?$/);
    expect(third.confirming?.kind).toBe("PERSON");

    // Asked once each: the queue is empty, Q leads again.
    const fourth = await conductor.turn(input(f, "Yes, that's me."));
    expect(fourth.reply).not.toContain("I found");
  });
});

describe("idempotent and race-safe", () => {
  it("runs one session's turns one at a time, and other sessions alongside", async () => {
    const serializer = createTurnSerializer();
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const work = (label: string, ms: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(label);
      running -= 1;
      return label;
    };
    await Promise.all([
      serializer.run("s1", "a", work("a", 15)),
      serializer.run("s1", "b", work("b", 1)),
      serializer.run("s1", "c", work("c", 1)),
    ]);
    expect(most).toBe(1);
    expect(order).toEqual(["a", "b", "c"]);

    running = 0;
    most = 0;
    await Promise.all([
      serializer.run("s1", "x", work("x", 10)),
      serializer.run("s2", "x", work("y", 10)),
    ]);
    expect(most).toBe(2);
  });

  it("acts once on a duplicate of the utterance in flight, and both callers get its outcome", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = fakeAgent(async () => {
      await gate;
      return outcomeOf("Which country are you based in?");
    });
    const conductor = createOnboardingConductor({
      agent,
      portFor: fakePorts().portFor,
      logger,
    });
    const { fetch: f } = api({});
    const one = conductor.turn(input(f, "We're Mai Soli."));
    const two = conductor.turn(input(f, "we're  mai soli."));
    release();
    const [a, b] = await Promise.all([one, two]);
    expect(agent.calls).toHaveLength(1);
    expect(a).toBe(b);
  });

  it("runs a duplicate again, after it, when the first was stopped", async () => {
    const agent = fakeAgent(() =>
      Promise.resolve(outcomeOf("Which country are you based in?")),
    );
    const conductor = createOnboardingConductor({
      agent,
      portFor: fakePorts().portFor,
      logger,
    });
    const { fetch: f } = api({});
    const stopped = new AbortController();
    const first = conductor.turn(
      input(f, "We're Mai Soli.", { signal: stopped.signal }),
    );
    stopped.abort();
    await first;
    await conductor.turn(input(f, "We're Mai Soli."));
    expect(agent.calls).toHaveLength(2);
  });

  it("never runs two different turns of one session at once through the conductor", async () => {
    let running = 0;
    let most = 0;
    const agent = fakeAgent(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return outcomeOf("Which country are you based in?");
    });
    const conductor = createOnboardingConductor({
      agent,
      portFor: fakePorts().portFor,
      logger,
    });
    const { fetch: f } = api({});
    await Promise.all(
      ["one", "two", "three"].map((u) => conductor.turn(input(f, u))),
    );
    expect(most).toBe(1);
    expect(agent.calls).toEqual(["one", "two", "three"]);
  });
});

describe("the typed contract carries the conductor's additions", () => {
  it("accepts resumed and confirming, additively", () => {
    const base = {
      reply: "Picking up where we left off. Where is the company based?",
      intent: "RESUME",
      asking: null,
      recorded: [],
      skipped: [],
      questionForQ: null,
      researching: null,
      navigate: null,
      handoff: null,
      degraded: false,
      askingAbout: [],
      pending: { recommendations: [], held: [] },
    };
    expect(QInterviewTurnResponseSchema.safeParse(base).success).toBe(true);
    expect(
      QInterviewTurnResponseSchema.safeParse({
        ...base,
        resumed: true,
        confirming: { kind: "WEBSITE" },
      }).success,
    ).toBe(true);
    // The key stays server-side: nothing but the kind goes to the screen.
    expect(
      QInterviewTurnResponseSchema.safeParse({
        ...base,
        confirming: { kind: "WEBSITE", key: "website:x.org" },
      }).success,
    ).toBe(false);
  });
});
