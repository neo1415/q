import { describe, expect, it } from "vitest";

import {
  INTERACTION_TYPES,
  InteractionEventSchema,
  InteractionStateSchema,
  PASS_REASONS,
  WATCH_MILESTONES,
} from "../src/interactions/contracts.js";
import {
  isClientWritable,
  isObservation,
  strengthClassFor,
} from "../src/interactions/policy.js";

/**
 * The interaction taxonomy and what it may mean (CQ-REC-008 A; doc 19 §66,
 * §167).
 *
 * These are the rules that would be easy to lose in a later refactor and
 * expensive to lose quietly: that INTEREST cannot be written by a client,
 * that a strength class is a class rather than a score, and that the
 * vocabularies stay small enough to reason about.
 */

describe("interaction taxonomy", () => {
  it("stays narrow", () => {
    // Doc 19 §167 names four item interactions; this adds the three the
    // product actually needs and no more. Fifty event types is an
    // analytics dump, not a signal layer.
    expect([...INTERACTION_TYPES]).toEqual([
      "IMPRESSION",
      "WATCH_MILESTONE",
      "PROFILE_OPEN",
      "ASK_Q",
      "SAVE",
      "UNSAVE",
      "PASS",
      "INTEREST_OBSERVED",
    ]);
    expect(WATCH_MILESTONES).toHaveLength(5);
    expect(PASS_REASONS).toHaveLength(8);
  });

  it("gives every type exactly one strength class", () => {
    for (const type of INTERACTION_TYPES) {
      expect(strengthClassFor(type)).toBeTypeOf("string");
    }
    // Doc 19 §66: watching is attention, a deliberate act is consideration,
    // a pass is a decision about now, and intent is its own thing.
    expect(strengthClassFor("IMPRESSION")).toBe("ATTENTION");
    expect(strengthClassFor("WATCH_MILESTONE")).toBe("ATTENTION");
    expect(strengthClassFor("PROFILE_OPEN")).toBe("ATTENTION");
    expect(strengthClassFor("SAVE")).toBe("CONSIDERATION");
    expect(strengthClassFor("ASK_Q")).toBe("CONSIDERATION");
    expect(strengthClassFor("PASS")).toBe("CONTEXTUAL_DECISION");
    expect(strengthClassFor("INTEREST_OBSERVED")).toBe("INTENT");
  });

  it("O: no client may write INTEREST", () => {
    // Express Interest is a consequential act that creates relationship
    // state, and CQ-NET-010 owns it. A recommendation route that could
    // write it would be a second, quieter way to start a relationship.
    expect(isClientWritable("INTEREST_OBSERVED")).toBe(false);
    for (const type of INTERACTION_TYPES) {
      if (type === "INTEREST_OBSERVED") continue;
      expect(isClientWritable(type)).toBe(true);
    }
  });

  it("separates what a client reports from what a client decides", () => {
    // Observations are reports about what someone saw; decisions change
    // durable state they will meet again. The API treats them differently,
    // and this is the single place that says which is which.
    expect(isObservation("IMPRESSION")).toBe(true);
    expect(isObservation("WATCH_MILESTONE")).toBe(true);
    expect(isObservation("PROFILE_OPEN")).toBe(true);
    expect(isObservation("ASK_Q")).toBe(true);
    expect(isObservation("SAVE")).toBe(false);
    expect(isObservation("UNSAVE")).toBe(false);
    expect(isObservation("PASS")).toBe(false);
  });
});

describe("interaction contracts", () => {
  const event = {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002",
    actorUserId: "00000000-0000-4000-8000-000000000003",
    investorOrganisationId: "00000000-0000-4000-8000-000000000004",
    companyId: "00000000-0000-4000-8000-000000000005",
    companyTenantId: "00000000-0000-4000-8000-000000000006",
    interactionType: "IMPRESSION",
    strengthClass: "ATTENTION",
    interactionVersion: "recommendation-interaction.v1",
    surface: "RECOMMENDATION_FEED",
    exposure: {
      slateId: "00000000-0000-4000-8000-000000000007",
      slateItemId: "00000000-0000-4000-8000-000000000008",
      position: 3,
      rankerVersion: "deterministic-ranker.v1",
      rankingConfigVersion: "ranking-config.v1",
    },
    mediaAssetId: null,
    watchMilestone: null,
    passReason: null,
    clientEventId: "evt-000000000001",
    sessionId: "sess-000000000001",
    occurredAt: "2026-09-30T10:00:00.000Z",
    recordedAt: "2026-09-30T10:00:01.000Z",
  };

  it("carries the exposure context future learning cannot work without", () => {
    // Doc 19 §69. Without slate, position and ranking version, "more clicks
    // means better" is uninterpretable.
    const parsed = InteractionEventSchema.parse(event);
    expect(parsed.exposure?.slateId).toBeTypeOf("string");
    expect(parsed.exposure?.position).toBe(3);
    expect(parsed.exposure?.rankingConfigVersion).toBe("ranking-config.v1");
  });

  it("has nowhere to put a question, an answer or any other prose", () => {
    // ASK_Q records that Q was asked, never what was asked: the
    // conversation belongs to the Q runtime.
    const withText = {
      ...event,
      interactionType: "ASK_Q",
      strengthClass: "CONSIDERATION",
      question: "What is their runway?",
      answer: "I can't say.",
      note: "REC008_PRIVATE_INTERACTION_CONTEXT_MUST_NOT_LEAK",
    };
    expect(() => InteractionEventSchema.parse(withText)).toThrow();
  });

  it("state answers what a feed asks and refuses what it cannot know", () => {
    const state = InteractionStateSchema.parse({
      companyId: "00000000-0000-4000-8000-000000000005",
      saved: true,
      savedAt: "2026-09-30T10:00:00.000Z",
      passed: false,
      passedAt: null,
      lastPassReason: null,
      impressionCount: 2,
      lastImpressionAt: "2026-09-30T10:00:00.000Z",
      lastInteractionAt: "2026-09-30T10:00:00.000Z",
    });
    expect(state.saved).toBe(true);
    // There is no "interest", no "score", no "affinity": nothing here can
    // answer how interested somebody is, so nothing here claims to.
    expect(Object.keys(state)).not.toContain("interest");
    expect(Object.keys(state)).not.toContain("score");
  });
});
