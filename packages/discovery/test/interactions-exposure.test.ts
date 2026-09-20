import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTERACTION_TYPES,
  InteractionEventSchema,
  WATCH_MILESTONES,
} from "../src/interactions/contracts.js";
import { isObservation, strengthClassFor } from "../src/interactions/policy.js";
import { RANKING_CONFIG_V1 } from "../src/ranking/config.js";

/**
 * Exposure and consideration signals (CQ-REC-008 C; doc 19 §69; doc 20
 * §70-§73).
 *
 * The passive half of the taxonomy shares the service's resolution path,
 * so what is left to prove is what makes these signals honest rather than
 * merely recorded: that an impression is an act and not a render, that a
 * milestone is bounded rather than streamed, that attention stays
 * attention, and that none of it reaches ranking.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

describe("impression semantics (doc 20 §71)", () => {
  it("B: nothing about the contract lets a rendered item become an impression", () => {
    // A server cannot prove viewport geometry and this one does not
    // pretend to. An impression exists because a client deliberately
    // reported one; the visibility rule that decides when to report is the
    // player's, and WEB-020/023 owns it. What the contract guarantees is
    // narrower and checkable: there is no field here a virtualised list
    // could fill by existing.
    const fields = Object.keys(InteractionEventSchema.shape);
    for (const speculative of [
      "visible",
      "visibleRatio",
      "dwellMs",
      "rendered",
      "inViewport",
      "preloaded",
    ]) {
      expect(fields).not.toContain(speculative);
    }
    // And no default: an event is created by a call, never by a value.
    expect(() => InteractionEventSchema.parse({})).toThrow();
  });

  it("the emission rule is written down for the surface that will implement it", () => {
    // The backend cannot enforce it, so the least it can do is state it
    // where the next packet will look.
    const doc = readFileSync(
      join(packageRoot, "..", "..", "docs", "modules", "discovery.md"),
      "utf8",
    );
    expect(doc).toContain("Impression emission");
    expect(doc.toLowerCase()).toContain("preload");
  });
});

describe("watch milestones (doc 20 §72-§73)", () => {
  it("D: the vocabulary is bounded; there is no continuous progress field", () => {
    expect([...WATCH_MILESTONES]).toEqual([
      "STARTED",
      "P25",
      "P50",
      "P75",
      "COMPLETED",
    ]);
    const fields = Object.keys(InteractionEventSchema.shape);
    // A currentTime field would invite an event per animation frame.
    for (const streaming of [
      "currentTime",
      "positionSeconds",
      "progress",
      "watchedSeconds",
      "percent",
    ]) {
      expect(fields).not.toContain(streaming);
    }
  });

  it("F: completing a video is attention and nothing else", () => {
    // Doc 19 §66 and the release invariant: viewing is never interest.
    expect(strengthClassFor("WATCH_MILESTONE")).toBe("ATTENTION");
    expect(strengthClassFor("IMPRESSION")).toBe("ATTENTION");
    expect(strengthClassFor("PROFILE_OPEN")).toBe("ATTENTION");
    // The only class that means intent belongs to a type no client writes.
    const intent = INTERACTION_TYPES.filter(
      (type) => strengthClassFor(type) === "INTENT",
    );
    expect(intent).toEqual(["INTEREST_OBSERVED"]);
  });
});

describe("consideration signals", () => {
  it("G/N: opening a profile and asking Q are observations, not decisions", () => {
    expect(isObservation("PROFILE_OPEN")).toBe(true);
    expect(isObservation("ASK_Q")).toBe(true);
    // Neither changes durable state a person meets again; only decisions do.
    expect(isObservation("SAVE")).toBe(false);
    expect(isObservation("PASS")).toBe(false);
  });

  it("N: the event has nowhere to put a question, an answer or a prompt", () => {
    const fields = Object.keys(InteractionEventSchema.shape);
    for (const content of [
      "question",
      "answer",
      "prompt",
      "text",
      "transcript",
      "note",
      "metadata",
    ]) {
      expect(fields).not.toContain(content);
    }
  });
});

describe("exposure accounting", () => {
  it("A: the exposure context doc 19 §69 requires is on the contract", () => {
    const exposure = InteractionEventSchema.shape.exposure;
    const parsed = InteractionEventSchema.parse({
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
        position: 12,
        rankerVersion: "deterministic-ranker.v1",
        rankingConfigVersion: RANKING_CONFIG_V1.version,
      },
      mediaAssetId: null,
      watchMilestone: null,
      passReason: null,
      clientEventId: "evt-000000000001",
      sessionId: "sess-000000000001",
      occurredAt: "2026-09-30T10:00:00.000Z",
      recordedAt: "2026-09-30T10:00:00.000Z",
    });
    expect(exposure).toBeDefined();
    // Without these three, "more clicks means better" is uninterpretable.
    expect(parsed.exposure?.slateId).toBeTypeOf("string");
    expect(parsed.exposure?.position).toBe(12);
    expect(parsed.exposure?.rankingConfigVersion).toBe(
      RANKING_CONFIG_V1.version,
    );
  });

  it("V: no exposure counter exists anywhere in the ranking config", () => {
    // REC-005 is untouched by this packet. A weight named for behaviour is
    // how silent personalisation would begin, so there is not one.
    const serialised = JSON.stringify(RANKING_CONFIG_V1).toLowerCase();
    for (const behaviour of [
      "impression",
      "watch",
      "save",
      "pass",
      "popularity",
      "interaction",
    ]) {
      expect(serialised).not.toContain(behaviour);
    }
  });

  it("the migration records no propensity it did not measure", () => {
    // REC-009 owns exploration. Serving is deterministic today, and
    // pretending a probability exists would poison the evaluation it is
    // meant to support.
    const migration = readFileSync(
      join(
        packageRoot,
        "..",
        "..",
        "supabase",
        "migrations",
        "20260930090000_recommendation_interactions.sql",
      ),
      "utf8",
    ).toLowerCase();
    expect(migration).not.toContain("propensity");
    expect(migration).not.toContain("probability");
    // The versioned slot a future exploration packet can use without a
    // migration: bounded metadata, and a versioned interaction.
    expect(migration).toContain("interaction_version");
    expect(migration).toContain("metadata");
  });
});
