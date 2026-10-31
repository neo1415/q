import type {
  OnboardingTranscriptReader,
  TaxonomyChooser,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { REFERENCE_TAXONOMY } from "@capital-q/taxonomy";
import { describe, expect, it } from "vitest";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { wholeListParts } from "../src/voice/onboarding-port.js";
import { investorSession } from "./interviewer-fixtures.js";

/**
 * Live recheck 2026-10-30 (production 891425cbe, sessions n1 90fbb01e and
 * n2 f091780e). No live model: the reading and the category reader are
 * fakes that answer as a model would from what they are shown.
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

const lineFor = (journeyType: "investor" | "founder"): ConversationLine => ({
  voiceSessionId: `typed:f0000000-0000-4000-8000-0000000000${journeyType === "investor" ? "21" : "22"}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: {
    sessionId: `f0000000-0000-4000-8000-0000000000${journeyType === "investor" ? "21" : "22"}`,
    journeyType,
  },
});

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

const readerReturning = (reading: Reading): OnboardingTranscriptReader => ({
  read: () => Promise.resolve(reading),
});

const GEOGRAPHY = REFERENCE_TAXONOMY.nodes
  .filter((node) => node.vocabularyCode === "geography")
  .map((node) => ({
    id: node.id,
    canonicalCode: node.canonicalCode,
    displayName: node.displayName,
    parentNodeId: node.parentNodeId,
    depth: node.depth,
  }));
const geo = (code: string): string => {
  const node = GEOGRAPHY.find((n) => n.canonicalCode === code);
  if (node === undefined) throw new Error(`no geography node ${code}`);
  return node.id;
};

describe("item 1: the geography list holds every country; its whole list is read in parts", () => {
  it("a list that fits one reading is one part, as before", () => {
    const small = GEOGRAPHY.slice(0, 40).map((n) => ({
      nodeId: n.id,
      displayName: n.displayName,
      vocabularyCode: "geography",
      parentNodeId: n.parentNodeId,
    }));
    const parts = wholeListParts(small);
    expect(parts).toHaveLength(1);
    expect(parts?.[0]).toHaveLength(40);
  });

  it("270 entries: parts of at most 80, each region whole with every country in it", () => {
    const nodes = GEOGRAPHY.map((n) => ({
      nodeId: n.id,
      displayName: n.displayName,
      vocabularyCode: "geography",
      parentNodeId: n.parentNodeId,
    }));
    const parts = wholeListParts(nodes);
    expect(parts).not.toBeNull();
    if (parts === null) return;
    expect(parts.length).toBeLessThanOrEqual(5);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(80);
    // Everything offered, once.
    const offered = parts.flat().map((c) => c.nodeId);
    expect(offered).toHaveLength(270);
    expect(new Set(offered).size).toBe(270);
    // Benelux's three countries and the Nordics are read together.
    const withEurope = parts.find((part) =>
      part.some((c) => c.nodeId === geo("europe")),
    );
    for (const code of [
      "belgium",
      "netherlands",
      "luxembourg",
      "nordics",
      "denmark",
      "spain",
      "poland",
    ]) {
      expect(
        withEurope?.some((c) => c.nodeId === geo(code)),
        code,
      ).toBe(true);
    }
  });

  it("a branch larger than one reading is not offered", () => {
    const wide = Array.from({ length: 90 }, (_, index) => ({
      nodeId: `n${String(index)}`,
      displayName: `Child ${String(index)}`,
      vocabularyCode: "industry",
      parentNodeId: index === 0 ? null : "n0",
    }));
    expect(wholeListParts(wide)).toBeNull();
  });

  it('"Benelux and the Nordics": the Nordics by lookup, Benelux read as its three countries from the part that holds them, held for their yes', async () => {
    const world = investorSession({
      servesTurnSteps: true,
      currentStepKey: "I3.geography",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Zeewolde Capital",
      },
      // The lookup finds the region by its alias (keys as the fake lowercases).
      taxonomy: { "the nordics": geo("nordics") },
      taxonomyNodes: GEOGRAPHY,
    });
    const offered: number[] = [];
    const categories: TaxonomyChooser = (input) => {
      offered.push(input.candidates.length);
      // As a model reads it: Benelux is Belgium, the Netherlands and
      // Luxembourg, when the part it is shown lists them.
      const benelux = new Set([
        geo("belgium"),
        geo("netherlands"),
        geo("luxembourg"),
      ]);
      return Promise.resolve(
        input.phrase === "Benelux"
          ? input.candidates
              .filter((c) => benelux.has(c.nodeId))
              .map((c) => c.nodeId)
          : [],
      );
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      categories,
      recommendations: world.recommendations,
      reader: readerReturning({
        answers: [
          {
            stepKey: "I3.geography",
            value: ["Benelux", "the Nordics"],
            quote: "Benelux and the Nordics",
            ownWords: false,
          },
        ],
        declined: [],
      }),
    });
    const line = lineFor("investor");
    await conversation.said?.(
      line,
      "Q",
      "Which markets do you invest in?",
      "I3.geography",
    );
    await conversation.said?.(line, "PERSON", "Benelux and the Nordics");
    await conversation.flush?.(line);
    // Live 2026-10-31: the countries "Benelux" was read as are Q's reading
    // of words that do not name them, so the mandate never records them as
    // declared; the whole reading is held for their yes.
    expect(world.recordedValue("I3.geography")).toBeUndefined();
    const held = world
      .heldSuggestions()
      .filter((s) => s.stepKey === "I3.geography" && s.status === "PENDING");
    expect(held).toHaveLength(1);
    const saved = held[0]?.value;
    expect(saved?.type).toBe("RESOURCE_REFERENCE");
    expect(
      saved?.type === "RESOURCE_REFERENCE" ? [...saved.resourceIds].sort() : [],
    ).toEqual(
      [
        geo("belgium"),
        geo("netherlands"),
        geo("luxembourg"),
        geo("nordics"),
      ].sort(),
    );
    // Every reading was offered at most 80 categories.
    expect(offered.length).toBeGreaterThan(1);
    for (const count of offered) expect(count).toBeLessThanOrEqual(80);
  });
});

describe("item 2: a confirmed answer changes only on words about that step", () => {
  const DESCRIPTION = "Autonomous inspection robots for warehouse racking.";
  const run = async (options: {
    readonly askedStep: string;
    readonly askedText: string;
    readonly said: string;
    readonly quote: string;
    readonly aboutStep: boolean;
  }) => {
    const world = investorSession({
      servesTurnSteps: true,
      journey: "founder",
      currentStepKey: "F1.website",
      subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000000003" },
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Brightkade Systems",
        // Kept from their deck before this exchange.
        "F1.description": DESCRIPTION,
      },
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader: readerReturning({
        answers: [
          {
            stepKey: "F1.website",
            value: "https://brightkade-systems.example",
            quote: "brightkade-systems.example",
            ownWords: false,
          },
          {
            stepKey: "F1.description",
            value: "Robotics for warehouse logistics.",
            quote: options.quote,
            ownWords: true,
            aboutStep: options.aboutStep,
          },
        ],
        declined: [],
      }),
    });
    const line = lineFor("founder");
    await conversation.said?.(line, "Q", options.askedText, options.askedStep);
    await conversation.said?.(line, "PERSON", options.said);
    await conversation.flush?.(line);
    return world;
  };

  it("live wording: the answer to the industry question never replaces the description they kept", async () => {
    const world = await run({
      askedStep: "F1.website",
      askedText:
        "Understood: you’re raising €2.5 million for the seed round, aiming to close in Q1. Two quick optional details: what’s your website, and how would you describe the industry Brightkade operates in?",
      said: "brightkade-systems.example — robotics for warehouse logistics.",
      quote: "robotics for warehouse logistics",
      aboutStep: false,
    });
    expect(world.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: DESCRIPTION,
    });
    // The words for the question Q asked are saved.
    expect(world.recordedValue("F1.website")).toEqual({
      type: "TEXT",
      text: "https://brightkade-systems.example",
    });
  });

  it("asked about the description itself, their new words replace it", async () => {
    const world = await run({
      askedStep: "F1.description",
      askedText: "How would you describe what Brightkade does, in a line?",
      said: "Robotics for warehouse logistics.",
      quote: "Robotics for warehouse logistics.",
      aboutStep: false,
    });
    expect(world.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: "Robotics for warehouse logistics.",
    });
  });

  it("naming the description themselves, whatever Q asked, changes it", async () => {
    const world = await run({
      askedStep: "F1.website",
      askedText: "What's your website?",
      said: "Change our description to robotics for warehouse logistics.",
      quote: "robotics for warehouse logistics",
      aboutStep: true,
    });
    expect(world.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: "Robotics for warehouse logistics.",
    });
  });
});

describe("item 3: a cheque range said to another question is saved on its own turn", () => {
  it('"Usually EUR 500k to 2m per cheque", said while Q asked about inbound, saves both ends from that turn\'s reading', async () => {
    const world = investorSession({
      servesTurnSteps: true,
      currentStepKey: "I10.inbound_preference",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Zeewolde Capital",
        "I2.currency": "eur",
      },
    });
    const reads: number[] = [];
    const reader: OnboardingTranscriptReader = {
      read: (input) => {
        reads.push(input.turns.length);
        // The v6 reading: a range of amounts is its two ends.
        return Promise.resolve({
          answers: [
            {
              stepKey: "I2.cheque_min",
              value: 500000,
              quote: "Usually EUR 500k to 2m per cheque",
              ownWords: false,
            },
            {
              stepKey: "I2.cheque_max",
              value: 2000000,
              quote: "Usually EUR 500k to 2m per cheque",
              ownWords: false,
            },
          ],
          declined: [],
        });
      },
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader,
    });
    const line = lineFor("investor");
    await conversation.said?.(
      line,
      "Q",
      "How open are you to founders reaching out: only well-matched founders, anyone, or nobody for now?",
      "I10.inbound_preference",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "Usually EUR 500k to 2m per cheque",
    );
    await conversation.flush?.(line);
    expect(reads).toHaveLength(1);
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "500000",
    });
    expect(world.recordedValue("I2.cheque_max")).toEqual({
      type: "RANGE",
      value: "2000000",
    });
  });
});
