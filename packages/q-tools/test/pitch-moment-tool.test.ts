import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type PitchMomentPort,
} from "../src/index.js";
import {
  actorB,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * get_pitch_moment (R18). Held to:
 *   1. eligibility comes from the plan: only the pitch the Q API
 *      authorised as being viewed, for a company the firewall bound --
 *      anything else is refused before the media context is asked;
 *   2. the media context decides again: a pitch the person may not play
 *      has no transcript for them;
 *   3. windowing returns what overlaps the moment, with times in seconds;
 *   4. no transcript is UNKNOWN (or PENDING), never an empty "nothing was
 *      said".
 */

const PITCH = "f0000000-0000-4000-8000-000000000001";
const OTHER_PITCH = "f0000000-0000-4000-8000-000000000002";

const CUES = [
  { startMs: 0, endMs: 4_500, text: "We help clinics in Lagos" },
  { startMs: 100_000, endMs: 104_000, text: "Our revenue grew three times" },
  { startMs: 104_000, endMs: 107_250, text: "last year and margins held" },
  { startMs: 130_000, endMs: 132_000, text: "We are raising a seed round" },
];

function fakePitches(
  status: "AVAILABLE" | "PENDING" | "NONE" = "AVAILABLE",
  mayPlay: (actor: ActorContext) => boolean = (actor) =>
    actor.userId === actorB.userId,
) {
  const reads: { pitchId: string; atMs: number; windowMs: number }[] = [];
  const port: PitchMomentPort = {
    momentAround: (actor, query) => {
      reads.push(query);
      if (!mayPlay(actor)) return Promise.resolve(null);
      if (status !== "AVAILABLE") return Promise.resolve({ status });
      const from = Math.max(0, query.atMs - query.windowMs);
      const to = query.atMs + query.windowMs;
      return Promise.resolve({
        status,
        cues: CUES.filter((c) => c.endMs >= from && c.startMs <= to),
      });
    },
  };
  return { port, reads };
}

function viewingPlan(
  pitchId: string | null,
  companyBound = true,
): PermittedContextPlan {
  const base = planFor(
    actorB,
    "COUNTERPARTY_COMPANY_QUESTION",
    companyBound
      ? [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "NETWORK_VISIBLE",
            companyId: COMPANY_B_NETWORK,
          },
        ]
      : [{ kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" }],
  );
  return pitchId === null
    ? base
    : {
        ...base,
        viewing: {
          kind: "PITCH_PLAYBACK",
          companyId: COMPANY_B_NETWORK,
          mediaAssetId: pitchId,
          positionSeconds: 102,
        },
      };
}

function tools(port: PitchMomentPort) {
  return createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ pitchMoments: port })),
    ),
  });
}

const ask = (args: Record<string, unknown>) => ({
  callId: "m1",
  name: "get_pitch_moment",
  arguments: args,
});

type MomentData = {
  transcript: string;
  segments: { fromSeconds: number; toSeconds: number; text: string }[];
};

describe("get_pitch_moment", () => {
  it("returns what is said around the moment, with times, for the pitch being viewed", async () => {
    const { port, reads } = fakePitches();
    const outcome = await tools(port).execute(
      ask({ pitchId: PITCH, atSeconds: 102, windowSeconds: 3 }),
      contextFor(actorB, viewingPlan(PITCH)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = outcome.result.data as MomentData;
    expect(data.transcript).toBe("AVAILABLE");
    expect(data.segments).toEqual([
      {
        fromSeconds: 100,
        toSeconds: 104,
        text: "Our revenue grew three times",
      },
      {
        fromSeconds: 104,
        toSeconds: 107.25,
        text: "last year and margins held",
      },
    ]);
    expect(reads).toEqual([{ pitchId: PITCH, atMs: 102_000, windowMs: 3_000 }]);
  });

  it("defaults the window, and a pause is an empty window rather than no transcript", async () => {
    const { port } = fakePitches();
    const outcome = await tools(port).execute(
      ask({ pitchId: PITCH, atSeconds: 60, windowSeconds: 5 }),
      contextFor(actorB, viewingPlan(PITCH)),
    );
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = outcome.result.data as MomentData;
    expect(data).toMatchObject({ transcript: "AVAILABLE", segments: [] });
  });

  it("is refused before the media context is asked when nothing, or another pitch, was authorised as viewed", async () => {
    for (const plan of [
      viewingPlan(null),
      viewingPlan(OTHER_PITCH),
      viewingPlan(PITCH, false),
    ]) {
      const { port, reads } = fakePitches();
      const outcome = await tools(port).execute(
        ask({ pitchId: PITCH, atSeconds: 102 }),
        contextFor(actorB, plan),
      );
      expect(outcome.status).toBe("DENIED");
      expect(reads).toEqual([]);
    }
  });

  it("has no transcript for someone who may not play the pitch, even with the plan admitting it", async () => {
    const { port } = fakePitches("AVAILABLE", () => false);
    const outcome = await tools(port).execute(
      ask({ pitchId: PITCH, atSeconds: 102 }),
      contextFor(actorB, viewingPlan(PITCH)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
  });

  it("says UNKNOWN or PENDING, never an empty transcript, when there is none", async () => {
    for (const [status, expected] of [
      ["NONE", "UNKNOWN"],
      ["PENDING", "PENDING"],
    ] as const) {
      const { port } = fakePitches(status);
      const outcome = await tools(port).execute(
        ask({ pitchId: PITCH, atSeconds: 102 }),
        contextFor(actorB, viewingPlan(PITCH)),
      );
      if (!outcome.result.ok) throw new Error("unreachable");
      expect(outcome.result.data).toMatchObject({
        transcript: expected,
        segments: [],
      });
    }
  });

  it("refuses a window beyond the bound and a negative moment", async () => {
    const { port } = fakePitches();
    for (const args of [
      { pitchId: PITCH, atSeconds: 102, windowSeconds: 600 },
      { pitchId: PITCH, atSeconds: -1 },
    ]) {
      const outcome = await tools(port).execute(
        ask(args),
        contextFor(actorB, viewingPlan(PITCH)),
      );
      expect(outcome.status).toBe("FAILED");
      expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
    }
  });
});
