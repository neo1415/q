import { describe, expect, it } from "vitest";

import {
  createMeetingHost,
  createScreenWatch,
  HOST_SEES_SCREENS,
  type ScreenFrame,
} from "../src/index.js";

/** P5: Q looks at shared screens on a budget, never at cameras. */

const frame = (over: Partial<ScreenFrame>): ScreenFrame => ({
  participantId: "100",
  participantName: "Adaeze Okafor",
  type: "screenshare",
  pngBase64: "iVBORw0KGgoAAAANSUhEUgAAA".repeat(40),
  at: 0,
  ...over,
});

describe("screen watch", () => {
  it("never looks at a webcam frame", () => {
    const watch = createScreenWatch();
    expect(watch.offer(frame({ type: "webcam" }))).toBeNull();
    expect(watch.looks()).toBe(0);
  });

  it("looks once per change, no more often than the gap", () => {
    const watch = createScreenWatch({
      minGapMs: 10_000,
      maxLooks: 10,
      maxBase64Chars: 1_000_000,
    });
    expect(watch.offer(frame({ at: 0 }))).not.toBeNull();
    // The same slide, later: not looked at again.
    expect(watch.offer(frame({ at: 30_000 }))).toBeNull();
    // A new slide too soon after the last look: held.
    const next = "AAAAbbbbCCCCdddd".repeat(60);
    expect(watch.offer(frame({ at: 5_000, pngBase64: next }))).toBeNull();
    expect(watch.offer(frame({ at: 40_000, pngBase64: next }))).not.toBeNull();
    expect(watch.looks()).toBe(2);
  });

  it("stops at the per-call cap and refuses oversized frames", () => {
    const watch = createScreenWatch({
      minGapMs: 0,
      maxLooks: 2,
      maxBase64Chars: 500,
    });
    expect(watch.offer(frame({ pngBase64: "x".repeat(501) }))).toBeNull();
    expect(
      watch.offer(frame({ pngBase64: "a".repeat(100), at: 1 })),
    ).not.toBeNull();
    expect(
      watch.offer(frame({ pngBase64: "b".repeat(100), at: 2 })),
    ).not.toBeNull();
    expect(
      watch.offer(frame({ pngBase64: "c".repeat(100), at: 3 })),
    ).toBeNull();
  });
});

describe("the greeting says Q sees shared screens, only when it does", () => {
  const context = {
    meetingId: "m",
    purpose: "Intro",
    startsAt: new Date(0),
    endsAt: new Date(30 * 60_000),
    parties: [],
  };
  const greeting = (seesScreens: boolean) => {
    const host = createMeetingHost({ ...context, seesScreens });
    const out = [
      ...host.handle({
        kind: "JOIN",
        participant: { id: "1", name: "Ada", email: null },
        at: 1,
      }),
      ...host.handle({ kind: "TICK", at: 20_000 }),
    ];
    return out.flatMap((a) => (a.kind === "SAY" ? [a.text] : []))[0] ?? "";
  };
  it("adds the screen line when Q looks", () => {
    expect(greeting(true)).toContain(HOST_SEES_SCREENS);
    expect(greeting(false)).not.toContain(HOST_SEES_SCREENS);
  });
});
