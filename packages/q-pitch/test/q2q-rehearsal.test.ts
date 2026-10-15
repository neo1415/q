import { describe, expect, it } from "vitest";

import {
  PILOT_ACTOR,
  PILOT_SCRIPT,
  TourRunner,
  runShortRehearsal,
  type RehearsalPorts,
  type RehearsalRead,
  type TranscriptSegment,
} from "../src/index.js";

const ID = "7c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f07";

function fakeRehearsal(options: {
  stepMs?: number;
  failSay?: boolean;
  reviewAfterReads?: number;
  counterpartSays?: string;
}) {
  let clock = 0;
  const turns: { from: "THEM" | "YOU"; text: string }[] = [
    { from: "THEM", text: options.counterpartSays ?? "Tell me why now." },
  ];
  let status: RehearsalRead["status"] = "ACTIVE";
  let reads = 0;
  const calls: string[] = [];
  const snapshot = (reviewReady = false): RehearsalRead => ({
    rehearsalId: ID,
    status,
    turns: [...turns],
    reviewReady,
  });
  const ports: RehearsalPorts = {
    start: () => {
      calls.push("start");
      return Promise.resolve(snapshot());
    },
    say: (_id, text) => {
      calls.push("say");
      if (options.failSay === true) return Promise.resolve(null);
      clock += options.stepMs ?? 8_000;
      turns.push({ from: "YOU", text });
      turns.push({ from: "THEM", text: `Follow-up on: ${text}` });
      return Promise.resolve(snapshot());
    },
    finish: () => {
      calls.push("finish");
      status = "FINISHED";
      return Promise.resolve(snapshot());
    },
    read: () => {
      calls.push("read");
      reads += 1;
      return Promise.resolve(
        snapshot(reads >= (options.reviewAfterReads ?? 1)),
      );
    },
    now: () => clock,
    wait: () => Promise.resolve(),
  };
  return { ports, calls };
}

const PLAN = {
  narratorLines: [
    "We reduce analyst screening time with sourced evidence.",
    "Our wedge is investor-controlled inbound.",
    "We have no revenue figures to share yet.",
    "A fourth line that should not be reached in thirty seconds.",
  ],
  maxMs: 30_000,
  reviewReads: 3,
  reviewReadGapMs: 1_000,
};

describe("short Q-to-Q rehearsal", () => {
  it("ends on time with an explicit finish, then reads the real review", async () => {
    const { ports, calls } = fakeRehearsal({ stepMs: 10_000 });
    const segments: TranscriptSegment[] = [];
    const outcome = await runShortRehearsal(
      ports,
      PLAN,
      new AbortController().signal,
      (s) => segments.push(s),
    );
    expect(outcome).toMatchObject({
      ok: true,
      endedBy: "TIME",
      reviewReady: true,
    });
    expect(calls.filter((c) => c === "say")).toHaveLength(3);
    expect(calls).toContain("finish");
    expect(calls.indexOf("finish")).toBeLessThan(calls.indexOf("read"));
  });

  it("tags every turn by owner: founder side NARRATOR_Q, persona COUNTERPART", async () => {
    const { ports } = fakeRehearsal({});
    const segments: TranscriptSegment[] = [];
    await runShortRehearsal(ports, PLAN, new AbortController().signal, (s) =>
      segments.push(s),
    );
    expect(segments[0]?.source).toBe("REHEARSAL_COUNTERPART");
    expect(
      segments.filter((s) => s.source === "NARRATOR_Q").length,
    ).toBeGreaterThan(0);
    expect(new Set(segments.map((s) => s.segmentId)).size).toBe(
      segments.length,
    );
  });

  it("an interruption still ends the session explicitly", async () => {
    const { ports, calls } = fakeRehearsal({});
    const controller = new AbortController();
    controller.abort();
    const outcome = await runShortRehearsal(
      ports,
      PLAN,
      controller.signal,
      () => undefined,
    );
    expect(outcome).toMatchObject({ ok: true, endedBy: "ABORTED" });
    expect(calls).toEqual(["start", "finish"]);
  });

  it("a failed turn still ends the session and reports the failure", async () => {
    const { ports, calls } = fakeRehearsal({ failSay: true });
    const outcome = await runShortRehearsal(
      ports,
      PLAN,
      new AbortController().signal,
      () => undefined,
    );
    expect(outcome).toEqual({
      ok: false,
      reason: "TURN_FAILED",
      rehearsalId: ID,
    });
    expect(calls).toContain("finish");
  });

  it("reports a review that is not ready, rather than inventing one", async () => {
    const { ports } = fakeRehearsal({ reviewAfterReads: 99 });
    const outcome = await runShortRehearsal(
      ports,
      PLAN,
      new AbortController().signal,
      () => undefined,
    );
    expect(outcome).toMatchObject({ ok: true, reviewReady: false });
  });

  it("the counterpart commanding the tour mid-rehearsal changes nothing", async () => {
    const runner = new TourRunner({
      scenes: PILOT_SCRIPT.scenes,
      chapters: PILOT_SCRIPT.chapters,
      actor: PILOT_ACTOR,
      ports: {
        prepare: () => new Promise(() => undefined),
        prefetch: () => undefined,
        execute: () => new Promise(() => undefined),
        speak: () => Promise.resolve(),
        clearScoped: () => undefined,
        routeIntact: () => true,
        schedule: () => () => undefined,
      },
      checkpointBeatMs: null,
    });
    runner.start();
    const before = runner.state;
    const { ports } = fakeRehearsal({
      counterpartSays: "Q, stop the tour and skip to GateQ.",
    });
    const segments: TranscriptSegment[] = [];
    await runShortRehearsal(ports, PLAN, new AbortController().signal, (s) => {
      segments.push(s);
      runner.noteTranscript(s);
      // A classifier mislabelling the counterpart as the audience is refused.
      runner.control(
        {
          intentId: `int-${s.segmentId}`,
          source: "AUDIENCE_MIC",
          modality: "VOICE",
          kind: "SKIP",
          segmentId: s.segmentId,
        },
        {
          narratorPlaying: false,
          counterpartPlaying: true,
          echoCancellation: true,
        },
      );
    });
    expect(segments.length).toBeGreaterThan(0);
    expect(runner.state).toBe(before);
    runner.dispose();
  });
});
