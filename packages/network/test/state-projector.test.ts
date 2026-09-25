import { describe, expect, it } from "vitest";

import type { DisclosureScope } from "@capital-q/contracts";

import {
  nextStepFor,
  projectRelationshipState,
  RELATIONSHIP_PROJECTOR_VERSION,
  RELATIONSHIP_STATE_TRANSITIONS,
  visibleToParty,
  type ProjectableEvent,
} from "../src/index.js";

/**
 * relationship-state.v1 (CQ-NET-012): the pure fold, held to its
 * properties over many random histories.
 *
 * The histories are generated from a seeded generator, not a library:
 * every run sees the same sequences, so a failure names a seed that
 * reproduces it. Deterministic tests for a deterministic function.
 */

/** mulberry32: small, fast, and good enough to shuffle event histories. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = [
  "discovered",
  "interest_expressed",
  "connection_accepted",
  "interest_declined",
  // A type v1 does not read: a newer producer's event.
  "meeting_requested",
] as const;
const SCOPES: readonly DisclosureScope[] = [
  "investor_private",
  "founder_private",
  "relationship_shared",
];

function randomHistory(seed: number): ProjectableEvent[] {
  const next = generator(seed);
  const length = 1 + Math.floor(next() * 12);
  const events: ProjectableEvent[] = [];
  for (let sequence = 1; sequence <= length; sequence += 1) {
    events.push({
      sequence,
      eventType:
        sequence === 1
          ? "discovered"
          : (TYPES[Math.floor(next() * TYPES.length)] ?? "discovered"),
      occurredAt: new Date(Date.UTC(2026, 8, 1, 0, sequence)).toISOString(),
      visibilityScope:
        sequence === 1
          ? "investor_private"
          : (SCOPES[Math.floor(next() * SCOPES.length)] ??
            "relationship_shared"),
    });
  }
  return events;
}

function shuffledWithDuplicates(
  events: readonly ProjectableEvent[],
  seed: number,
): ProjectableEvent[] {
  const next = generator(seed ^ 0x9e3779b9);
  const out = [...events, ...events.filter(() => next() < 0.4)];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

describe("relationship-state.v1 properties over 500 random histories", () => {
  it("is deterministic: any delivery order, with duplicates, folds to the same projection", () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed);
      expect(
        projectRelationshipState(shuffledWithDuplicates(history, seed)),
        `seed ${seed}`,
      ).toEqual(projectRelationshipState(history));
    }
  });

  it("is idempotent under replay: folding the history twice changes nothing", () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed);
      expect(
        projectRelationshipState([...history, ...history]),
        `seed ${seed}`,
      ).toEqual(projectRelationshipState(history));
    }
  });

  it("only ever moves along a legal transition, and never leaves CONNECTED", () => {
    for (const seed of SEEDS) {
      const projection = projectRelationshipState(randomHistory(seed));
      if (projection === null) throw new Error(`seed ${seed}: no projection`);
      let from = "DISCOVERED" as keyof typeof RELATIONSHIP_STATE_TRANSITIONS;
      for (const milestone of projection.milestones) {
        if (milestone.state === "DISCOVERED" && from === "DISCOVERED") {
          continue;
        }
        const legalTargets = Object.values(
          RELATIONSHIP_STATE_TRANSITIONS[from],
        );
        expect(
          legalTargets,
          `seed ${seed}: ${from} -> ${milestone.state}`,
        ).toContain(milestone.state);
        from = milestone.state;
      }
      expect(projection.state, `seed ${seed}`).toBe(from);
      const connectedAt = projection.milestones.findIndex(
        (m) => m.state === "CONNECTED",
      );
      if (connectedAt >= 0) {
        expect(projection.milestones.length, `seed ${seed}`).toBe(
          connectedAt + 1,
        );
        expect(projection.state).toBe("CONNECTED");
      }
    }
  });

  it("never rewrites the past: a longer history only appends to what a shorter one said", () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed);
      const cut = Math.max(1, Math.floor(history.length / 2));
      const prefix = projectRelationshipState(history.slice(0, cut));
      const whole = projectRelationshipState(history);
      if (prefix === null || whole === null) {
        throw new Error(`seed ${seed}: no projection`);
      }
      expect(whole.milestones.slice(0, prefix.milestones.length)).toEqual(
        prefix.milestones,
      );
      expect(whole.throughSequence).toBe(history.length);
    }
  });

  it("ignores event types it does not read, except to count them", () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed);
      const known = history.filter((e) => e.eventType !== "meeting_requested");
      const all = projectRelationshipState(history);
      const read = projectRelationshipState(known);
      if (all === null || read === null) continue;
      expect(all.state, `seed ${seed}`).toBe(read.state);
      expect(all.milestones).toEqual(read.milestones);
      expect(all.unrecognised).toBe(history.length - known.length);
    }
  });
});

const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 25, 10, minute)).toISOString();
const event = (
  sequence: number,
  eventType: string,
  visibilityScope: DisclosureScope = "relationship_shared",
): ProjectableEvent => ({
  sequence,
  eventType,
  occurredAt: at(sequence),
  visibilityScope,
});

describe("relationship-state.v1 examples", () => {
  it("folds the NET-010/011 path: discovered -> interest -> connected", () => {
    const projection = projectRelationshipState([
      event(1, "discovered", "investor_private"),
      event(2, "interest_expressed"),
      event(3, "connection_accepted"),
    ]);
    expect(projection).toEqual({
      version: RELATIONSHIP_PROJECTOR_VERSION,
      state: "CONNECTED",
      stateSince: at(3),
      throughSequence: 3,
      milestones: [
        { state: "DISCOVERED", at: at(1), sequence: 1 },
        { state: "INTEREST_EXPRESSED", at: at(2), sequence: 2 },
        { state: "CONNECTED", at: at(3), sequence: 3 },
      ],
      anomalies: [],
      unrecognised: 0,
    });
  });

  it("surfaces an illegal move as an anomaly and does not apply it", () => {
    const projection = projectRelationshipState([
      event(1, "discovered", "investor_private"),
      event(2, "connection_accepted"),
      event(3, "interest_declined"),
    ]);
    expect(projection?.state).toBe("DISCOVERED");
    expect(projection?.anomalies).toEqual([
      { sequence: 2, eventType: "connection_accepted", from: "DISCOVERED" },
      { sequence: 3, eventType: "interest_declined", from: "DISCOVERED" },
    ]);
  });

  it("has no projection for an empty history", () => {
    expect(projectRelationshipState([])).toBeNull();
  });

  it("never shows a company an investor's private discovery", () => {
    const privateOnly = [event(1, "discovered", "investor_private")];
    expect(
      projectRelationshipState(visibleToParty(privateOnly, "COMPANY")),
    ).toBeNull();
    expect(
      projectRelationshipState(visibleToParty(privateOnly, "INVESTOR"))?.state,
    ).toBe("DISCOVERED");

    const withInterest = [...privateOnly, event(2, "interest_expressed")];
    const company = projectRelationshipState(
      visibleToParty(withInterest, "COMPANY"),
    );
    expect(company?.state).toBe("INTEREST_EXPRESSED");
    // The company's story starts at the interest, not at the private discovery.
    expect(company?.milestones).toEqual([
      { state: "INTEREST_EXPRESSED", at: at(2), sequence: 2 },
    ]);
  });

  it("names the next step for the party asking, never a score", () => {
    expect(nextStepFor("DISCOVERED", "INVESTOR")).toBe("EXPRESS_INTEREST");
    expect(nextStepFor("DISCOVERED", "COMPANY")).toBe("NONE");
    expect(nextStepFor("INTEREST_EXPRESSED", "INVESTOR")).toBe("AWAIT_ANSWER");
    expect(nextStepFor("INTEREST_EXPRESSED", "COMPANY")).toBe(
      "ANSWER_INTEREST",
    );
    expect(nextStepFor("CONNECTED", "COMPANY")).toBe("SCHEDULE_MEETING");
    expect(nextStepFor("DECLINED", "INVESTOR")).toBe("NONE");
  });
});
