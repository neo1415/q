import { describe, expect, it, vi } from "vitest";

import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QTurnAuthority,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import {
  coverageProfileFor,
  createOnboardingPort,
} from "../src/voice/onboarding-port.js";
import {
  createTypedOnboarding,
  groupedSaved,
  heldAskedOf,
  statesMore,
  withoutAccepted,
} from "../src/voice/typed-onboarding.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 on production d6f606053 (fictional founder
 * "Lobbykylm Lockers", investor "Nordlicht Saatgut Capital", typed). No
 * live model: readers and replies are fakes answering as the live ones did.
 *
 * 1. "We are raising 1.2 million euros" was read as nothing (the reading
 *    found no answer), and two lines later Q asked "Are you actively
 *    raising now?" (prompts: reader v13, typed reply v7).
 * 2. "Only well-matched inbound please" was held for a yes (correct), then
 *    "skip the rest" asked the inbound question from scratch.
 * 3. The answer to it took 23.2 s: its reading waited behind ten set-asides
 *    of the reading before, then read for 13 s.
 * 4. "industrial automation" was dropped from the sectors.
 * 5. The runway was saved as the whole sentence, burn included.
 * 6. "Never show: Gambling, Speculative crypto; consumer apps (in their
 *    words)" read as if consumer apps were a listed exclusion.
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
const SESSION = "11111111-1111-4111-8111-111111111111";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "investor" },
};
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Every required non-review step answered, but those left out. */
function essentials(except: readonly string[] = []): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const s of INVESTOR_DEFINITION_V1.steps) {
    if (!s.required || except.includes(s.stepKey)) continue;
    const c = s.configuration;
    if (c.stepType === "confirmation") continue;
    recorded[s.stepKey] =
      c.stepType === "single_select" || c.stepType === "multi_select"
        ? (c.options[0]?.optionKey ?? "")
        : c.stepType === "reference_select"
          ? "d0000000-0000-4000-8000-000000000001"
          : c.stepType === "range"
            ? "10"
            : "Nordlicht Saatgut Capital";
  }
  return recorded;
}

const INBOUND = "I10.inbound_preference";
const UNASKED = "Stay close to the mandate. Only well-matched inbound please.";

describe("2-3. a held suggestion is put to them for its yes, and that yes never waits on readings", () => {
  const READING_MS = 900;
  const SKIP_MS = 40;
  const REPLY_MS = 50;

  function world(authorities: (() => QTurnAuthority)[]) {
    const w = investorSession({
      currentStepKey: INBOUND,
      subject: FIRM,
      servesTurnSteps: true,
      recorded: essentials([INBOUND]),
    });
    const optional = INVESTOR_DEFINITION_V1.steps
      .filter(
        (s) =>
          !s.required &&
          s.configuration.stepType !== "confirmation" &&
          w.recordedValue(s.stepKey) === undefined,
      )
      .map((s) => s.stepKey)
      .slice(0, 12);
    let skips = 0;
    const fetchSlow: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if ((init?.method ?? "GET") === "POST" && /\/skip$/u.test(url)) {
        await sleep(SKIP_MS);
        skips += 1;
      }
      return w.fetch(input, init);
    };
    let reads = 0;
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: fetchSlow,
      logger,
      readAfterMs: 5,
      recommendations: w.recommendations,
      reader: {
        read: async () => {
          reads += 1;
          await sleep(READING_MS);
          // "Skip the rest": every optional step, as live.
          return reads === 1
            ? {
                answers: [],
                declined: optional.map((stepKey) => ({
                  stepKey,
                  quote: "Skip the rest of the optional ones",
                  saidSo: true,
                })),
                notKnown: [],
              }
            : { answers: [], declined: [], notKnown: [] };
        },
      },
    });
    const gateway = {
      execute: async () => {
        await sleep(REPLY_MS);
        return {
          output: {
            kind: "STRUCTURED",
            value: { reply: "Anything else?", asking: null, readBack: false },
          },
        };
      },
    } as unknown as ModelGateway;
    const pendingSeen: string[][] = [];
    let at = 0;
    const typed = createTypedOnboarding({
      conversation,
      gateway,
      recommendations: w.recommendations,
      delegation: {
        read: async (input) => {
          pendingSeen.push(input.pending.map((p) => p.stepKey));
          await sleep(REPLY_MS);
          const next = authorities[Math.min(at, authorities.length - 1)];
          at += 1;
          return next?.() ?? null;
        },
      },
      logger,
    });
    const say = async (words: string) => {
      const started = Date.now();
      const outcome = await typed.turn({ ...turn(w, words), actor });
      if (outcome === null) throw new Error("the typed path declined the turn");
      return { outcome, ms: Date.now() - started };
    };
    return { w, say, pendingSeen, skips: () => skips, optional };
  }

  /** As live: the reading held "only well-matched inbound" for a yes. */
  async function holdInbound(w: ReturnType<typeof world>["w"]) {
    await w.recommendations.recommend({
      userId: actor.userId,
      sessionId: SESSION,
      stepKey: INBOUND,
      value: { type: "SINGLE_SELECT", optionKey: "qualified" },
      rationale: `From what you said earlier: "${UNASKED}"`,
      runId: null,
    });
  }

  it('"skip the rest" puts the held suggestion to them; their yes to it is accepted at once and the read-back follows', async () => {
    const { w, say, pendingSeen } = world([
      () => authorityReading({ finishing: true }),
      // "Only well-matched ones, as I said": approves what Q put to them.
      () => authorityReading({ stated: [INBOUND], approved: [INBOUND] }),
    ]);
    await holdInbound(w);
    const skip = await say(
      "Skip the rest of the optional ones, that is everything.",
    );
    // Never the inbound question from scratch.
    expect(skip.outcome.reply).not.toMatch(/How open are you to founders/u);
    expect(skip.outcome.reply).toMatch(/Inbound: Qualified/u);
    expect(skip.outcome.reply).toMatch(/Shall I keep that\?/u);
    expect(skip.outcome.asking?.stepKey).toBe(INBOUND);

    const kept = await say("Only well-matched ones, as I said.");
    // The suggestion was offered to the reading of their words.
    expect(pendingSeen.at(-1)).toEqual([INBOUND]);
    expect(w.recordedValue(INBOUND)).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "qualified",
    });
    expect(kept.outcome.reply).toMatch(/Say yes and I'll finish/u);
    // Before: this waited on the set-asides of "skip the rest" and then a
    // whole reading of their words (live 23.2 s).
    expect(kept.ms).toBeLessThan(READING_MS);
    console.info(
      `held inbound: skip ${String(skip.ms)} ms, yes to the suggestion ${String(kept.ms)} ms`,
    );
  });

  it("a reply that does not approve it accepts nothing", async () => {
    const { w, say } = world([
      () => authorityReading({ finishing: true }),
      () => authorityReading({ stated: [INBOUND] }),
    ]);
    await holdInbound(w);
    await say("Skip the rest of the optional ones, that is everything.");
    await say("Actually, anyone can reach out.");
    expect(w.recordedValue(INBOUND)).toBeUndefined();
  });

  it("finishingLine puts a held suggestion for a needed step to them, never its question", () => {
    const missing = [
      { stepKey: INBOUND, question: "How open are you to founders?" },
    ];
    const labelOf = (key: string) =>
      coverageProfileFor("investor").fields[key]?.label;
    const said = finishingLine(
      "investor",
      { completed: false, missing },
      {
        labelOf,
        questionOf: () => "How open are you to founders reaching out to you?",
        heldFor: (key) => (key === INBOUND ? "Qualified" : null),
      },
    );
    expect(said?.reply).toMatch(/Inbound: Qualified/u);
    expect(said?.reply).not.toMatch(/How open are you/u);
    expect(said?.asking).toBe(INBOUND);
    // They could not settle it last time: the plain question again.
    const again = finishingLine(
      "investor",
      { completed: false, missing },
      {
        labelOf,
        questionOf: () => "How open are you to founders reaching out to you?",
        heldFor: () => "Qualified",
        unsettled: INBOUND,
      },
    );
    expect(again?.reply).toMatch(/How open are you/u);
  });

  it("the held step is known from the record; what code accepted is not waited for again", () => {
    const state = {
      steps: [
        {
          stepKey: INBOUND,
          status: "OPEN",
          pendingRecommendation: "Qualified",
        },
        { stepKey: "I2.investment_role", status: "OPEN" },
      ],
    } as unknown as Parameters<typeof heldAskedOf>[0];
    expect(heldAskedOf(state, INBOUND)).toBe(INBOUND);
    expect(heldAskedOf(state, "I2.investment_role")).toBeNull();
    expect(heldAskedOf(state, undefined)).toBeNull();
    const authority = authorityReading({
      stated: [INBOUND],
      approved: [INBOUND],
    });
    expect(statesMore(authority, "investor")).toBe(true);
    expect(
      statesMore(withoutAccepted(authority, new Set([INBOUND])), "investor"),
    ).toBe(false);
  });
});

describe("3. a reading's model call never waits behind the set-asides of the reading before", () => {
  it("their answer right after 'skip the rest' is on the record in about one reading, not two plus the set-asides", async () => {
    const READING_MS = 600;
    const SKIP_MS = 40;
    const w = investorSession({
      currentStepKey: "I2.investment_role",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: essentials(["I2.investment_role"]),
    });
    const optional = INVESTOR_DEFINITION_V1.steps
      .filter(
        (s) =>
          !s.required &&
          s.configuration.stepType !== "confirmation" &&
          w.recordedValue(s.stepKey) === undefined &&
          s.stepKey !== "I2.investment_role",
      )
      .map((s) => s.stepKey)
      .slice(0, 12);
    const fetchSlow: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if ((init?.method ?? "GET") === "POST" && /\/skip$/u.test(url)) {
        await sleep(SKIP_MS);
        skips += 1;
      }
      if (
        (init?.method ?? "GET") !== "GET" &&
        !/\/skip$/u.test(url) &&
        /\/(responses|batch)/u.test(url) &&
        skipsWhenAnswered === -1
      ) {
        skipsWhenAnswered = skips;
      }
      return w.fetch(input, init);
    };
    let skips = 0;
    let skipsWhenAnswered = -1;
    const LEAD = "We lead or co-lead.";
    let reads = 0;
    const reader: OnboardingTranscriptReader = {
      read: async () => {
        reads += 1;
        const at = reads;
        await sleep(READING_MS);
        return at === 1
          ? {
              answers: [],
              declined: optional.map((stepKey) => ({
                stepKey,
                quote: "Skip the rest of the optional ones",
                saidSo: true,
              })),
              notKnown: [],
            }
          : {
              answers: [
                {
                  stepKey: "I2.investment_role",
                  value: ["o1"],
                  quote: LEAD,
                  ownWords: false,
                  aboutStep: true,
                  source: "STATED",
                },
              ],
              declined: [],
              notKnown: [],
            };
      },
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: fetchSlow,
      logger,
      readAfterMs: 5,
      reader,
    });
    await conversation.said?.(
      line,
      "PERSON",
      "Skip the rest of the optional ones, that is everything.",
    );
    void conversation.flush?.(line);
    await sleep(50);
    const started = Date.now();
    await conversation.said?.(line, "PERSON", LEAD);
    expect(await conversation.answered?.(line, "LATEST")).toBe(true);
    const ms = Date.now() - started;
    expect(w.recordedValue("I2.investment_role")).toBeDefined();
    // In order: every set-aside landed before the answer was written.
    expect(skipsWhenAnswered).toBe(optional.length);
    // Before: the first reading (600 ms) and its twelve set-asides, then a
    // whole second reading (600 ms) after them.
    expect(ms).toBeLessThan(READING_MS + optional.length * SKIP_MS + 250);
    expect(ms).toBeLessThan(2 * READING_MS + optional.length * SKIP_MS - 200);
    expect(reads).toBe(2);
  });

  it("flush still waits for every reading under way, its writes included", async () => {
    const w = investorSession({
      currentStepKey: "I2.investment_role",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: essentials(["I2.investment_role"]),
    });
    let reads = 0;
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: async () => {
          reads += 1;
          // The later reading answers first; its write still comes second.
          await sleep(reads === 1 ? 300 : 50);
          return {
            answers: [
              {
                stepKey: "I2.investment_role",
                value: ["o1"],
                quote: "We lead or co-lead.",
                ownWords: false,
                aboutStep: true,
                source: "STATED",
              },
            ],
            declined: [],
            notKnown: [],
          };
        },
      },
    });
    await conversation.said?.(line, "PERSON", "We lead or co-lead.");
    void conversation.flush?.(line);
    await sleep(20);
    await conversation.said?.(line, "PERSON", "Yes, that's us.");
    expect(await conversation.flush?.(line)).toBe(true);
    expect(reads).toBe(2);
    expect(w.recordedValue("I2.investment_role")).toBeDefined();
    // One version: the second reading found it already on the record.
    expect(w.history("I2.investment_role")).toHaveLength(1);
  });
});

describe("4. a sector no category holds is kept in their words, beside the ones that matched", () => {
  const SAID =
    "We like B2B software, climate and energy tech, logistics and industrial automation. Consumer apps, gambling or crypto are a firm no for our LPs.";

  it('"industrial automation", which the category reading names none for, is kept as the note and said with the sectors', async () => {
    const w = investorSession({
      currentStepKey: "I3.sectors",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Nordlicht Saatgut Capital",
      },
      taxonomy: {
        "b2b software": "d0000000-0000-4000-8000-0000000000a1",
        logistics: "d0000000-0000-4000-8000-0000000000a2",
      },
      taxonomyAmbiguous: {
        "climate and energy tech": [
          {
            nodeId: "d0000000-0000-4000-8000-0000000000b1",
            displayName: "Energy",
          },
          {
            nodeId: "d0000000-0000-4000-8000-0000000000b2",
            // Named by their words (a category they do not name is Q's
            // reading, held for their yes: live 2026-10-31).
            displayName: "Climate Tech",
          },
        ],
        "industrial automation": [
          {
            nodeId: "d0000000-0000-4000-8000-0000000000c1",
            displayName: "Manufacturing & Industrial",
          },
          {
            nodeId: "d0000000-0000-4000-8000-0000000000c2",
            displayName: "Workflow Automation",
          },
        ],
      },
    });
    const port = createOnboardingPort({
      session: turn(w, SAID).session,
      onboardingSessionId: turn(w, SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [SAID],
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["I3.sectors"] })),
      // As live: "climate and energy tech" names both; the reading of
      // "industrial automation" names none of its candidates.
      chooseCategories: (choice) =>
        Promise.resolve(
          choice.phrase === "climate and energy tech"
            ? choice.candidates.map((c) => c.nodeId)
            : [],
        ),
    });
    const [result] = await port.record([
      {
        stepKey: "I3.sectors",
        value: [
          "B2B software",
          "climate and energy tech",
          "logistics",
          "industrial automation",
        ],
        quote: SAID,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    const saved = w.recordedValue("I3.sectors");
    expect(
      saved?.type === "RESOURCE_REFERENCE" ? saved.resourceIds : [],
    ).toHaveLength(4);
    expect(w.recordedNote("I3.sectors")).toBe("industrial automation");
  });
});

describe("5. the kept words for a field are that field's part only", () => {
  it('runway said beside the burn is saved as "a bit under a year", never the whole sentence', async () => {
    const SAID =
      "22 producers pay us monthly and we have 35 lockers live. Burn is about 40k euros a month and we have a bit under a year of runway.";
    const w = investorSession({
      journey: "founder",
      currentStepKey: "F5.runway_months",
      servesTurnSteps: true,
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Lobbykylm Lockers (fictional)",
        "F1.stage": "seed",
        "F5.fin_currency": "eur",
      },
    });
    const port = createOnboardingPort({
      session: turn(w, SAID).session,
      onboardingSessionId: turn(w, SAID).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [SAID],
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["F5.runway_months"] })),
    });
    // As live: the reader's quote is the whole sentence.
    const [result] = await port.record([
      {
        stepKey: "F5.runway_months",
        value: "a bit under a year",
        quote:
          "Burn is about 40k euros a month and we have a bit under a year of runway.",
        basis: "STATED",
        ownWords: true,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    const saved = w.recordedValue("F5.runway_months");
    expect(saved).toEqual({ type: "TEXT", text: "a bit under a year" });
  });
});

describe("6. their own words beside a list are said apart from it", () => {
  it('"Also said: consumer apps", never "; consumer apps (in their words)" inside the exclusions', async () => {
    const SAID = "Consumer apps, gambling or crypto are a firm no for our LPs.";
    const w = investorSession({
      currentStepKey: "I7.hard_exclusions",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Nordlicht Saatgut Capital",
      },
    });
    const port = createOnboardingPort({
      session: turn(w, SAID).session,
      onboardingSessionId: turn(w, SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [SAID],
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["I7.hard_exclusions"] })),
      chooseCategories: () => Promise.resolve([]),
    });
    await port.record([
      {
        stepKey: "I7.hard_exclusions",
        value: ["gambling", "crypto_speculation", "consumer apps"],
        quote: SAID,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    const state = await port.state();
    const row = state.steps.find((s) => s.stepKey === "I7.hard_exclusions");
    expect(row?.value).toMatch(
      /^Gambling, Speculative crypto\. Also said: consumer apps$/u,
    );
    const labelOf = (key: string) =>
      coverageProfileFor("investor").fields[key]?.label;
    const readBack = groupedSaved(state, "investor", labelOf).join("\n");
    expect(readBack).toMatch(
      /: Gambling, Speculative crypto\. Also said: consumer apps/u,
    );
    expect(readBack).not.toMatch(/in their words/u);
  });
});

void vi;
