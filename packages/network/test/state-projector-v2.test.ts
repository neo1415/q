import { describe, expect, it } from "vitest";

import type { DisclosureScope } from "@capital-q/contracts";

import {
  nextStepFor,
  projectorFor,
  projectRelationshipState,
  projectRelationshipStateV1,
  projectRelationshipStateV2,
  RELATIONSHIP_PROJECTOR_VERSION,
  RELATIONSHIP_PROJECTOR_VERSIONS,
  RELATIONSHIP_STATE_TRANSITIONS_V2,
  visibleToParty,
  type ProjectableEvent,
} from "../src/index.js";

/**
 * relationship-state.v2 (founder request 2026-10-02): the journey after the
 * match. Deterministic, never a model; v1 stays reproducible.
 */

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

const V1_TYPES = [
  "discovered",
  "interest_expressed",
  "connection_accepted",
  "interest_declined",
  "message_sent",
  "meeting_requested",
] as const;
const V2_TYPES = [
  ...V1_TYPES,
  "meeting_held",
  "diligence_started",
  "relationship_paused",
  "relationship_resumed",
  "relationship_passed",
  "relationship_progressed",
  "commitment_confirmed",
  "commitment_withdrawn",
] as const;
const COMMITMENT = "00000000-0000-4000-8000-0000000000c1";

function randomHistory(
  seed: number,
  types: readonly string[],
): ProjectableEvent[] {
  const next = generator(seed);
  const length = 1 + Math.floor(next() * 16);
  const events: ProjectableEvent[] = [];
  for (let sequence = 1; sequence <= length; sequence += 1) {
    const eventType =
      sequence === 1
        ? "discovered"
        : (types[Math.floor(next() * types.length)] ?? "discovered");
    events.push({
      sequence,
      eventType,
      occurredAt: new Date(Date.UTC(2026, 9, 1, 0, sequence)).toISOString(),
      visibilityScope:
        sequence === 1 ? "investor_private" : "relationship_shared",
      payload: eventType.startsWith("commitment_")
        ? {
            commitmentId: COMMITMENT,
            level: next() < 0.5 ? "INVESTED" : "SOFT",
          }
        : {},
    });
  }
  return events;
}

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 2, 10, minute)).toISOString();
const event = (
  sequence: number,
  eventType: string,
  payload: Record<string, unknown> = {},
  visibilityScope: DisclosureScope = "relationship_shared",
): ProjectableEvent => ({
  sequence,
  eventType,
  occurredAt: at(sequence),
  visibilityScope,
  payload,
});
const connected = (): ProjectableEvent[] => [
  event(1, "discovered", {}, "investor_private"),
  event(2, "interest_expressed"),
  event(3, "connection_accepted"),
];
const stateOf = (events: readonly ProjectableEvent[]) =>
  projectRelationshipStateV2(events)?.state;

describe("relationship-state.v2: the version list and v1 continuity", () => {
  it("lists every version, append-only, and v2 is current", () => {
    expect(RELATIONSHIP_PROJECTOR_VERSIONS).toEqual([
      "relationship-state.v1",
      "relationship-state.v2",
    ]);
    expect(RELATIONSHIP_PROJECTOR_VERSION).toBe("relationship-state.v2");
    expect(projectRelationshipState).toBe(projectRelationshipStateV2);
    expect(projectorFor("relationship-state.v1")).toBe(
      projectRelationshipStateV1,
    );
  });

  it("folds every v1-only history exactly as v1 did, over 500 histories", () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed, V1_TYPES);
      const v1 = projectRelationshipStateV1(history);
      const v2 = projectRelationshipStateV2(history);
      expect(v1?.version).toBe("relationship-state.v1");
      expect(v2?.version).toBe("relationship-state.v2");
      expect({ ...v2, version: null }, `seed ${seed}`).toEqual({
        ...v1,
        version: null,
      });
    }
  });

  it("is deterministic and replay-safe over 500 v2 histories, and only moves legally", () => {
    for (const seed of SEEDS) {
      const history = randomHistory(seed, V2_TYPES);
      const once = projectRelationshipStateV2(history);
      expect(
        projectRelationshipStateV2([...history].reverse()),
        `seed ${seed}`,
      ).toEqual(once);
      expect(projectRelationshipStateV2([...history, ...history])).toEqual(
        once,
      );
      // Every milestone is a table move, a resume, an investment or its
      // withdrawal: nothing else ever moves state.
      const special = new Set([
        "relationship_resumed",
        "commitment_confirmed",
        "commitment_withdrawn",
        "meeting_held",
      ]);
      let from = "DISCOVERED" as keyof typeof RELATIONSHIP_STATE_TRANSITIONS_V2;
      for (const milestone of once?.milestones ?? []) {
        if (milestone.state === "DISCOVERED" && from === "DISCOVERED") continue;
        const mover = history.find((e) => e.sequence === milestone.sequence);
        if (mover !== undefined && !special.has(mover.eventType)) {
          expect(
            RELATIONSHIP_STATE_TRANSITIONS_V2[from][mover.eventType],
            `seed ${seed}: ${from} -> ${milestone.state}`,
          ).toBe(milestone.state);
        }
        from = milestone.state;
      }
    }
  });
});

describe("relationship-state.v2 transitions", () => {
  it("a meeting held moves CONNECTED to MEETING_HELD; a second meeting is activity", () => {
    const history = [
      ...connected(),
      event(4, "meeting_held"),
      event(5, "meeting_held"),
    ];
    const projection = projectRelationshipStateV2(history);
    expect(projection?.state).toBe("MEETING_HELD");
    expect(projection?.stateSince).toBe(at(4));
    expect(projection?.anomalies).toEqual([]);
  });

  it("a meeting before the match is activity, as in v1", () => {
    expect(
      stateOf([
        event(1, "discovered", {}, "investor_private"),
        event(2, "meeting_held"),
      ]),
    ).toBe("DISCOVERED");
  });

  it("diligence after a meeting, or straight from CONNECTED", () => {
    expect(
      stateOf([
        ...connected(),
        event(4, "meeting_held"),
        event(5, "diligence_started"),
      ]),
    ).toBe("IN_DILIGENCE");
    expect(stateOf([...connected(), event(4, "diligence_started")])).toBe(
      "IN_DILIGENCE",
    );
  });

  it("a pause is lifted back to where it was", () => {
    const paused = [
      ...connected(),
      event(4, "meeting_held"),
      event(5, "diligence_started"),
      event(6, "relationship_paused", { side: "INVESTOR" }),
    ];
    expect(stateOf(paused)).toBe("PAUSED");
    expect(
      stateOf([
        ...paused,
        event(7, "relationship_resumed", { side: "INVESTOR" }),
      ]),
    ).toBe("IN_DILIGENCE");
  });

  it("a pass is final until the investor resets it, which returns to before the pass", () => {
    const passed = [
      ...connected(),
      event(4, "meeting_held"),
      event(5, "relationship_passed", { side: "INVESTOR" }),
    ];
    expect(stateOf(passed)).toBe("PASSED");
    expect(stateOf([...passed, event(6, "meeting_held")])).toBe("PASSED");
    expect(stateOf([...passed, event(6, "diligence_started")])).toBe("PASSED");
    expect(
      stateOf([
        ...passed,
        event(6, "relationship_resumed", { side: "INVESTOR" }),
      ]),
    ).toBe("MEETING_HELD");
  });

  it("a pass made while paused resets to the state before the pause", () => {
    expect(
      stateOf([
        ...connected(),
        event(4, "meeting_held"),
        event(5, "relationship_paused", { side: "INVESTOR" }),
        event(6, "relationship_passed", { side: "INVESTOR" }),
        event(7, "relationship_resumed", { side: "INVESTOR" }),
      ]),
    ).toBe("MEETING_HELD");
  });

  it("INVESTED only from a confirmed INVESTED commitment; withdrawing it goes back", () => {
    const soft = [
      ...connected(),
      event(4, "commitment_confirmed", {
        commitmentId: COMMITMENT,
        level: "SOFT",
      }),
    ];
    expect(stateOf(soft)).toBe("CONNECTED");
    // Stated is not confirmed, and an event written before levels were
    // recorded is not read as an investment.
    expect(
      stateOf([
        ...connected(),
        event(4, "commitment_stated", {
          commitmentId: COMMITMENT,
          level: "INVESTED",
        }),
        event(5, "commitment_confirmed", { commitmentId: COMMITMENT }),
      ]),
    ).toBe("CONNECTED");
    const invested = [
      ...connected(),
      event(4, "meeting_held"),
      event(5, "commitment_confirmed", {
        commitmentId: COMMITMENT,
        level: "INVESTED",
      }),
    ];
    expect(stateOf(invested)).toBe("INVESTED");
    expect(
      stateOf([
        ...invested,
        event(6, "commitment_withdrawn", {
          commitmentId: "00000000-0000-4000-8000-0000000000c2",
        }),
      ]),
    ).toBe("INVESTED");
    expect(
      stateOf([
        ...invested,
        event(6, "commitment_withdrawn", { commitmentId: COMMITMENT }),
      ]),
    ).toBe("MEETING_HELD");
  });

  it("an outcome that is not a legal move is an anomaly and changes nothing", () => {
    const early = projectRelationshipStateV2([
      event(1, "discovered", {}, "investor_private"),
      event(2, "relationship_passed", { side: "INVESTOR" }),
      event(3, "relationship_resumed", { side: "INVESTOR" }),
    ]);
    expect(early?.state).toBe("DISCOVERED");
    expect(early?.anomalies.map((a) => a.eventType)).toEqual([
      "relationship_passed",
      "relationship_resumed",
    ]);
    const progressed = projectRelationshipStateV2([
      ...connected(),
      event(4, "meeting_held"),
      event(5, "relationship_progressed", {
        side: "INVESTOR",
        step: "FOLLOW_UP_MEETING",
      }),
    ]);
    expect(progressed?.state).toBe("MEETING_HELD");
    expect(progressed?.anomalies).toEqual([]);
  });

  it("the founder's own fold sees the pass: the event is shared", () => {
    const history = [
      ...connected(),
      event(4, "meeting_held"),
      event(5, "relationship_passed", {
        passId: "00000000-0000-4000-8000-0000000000a1",
        side: "INVESTOR",
        reasonShared: false,
      }),
    ];
    expect(
      projectRelationshipStateV2(visibleToParty(history, "COMPANY"))?.state,
    ).toBe("PASSED");
  });
});

describe("nextStepFor, per relationship-state.v2 state", () => {
  it("names one plain step for each side", () => {
    const table = {
      DISCOVERED: ["EXPRESS_INTEREST", "NONE"],
      INTEREST_EXPRESSED: ["AWAIT_ANSWER", "ANSWER_INTEREST"],
      CONNECTED: ["SCHEDULE_MEETING", "SCHEDULE_MEETING"],
      DECLINED: ["NONE", "NONE"],
      MEETING_HELD: ["DECIDE_NEXT_STEP", "FOLLOW_UP"],
      IN_DILIGENCE: ["DECIDE_NEXT_STEP", "FOLLOW_UP"],
      PAUSED: ["RESUME", "NONE"],
      PASSED: ["NONE", "NONE"],
      INVESTED: ["NONE", "NONE"],
    } as const;
    for (const [state, [investor, company]] of Object.entries(table)) {
      const s = state as keyof typeof table;
      expect(nextStepFor(s, "INVESTOR"), `${state} investor`).toBe(investor);
      expect(nextStepFor(s, "COMPANY"), `${state} company`).toBe(company);
    }
    // Only the side that paused is offered Resume.
    expect(nextStepFor("PAUSED", "COMPANY", "INVESTOR", "COMPANY")).toBe(
      "RESUME",
    );
    expect(nextStepFor("PAUSED", "INVESTOR", "INVESTOR", "COMPANY")).toBe(
      "NONE",
    );
  });

  it("never offers another meeting as the default after a call", () => {
    for (const party of ["INVESTOR", "COMPANY"] as const) {
      expect(nextStepFor("MEETING_HELD", party)).not.toBe("SCHEDULE_MEETING");
    }
  });
});

/**
 * Live 2026-10-02 (worker rebuild: anomalies=2): a founder's Connection
 * Request recorded after the pair was already connected. Not a legal
 * real-world move -- they were already connected -- so the projector keeps
 * it as an anomaly and changes nothing; the request path now refuses it.
 */
describe("a second interest on a match (live anomalies)", () => {
  it("is kept as an anomaly from the match state, never applied", () => {
    const projection = projectRelationshipStateV2([
      ...connected(),
      event(4, "message_sent"),
      event(5, "meeting_scheduled"),
      event(6, "interest_expressed", {
        interestId: "00000000-0000-4000-8000-0000000000e1",
        expressedByParty: "COMPANY",
      }),
    ]);
    expect(projection?.state).toBe("CONNECTED");
    expect(projection?.anomalies).toEqual([
      { sequence: 6, eventType: "interest_expressed", from: "CONNECTED" },
    ]);
  });
});
