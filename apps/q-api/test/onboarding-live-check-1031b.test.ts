import { describe, expect, it } from "vitest";

import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import {
  createOnboardingPort,
  summaryWordsFor,
} from "../src/voice/onboarding-port.js";
import { SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";

import { reading as authority } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 (production 2e79954fd, fictional founder
 * "Tidevand Cold Chain" and investor "Lauwersmeer Capital", typed). No
 * live model: the readers are fakes answering as the live ones did.
 *
 * 1. The founder's ramble was saved as the sector (TEXT in F1.categories).
 * 2. One yes to Q's summary saved only the description; the solution and
 *    how it works were each put to them again.
 * 3. The investor's thesis got a one-line paraphrase, never confirmed.
 * 4. "Consumer apps, gambling or crypto, a firm no for our LPs": the soft
 *    list, with "consumer apps" read as Gambling and Crypto.
 * 7. "A bit under a year" of runway held as 12 under a quote cut before it.
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

const RAMBLE =
  "right so, sorry, this will be a bit long. um, basically fishing boats and small seafood processors along the Danish and Norwegian coast lose a lot of catch because the cold chain breaks somewhere between the boat and the buyer. So we built these little sticker temperature loggers that go on every crate, they talk to a cheap gateway on the boat or in the truck, and our software flags any crate that's drifting out of range and tells the dispatcher who to call.";
/** The part of it the live reading gave as the sector, saved as its text. */
const CLAUSE =
  "basically fishing boats and small seafood processors along the Danish and Norwegian coast lose a lot of catch because the cold chain breaks somewhere between the boat and the buyer";
const SUMMARY =
  "You’ve built Tidevand Cold Chain for fishing boats and small seafood processors: sticker temperature loggers, gateways and software detect cold-chain breaks early and alert the right dispatcher; you serve an estimated 11 live processors across Denmark and western Norway, with site subscriptions and sticker sales. Is that an accurate summary of what the company does, the market, the solution, the business model and your current traction?";

function founderWorld() {
  return investorSession({
    journey: "founder",
    currentStepKey: "F1.description",
    servesTurnSteps: true,
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Tidevand Cold Chain (fictional)",
      "F1.stage": "seed",
    },
  });
}

describe("1. a taxonomy step never holds their words", () => {
  it("the ramble read as the sector saves nothing there, and Q is sent to the category list", async () => {
    const world = founderWorld();
    const port = createOnboardingPort({
      session: turn(world, RAMBLE).session,
      onboardingSessionId: turn(world, RAMBLE).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [RAMBLE],
      authority: () =>
        Promise.resolve(authority({ stated: ["F1.categories"] })),
    });
    // As live: the reading gave a clause of the ramble as the sector, and
    // no category holds it (before: saved as the sector's TEXT).
    const [result] = await port.record([
      {
        stepKey: "F1.categories",
        value: [CLAUSE],
        quote: CLAUSE,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("UNMATCHED");
    expect(result?.reason).toContain("category list");
    expect(world.recordedValue("F1.categories")).toBeUndefined();
  });
});

describe("2. one yes settles every field the summary it agreed to covered", () => {
  it("Q's words for each covered field are saved, though the reading's text drifted from them", async () => {
    const world = founderWorld();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: readerOf(
        reading([
          {
            stepKey: "F1.description",
            value:
              "sticker temperature loggers, gateways and software detect cold-chain breaks early and alert the right dispatcher",
            quote: "yes",
            ownWords: false,
            aboutStep: true,
            source: "STATED",
            affirms: true,
          },
          {
            // As live: the reading's text is near Q's words, not them.
            stepKey: "F9.solution",
            value:
              "Sticker temperature loggers talk to gateways, and software detects cold-chain breaks early and alerts the right dispatcher",
            quote: "yes",
            ownWords: false,
            aboutStep: true,
            source: "STATED",
            affirms: true,
          },
          {
            stepKey: "F9.how_it_works",
            value:
              "Each crate's sticker logger reports to a gateway; the software detects cold-chain breaks and alerts the dispatcher",
            quote: "yes",
            ownWords: false,
            aboutStep: true,
            source: "STATED",
            affirms: true,
          },
        ]),
      ),
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.said?.(line, "Q", SUMMARY, "F1.description");
    await conversation.said?.(line, "PERSON", "yes");
    await conversation.flush?.(line);
    for (const stepKey of [
      "F1.description",
      "F9.solution",
      "F9.how_it_works",
    ]) {
      const saved = world.recordedValue(stepKey);
      expect(saved?.type, stepKey).toBe("TEXT");
      // Q's own words from the line they agreed to, never the question.
      const text = saved?.type === "TEXT" ? saved.text : "";
      expect(text, stepKey).toContain(
        "detect cold-chain breaks early and alert the right dispatcher",
      );
      expect(text, stepKey).not.toMatch(/accurate summary|\?/u);
    }
    // Nothing of it is put to them again.
    expect(
      world
        .heldSuggestions()
        .filter(
          (s) =>
            s.status === "PENDING" &&
            ["F9.solution", "F9.how_it_works"].includes(s.stepKey),
        ),
    ).toEqual([]);
  });

  it("Q's words for a field: the statements it said back, never its question or a tag on one", () => {
    expect(
      summaryWordsFor(
        "the software detects cold-chain breaks and alerts the dispatcher",
        SUMMARY,
      ),
    ).toBe(
      "gateways and software detect cold-chain breaks early and alert the right dispatcher",
    );
    expect(
      summaryWordsFor(
        "cold-chain failures for fishing boats and small seafood processors",
        "Understood: it’s a priced equity round. You’re solving cold-chain failures for fishing boats and small seafood processors, where unnoticed temperature breaches can lead to rejected loads—is that right?",
      ),
    ).toBe(
      "You’re solving cold-chain failures for fishing boats and small seafood processors",
    );
    expect(summaryWordsFor("an unrelated pricing model", SUMMARY)).toBeNull();
  });

  it("a reading not marked as agreeing is still held for their yes, never saved", async () => {
    const world = founderWorld();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: readerOf(
        reading([
          {
            stepKey: "F9.solution",
            value:
              "Sticker temperature loggers talk to gateways, and software detects cold-chain breaks early",
            quote: RAMBLE,
            ownWords: false,
            aboutStep: true,
            source: "STATED",
          },
        ]),
      ),
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "Q", SUMMARY, "F1.description");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.flush?.(line);
    expect(world.recordedValue("F9.solution")).toBeUndefined();
  });
});

describe("3. an investor's thesis is said back and saved on their yes", () => {
  const THESIS =
    "Sectors, well, if I ramble a bit: we think food and agriculture logistics in northern Europe is badly underserved by software, so cold chain, traceability, the boring plumbing between farms, fisheries and retailers.";
  const SAY_BACK =
    "So your thesis is that food and agriculture logistics in northern Europe is badly underserved by software. Shall I save that?";

  it("the thesis step is a told-at-length field the reader and Q see as such", async () => {
    expect(SPOKEN_QUESTIONS["I11.additional_context"]).toMatch(/thesis/u);
    const world = investorSession({
      currentStepKey: "I3.sectors",
      servesTurnSteps: true,
      recorded: { "I0.investor_type": "vc", "I0.organisation_name": "Polder" },
    });
    const seen: Parameters<OnboardingTranscriptReader["read"]>[0][] = [];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: {
        read: (input) => {
          seen.push(input);
          return Promise.resolve(
            reading([
              {
                stepKey: "I11.additional_context",
                value:
                  "food and agriculture logistics in northern Europe is badly underserved by software",
                quote: THESIS,
                ownWords: true,
                aboutStep: true,
                source: "STATED",
              },
            ]),
          );
        },
      },
    });
    const line = lineOf("investor");
    await conversation.said?.(line, "PERSON", THESIS);
    await conversation.flush?.(line);
    const step = seen[0]?.steps.find(
      (s) => s.stepKey === "I11.additional_context",
    );
    expect(step?.kind).toBe("LONG_TEXT");
    expect(step?.question).toMatch(/thesis/u);
    // Held for their yes (as a founder's narrative is), never saved yet.
    expect(world.recordedValue("I11.additional_context")).toBeUndefined();
    expect(
      world
        .heldSuggestions()
        .some(
          (s) =>
            s.stepKey === "I11.additional_context" && s.status === "PENDING",
        ),
    ).toBe(true);
  });

  it("their yes to Q's say-back saves Q's words for it", async () => {
    const world = investorSession({
      currentStepKey: "I3.sectors",
      servesTurnSteps: true,
      recorded: { "I0.investor_type": "vc", "I0.organisation_name": "Polder" },
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
            stepKey: "I11.additional_context",
            value:
              "food and agriculture logistics in northern Europe is badly underserved by software",
            quote: "yes",
            ownWords: false,
            aboutStep: true,
            source: "STATED",
            affirms: true,
          },
        ]),
      ),
    });
    const line = lineOf("investor");
    await conversation.said?.(line, "PERSON", THESIS);
    await conversation.said?.(line, "Q", SAY_BACK, "I11.additional_context");
    await conversation.said?.(line, "PERSON", "yes");
    await conversation.flush?.(line);
    const saved = world.recordedValue("I11.additional_context");
    expect(saved?.type === "TEXT" ? saved.text : "").toContain(
      "badly underserved by software",
    );
  });
});

describe("4. a firm no is an outright exclusion; words no category holds stay words", () => {
  const SAID =
    "We'd rather not see consumer apps, gambling or crypto, that's a firm no for our LPs.";
  const GAMBLING = "a0000000-0000-4000-8000-0000000000a1";
  const CRYPTO = "a0000000-0000-4000-8000-0000000000a2";

  it("saves the named categories as excluded outright, with consumer apps beside them and never read as them", async () => {
    const world = investorSession({
      currentStepKey: "I3.sectors_avoid",
      servesTurnSteps: true,
      recorded: { "I0.investor_type": "vc", "I0.organisation_name": "Polder" },
      taxonomy: { gambling: GAMBLING, crypto: CRYPTO },
      taxonomyNodes: [
        {
          id: GAMBLING,
          canonicalCode: "gambling",
          displayName: "Gambling & Betting",
          parentNodeId: null,
          depth: 0,
        },
        {
          id: CRYPTO,
          canonicalCode: "speculative_crypto",
          displayName: "Speculative Crypto",
          parentNodeId: null,
          depth: 0,
        },
      ],
    });
    const offered: string[][] = [];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      // As live: the whole-list reading named Gambling and Crypto for
      // "consumer apps", the categories the other words already named.
      categories: (choice) => {
        offered.push(choice.candidates.map((c) => c.nodeId));
        return Promise.resolve([GAMBLING, CRYPTO]);
      },
      reader: readerOf(
        reading([
          {
            stepKey: "I7.sector_exclusions",
            value: ["consumer apps", "gambling", "crypto"],
            quote: SAID,
            ownWords: false,
            aboutStep: true,
            source: "STATED",
          },
        ]),
      ),
    });
    const line = lineOf("investor");
    await conversation.said?.(
      line,
      "Q",
      "Are there sectors you'd rather not see?",
      "I3.sectors_avoid",
    );
    await conversation.said?.(line, "PERSON", SAID);
    await conversation.flush?.(line);
    expect(world.recordedValue("I7.sector_exclusions")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [GAMBLING, CRYPTO],
    });
    expect(world.recordedNote("I7.sector_exclusions")).toContain(
      "consumer apps",
    );
    expect(world.recordedValue("I3.sectors_avoid")).toBeUndefined();
    // The categories the other words named were never offered for it.
    for (const candidates of offered) {
      expect(candidates).not.toContain(GAMBLING);
      expect(candidates).not.toContain(CRYPTO);
    }
  });
});

describe("7. an approximate figure is kept as they said it, never a bare figure", () => {
  const FIGURES =
    "We report in euros. Burn is about 60k a month, we have roughly 700k in the bank, so a bit under a year of runway, and revenue is around 14k a month right now, growing maybe 8 percent a month since the summer.";

  function world() {
    return investorSession({
      journey: "founder",
      currentStepKey: "F5.runway_months",
      servesTurnSteps: true,
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Tidevand Cold Chain (fictional)",
        "F1.stage": "seed",
        "F5.fin_currency": "eur",
        "F5.monthly_burn": "60000",
        "F5.cash": "700000",
      },
    });
  }
  const read = (value: number, quote: string) =>
    readerOf(
      reading([
        {
          stepKey: "F5.runway_months",
          value,
          quote,
          ownWords: false,
          aboutStep: true,
          source: "INFERRED",
        },
      ]),
    );

  it('"a bit under a year" is saved in their words, not as 12 months, and nothing bare is put to them', async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      recommendations: w.recommendations,
      reader: read(12, FIGURES),
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "PERSON", FIGURES);
    await conversation.flush?.(line);
    expect(w.recordedValue("F5.runway_months")).toEqual({
      type: "TEXT",
      text: "a bit under a year of runway",
    });
    expect(
      w.heldSuggestions().filter((s) => s.stepKey === "F5.runway_months"),
    ).toEqual([]);
  });

  it("a figure worked out from figures they gave is still held for their yes, with the words it came from", async () => {
    const SAID = "Burn is 60k a month and we have 700k in the bank.";
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      recommendations: w.recommendations,
      reader: read(11, SAID),
    });
    const line = lineOf("founder");
    await conversation.said?.(line, "PERSON", SAID);
    await conversation.flush?.(line);
    expect(w.recordedValue("F5.runway_months")).toBeUndefined();
    const held = w
      .heldSuggestions()
      .find((s) => s.stepKey === "F5.runway_months");
    expect(held?.status).toBe("PENDING");
    expect(held?.rationale).toContain("60k a month");
  });
});
