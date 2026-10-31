import { describe, expect, it, vi } from "vitest";

import type { OnboardingState } from "@capital-q/q-tools";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QTurnAuthority,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  briefOf,
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import {
  createOnboardingPort,
  summaryContent,
} from "../src/voice/onboarding-port.js";
import {
  createTypedOnboarding,
  statesMore,
} from "../src/voice/typed-onboarding.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 (production 84d8ede07, fictional founder
 * "Grannskap Harvest" and investor "Halvmåne Partners", typed). No live
 * model: readers and replies are fakes answering as the live ones did.
 *
 * 1. One ramble told the description, problem, solution and how it works;
 *    Q said back only the description, then the other three one by one.
 * 2. Saved text kept Q's lead-ins ("The process is: …") and one began in
 *    lower case ("a marketplace where…").
 * 3. "Consumer apps, gambling or crypto are a firm no": "consumer apps",
 *    which no option holds, was kept nowhere.
 * 4. "A bit under a year" of runway was not saved; Q asked it again.
 * 5. "Skip the rest" took 22.9 s and the final "yes" 19.8 s.
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
const lineOf = (journeyType: "investor" | "founder"): ConversationLine => ({
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType },
});

type Reading = NonNullable<
  Awaited<ReturnType<OnboardingTranscriptReader["read"]>>
>;
type Answer = Reading["answers"][number];
const readerOf = (...readings: Reading[]): OnboardingTranscriptReader => {
  let at = 0;
  return {
    read: () => {
      const next = readings[Math.min(at, readings.length - 1)];
      at += 1;
      return Promise.resolve(next ?? null);
    },
  };
};
const reading = (answers: Answer[]): Reading => ({
  answers,
  declined: [],
  notKnown: [],
});
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const RAMBLE =
  "I am the CEO. ok so um, this is going to be a bit of a ramble, sorry. basically small farms around Gothenburg throw away a lot of surplus veg because the big wholesalers only want perfect stock, and restaurants nearby pay too much for the same stuff. so we built this thing where farms list surplus in the morning on their phone and restaurants order it by noon and our drivers do one loop in the afternoon.";
/** One say-back for every topic the ramble told, as reply v6 asks. */
const SAY_BACK = [
  "Here's how I'd put it:",
  "What the company does: Grannskap Harvest is a marketplace connecting small farms’ surplus produce with nearby restaurants.",
  "The problem: Small farms around Gothenburg discard surplus vegetables because wholesalers demand uniform produce, while nearby restaurants pay too much for it.",
  "The solution: a marketplace where farms list surplus produce in the morning and restaurants order it by noon.",
  "How it works: farms list their surplus in the morning, restaurants order by midday, and your drivers complete one delivery route that afternoon.",
  "Is that right?",
].join(" ");

function founderWorld(recorded: Record<string, string> = {}) {
  return investorSession({
    journey: "founder",
    currentStepKey: "F1.description",
    servesTurnSteps: true,
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Grannskap Harvest (fictional)",
      "F1.stage": "seed",
      ...recorded,
    },
  });
}

const step = (
  stepKey: string,
  required: boolean,
  status: "OPEN" | "ANSWERED" = "OPEN",
) => ({
  stepKey,
  question: stepKey,
  kind: "TEXT",
  required,
  status,
  value: status === "ANSWERED" ? "Something" : null,
});

describe("1. one say-back covers every told-at-length topic, so one yes settles them", () => {
  it("the checklist asks for one say-back of every such topic told, needed or optional, never one at a time", () => {
    const brief = briefOf(
      {
        journey: "founder",
        steps: [
          step("F1.description", true),
          step("F9.problem", false),
          step("F9.solution", false),
          step("F9.how_it_works", false),
        ],
      } as unknown as OnboardingState,
      { withIds: true },
    );
    for (const key of [
      "F1.description",
      "F9.problem",
      "F9.solution",
      "F9.how_it_works",
    ]) {
      expect(brief).toMatch(new RegExp(`\\(say back\\)[^\\n]*${key}`, "u"));
    }
    expect(brief).toMatch(/needed or optional/u);
    expect(brief).toMatch(/all in one say-back/u);
    expect(brief).toMatch(/never say one back now and the others later/u);
    expect(brief).toMatch(/never framed as you telling them/u);
  });

  it("their one yes to that say-back saves all four, as content, with nothing put to them again", async () => {
    const world = founderWorld();
    const affirmed = (stepKey: string, value: string): Answer => ({
      stepKey,
      value,
      quote: "yes",
      ownWords: false,
      aboutStep: true,
      source: "STATED",
      affirms: true,
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: readerOf(
        // The ramble: each field held for their yes, in the reading's words.
        reading([
          {
            stepKey: "F9.problem",
            value:
              "Small farms around Gothenburg throw away surplus vegetables because big wholesalers only want perfect stock.",
            quote: RAMBLE,
            ownWords: false,
            aboutStep: true,
            source: "STATED",
          },
        ]),
        // Their yes: every topic the say-back spoke to, as reader v12
        // reads it, and as a reader that kept Q's topic names would.
        reading([
          affirmed(
            "F1.description",
            "Grannskap Harvest is a marketplace connecting small farms’ surplus produce with nearby restaurants.",
          ),
          affirmed(
            "F9.problem",
            "The problem: Small farms around Gothenburg discard surplus vegetables because wholesalers demand uniform produce, while nearby restaurants pay too much for it.",
          ),
          affirmed(
            "F9.solution",
            "a marketplace where farms list surplus produce in the morning and restaurants order it by noon.",
          ),
          affirmed(
            "F9.how_it_works",
            "How it works: farms list their surplus in the morning, restaurants order by midday, and your drivers complete one delivery route that afternoon.",
          ),
        ]),
      ),
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.flush?.(line);
    await conversation.said?.(line, "Q", SAY_BACK, "F1.description");
    await conversation.said?.(line, "PERSON", "yes");
    await conversation.flush?.(line);
    const text = (stepKey: string) => {
      const saved = world.recordedValue(stepKey);
      return saved?.type === "TEXT" ? saved.text : undefined;
    };
    expect(text("F1.description")).toBe(
      "Grannskap Harvest is a marketplace connecting small farms’ surplus produce with nearby restaurants.",
    );
    // 2. The content itself, cleanly cased: never Q's lead-in.
    expect(text("F9.problem")).toBe(
      "Small farms around Gothenburg discard surplus vegetables because wholesalers demand uniform produce, while nearby restaurants pay too much for it.",
    );
    expect(text("F9.solution")).toBe(
      "A marketplace where farms list surplus produce in the morning and restaurants order it by noon.",
    );
    expect(text("F9.how_it_works")).toBe(
      "Farms list their surplus in the morning, restaurants order by midday, and your drivers complete one delivery route that afternoon.",
    );
    expect(
      world
        .heldSuggestions()
        .filter(
          (s) =>
            s.status === "PENDING" &&
            ["F9.problem", "F9.solution", "F9.how_it_works"].includes(
              s.stepKey,
            ),
        ),
    ).toEqual([]);
  });
});

describe("2. a saved summary is its content, never Q's framing", () => {
  it("leaves out a topic's name before a colon, and starts with a capital", () => {
    expect(
      summaryContent(
        "The process is: farms list their surplus in the morning, restaurants order by midday.",
        "Farms list surplus in the morning on their phone.",
      ),
    ).toBe(
      "Farms list their surplus in the morning, restaurants order by midday.",
    );
    expect(
      summaryContent("a marketplace where farms list surplus produce.", null),
    ).toBe("A marketplace where farms list surplus produce.");
  });

  it("never cuts the content: a name that is the subject, a colon inside the content, or a word their reading used", () => {
    const granary =
      "Granary gives small grain co-ops in Poland sensors and a web app.";
    expect(summaryContent(granary, "Small grain co-ops in Poland.")).toBe(
      granary,
    );
    const products =
      "Two products: a sensor for each silo and a web app for the co-op.";
    expect(summaryContent(products, "Two products for grain co-ops.")).toBe(
      products,
    );
    // Too long to be a topic's name.
    const long =
      "Every week the restaurants that order through the marketplace pay: a subscription and a delivery fee.";
    expect(summaryContent(long, null)).toBe(long);
    // Idempotent.
    expect(summaryContent(summaryContent(granary, null), null)).toBe(granary);
  });
});

describe("3. the part of a list no option holds is kept and read back", () => {
  const SAID = "Consumer apps, gambling or crypto are a firm no for our LPs.";

  it('"consumer apps" is kept beside Gambling and Speculative crypto, never read as them', async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Halvmåne",
      },
    });
    const offered: string[][] = [];
    const port = createOnboardingPort({
      session: turn(world, SAID).session,
      onboardingSessionId: turn(world, SAID).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [SAID],
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["I7.hard_exclusions"] })),
      // As live for the categories: the reading of "consumer apps" named
      // the options the other words already named.
      chooseCategories: (choice) => {
        offered.push(choice.candidates.map((c) => c.nodeId));
        return Promise.resolve(["gambling", "crypto_speculation"]);
      },
    });
    const [result] = await port.record([
      {
        stepKey: "I7.hard_exclusions",
        value: ["gambling", "crypto_speculation", "consumer apps"],
        quote: SAID,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling", "crypto_speculation"],
    });
    expect(world.recordedNote("I7.hard_exclusions")).toBe("consumer apps");
    for (const candidates of offered) {
      expect(candidates).not.toContain("gambling");
      expect(candidates).not.toContain("crypto_speculation");
    }
    // The read-back (and the checklist) says it beside the list.
    const state = await port.state();
    const row = state.steps.find((s) => s.stepKey === "I7.hard_exclusions");
    expect(row?.value).toMatch(/Gambling/u);
    expect(row?.value).toMatch(/consumer apps \(in their words\)/u);
  });
});

describe("4. an approximate answer is an answer, kept in their words and never asked again", () => {
  it('"a bit under a year" of runway, read as their words (reader v12), is saved and shows as saved', async () => {
    const SAID =
      "We report in euros. Burn is about 45k a month and we have a bit under a year of runway.";
    const world = founderWorld({
      "F5.fin_currency": "eur",
      "F5.monthly_burn": "45000",
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: readerOf(
        reading([
          {
            stepKey: "F5.runway_months",
            value: "a bit under a year",
            quote: SAID,
            ownWords: true,
            aboutStep: true,
            source: "STATED",
          },
        ]),
      ),
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "PERSON", SAID);
    await conversation.flush?.(line);
    const saved = world.recordedValue("F5.runway_months");
    expect(saved?.type).toBe("TEXT");
    expect(saved?.type === "TEXT" ? saved.text : "").toMatch(
      /a bit under a year/u,
    );
    // What the reply is given: saved, so it is never asked again.
    const brief = await conversation.brief(line);
    expect(brief).toMatch(
      /runway[^\n]*\[already saved: [^\]]*bit under a year/iu,
    );
  });
});

describe("5. wrap-up turns never wait on setting aside or on a yes that adds nothing", () => {
  const READING_MS = 900;
  const SKIP_MS = 60;
  const REPLY_MS = 60;

  /** Every required non-review step answered. */
  function everyEssential(): Record<string, string> {
    const recorded: Record<string, string> = {};
    for (const s of INVESTOR_DEFINITION_V1.steps) {
      if (!s.required) continue;
      const c = s.configuration;
      if (c.stepType === "confirmation") continue;
      recorded[s.stepKey] =
        c.stepType === "single_select" || c.stepType === "multi_select"
          ? (c.options[0]?.optionKey ?? "")
          : c.stepType === "reference_select"
            ? "d0000000-0000-4000-8000-000000000001"
            : c.stepType === "range"
              ? "10"
              : "Halvmåne Partners";
    }
    return recorded;
  }

  function slowWorld(authorities: (() => QTurnAuthority)[]) {
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: everyEssential(),
    });
    const optional = INVESTOR_DEFINITION_V1.steps
      .filter(
        (s) =>
          !s.required &&
          s.configuration.stepType !== "confirmation" &&
          world.recordedValue(s.stepKey) === undefined,
      )
      .map((s) => s.stepKey)
      .slice(0, 12);
    let skips = 0;
    // Each set-aside is a write of its own on the service, as live.
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
      return world.fetch(input, init);
    };
    let reads = 0;
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: fetchSlow,
      logger,
      readAfterMs: 5,
      reader: {
        read: async () => {
          reads += 1;
          await sleep(READING_MS);
          // The second reading is "skip the rest": every optional step.
          return reads === 2
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
    let at = 0;
    const typed = createTypedOnboarding({
      conversation,
      gateway,
      delegation: {
        read: async () => {
          await sleep(REPLY_MS);
          const next = authorities[Math.min(at, authorities.length - 1)];
          at += 1;
          return next?.() ?? null;
        },
      },
      logger,
    });
    const stages: { label: string; ms: number }[] = [];
    const say = async (words: string) => {
      const started = Date.now();
      const outcome = await typed.turn({
        ...turn(world, words),
        actor,
        onStage: (s) =>
          stages.push({ label: s.label, ms: Date.now() - started }),
      });
      if (outcome === null) throw new Error("the typed path declined the turn");
      return { outcome, ms: Date.now() - started };
    };
    return { world, say, stages, skips: () => skips, optional };
  }

  it('"skip the rest" reads back at once; the yes finishes without another reading', async () => {
    const { world, say, stages, skips, optional } = slowWorld([
      () => authorityReading({}),
      () => authorityReading({ finishing: true }),
      () => authorityReading({ stated: ["I11.review"] }),
    ]);
    // An earlier answer, read as usual before they ask to finish.
    await say("Only well-matched ones.");
    await sleep(READING_MS + 200);
    const before = stages.length;
    const skip = await say(
      "Strong preferences. Skip the rest of the optional ones, that is everything.",
    );
    // Before: the reading (900 ms) then twelve set-asides one by one.
    expect(skip.ms).toBeLessThan(READING_MS);
    expect(skip.outcome.reply).toMatch(/Say yes and I'll finish/u);
    expect(stages[before]?.label).toMatch(/Checking what I have saved/u);
    expect(stages[before]?.ms ?? Infinity).toBeLessThan(READING_MS);
    // The set-asides land in the background, while they read the read-back.
    await vi.waitFor(
      () => {
        expect(skips()).toBe(optional.length);
      },
      { timeout: 5_000, interval: 20 },
    );

    const yes = await say("yes");
    // Before: the reading of "yes" (900 ms) before the finish.
    expect(yes.ms).toBeLessThan(READING_MS);
    expect(yes.outcome.view.session.status).toBe("COMPLETED");
    expect(stages.at(-1)?.label).toMatch(/Finishing your setup/u);
    console.info(
      `wrap-up: skip ${String(skip.ms)} ms (was >= ${String(READING_MS + optional.length * SKIP_MS)} ms), yes ${String(yes.ms)} ms (was >= ${String(READING_MS)} ms)`,
    );
    void world;
  });

  it("words that state something more are still waited for before the read-back", () => {
    expect(
      statesMore(
        {
          stated: new Set(["I11.review"]),
          handed: new Set(),
          approved: new Set(),
        },
        "investor",
      ),
    ).toBe(false);
    expect(
      statesMore(
        {
          stated: new Set(["I2.cheque_max"]),
          handed: new Set(),
          approved: new Set(),
        },
        "investor",
      ),
    ).toBe(true);
    expect(statesMore(null, "investor")).toBe(true);
  });
});
