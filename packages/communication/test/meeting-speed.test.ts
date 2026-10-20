import { describe, expect, it } from "vitest";

import {
  createCameraWatch,
  createMeetingHost,
  createScreenWatch,
  DEFAULT_HOST_LIMITS,
  readIntroduction,
  thumbDifference,
  type HostContext,
  type ScreenFrame,
} from "../src/index.js";

/**
 * 2026-10-20 (meetings speed): introductions read by code, an answer's first
 * sentence queued while the rest is written, exact wake-ups instead of a
 * poll, and screens/cameras looked at only when the picture changed.
 */

describe("a guest's introduction is read by code", () => {
  it("reads the plain ones: name, role and organisation as said", () => {
    expect(readIntroduction("I'm Ada Obi, partner at Acme Capital.")).toEqual({
      name: "Ada Obi",
      role: "partner",
      organisation: "Acme Capital",
    });
    expect(
      readIntroduction(
        "Hi everyone, my name is Tunde Bakare and I'm the CFO of Nixo Labs",
      ),
    ).toEqual({ name: "Tunde Bakare", role: "CFO", organisation: "Nixo Labs" });
    expect(readIntroduction("Sure. This is Grace from Lagos Angels.")).toEqual({
      name: "Grace",
      role: null,
      organisation: "Lagos Angels",
    });
    expect(
      readIntroduction(
        "It's Maria de Souza, principal with Atlas Ventures and Partners",
      ),
    ).toEqual({
      name: "Maria de Souza",
      role: "principal",
      organisation: "Atlas Ventures and Partners",
    });
  });

  it("finds no name where there is none: the model reads those", () => {
    expect(readIntroduction("I'm happy to be here")).toBeNull();
    expect(readIntroduction("Hello, I'm just listening in")).toBeNull();
    expect(readIntroduction("yeah im kemi")).toBeNull();
    expect(readIntroduction("Good morning all")).toBeNull();
  });

  it("never guesses what was not said", () => {
    expect(readIntroduction("I'm Bola.")).toEqual({
      name: "Bola",
      role: null,
      organisation: null,
    });
  });
});

const START = Date.parse("2026-10-20T10:00:00Z");
const CONTEXT: HostContext = {
  meetingId: "m-1",
  purpose: "intro call",
  startsAt: new Date(START),
  endsAt: new Date(START + 30 * 60_000),
  parties: [
    {
      userId: "u-f",
      name: "Adaeze Okafor",
      email: "f@example.test",
      side: "FOUNDER",
      organisation: "Nixo",
    },
    {
      userId: "u-i",
      name: "Bayo Ade",
      email: "i@example.test",
      side: "INVESTOR",
      organisation: "Zino Capital",
    },
  ],
};
const ADA = { id: "1", name: "Adaeze Okafor", email: null };
const BAYO = { id: "2", name: "Bayo Ade", email: null };

/** Both sides in, greeted and introduced, then a quiet room. */
function hostInCall() {
  const host = createMeetingHost(CONTEXT);
  host.handle({ kind: "JOIN", participant: ADA, at: START });
  host.handle({ kind: "JOIN", participant: BAYO, at: START + 100 });
  // Let the greetings and introduction go out.
  let at = START + 100;
  for (let i = 0; i < 200; i += 1) {
    at += 500;
    host.handle({ kind: "TICK", at });
  }
  return { host, at };
}

describe("an answer's first sentence goes out while the rest is written", () => {
  it("queues the first part, keeps composing, and adds the rest after it", () => {
    const { host, at } = hostInCall();
    const ask = host.handle({
      kind: "UTTERANCE",
      participant: ADA,
      text: "Q, what is the round size?",
      at: at + 1_000,
    });
    expect(ask.map((a) => a.kind)).toContain("COMPOSE");
    expect(host.replyPart("The deck says the round is two million.")).toBe(
      true,
    );
    const first = host.handle({ kind: "TICK", at: at + 2_500 });
    expect(first).toEqual([
      {
        kind: "SAY",
        text: "The deck says the round is two million.",
        why: "REPLY",
      },
    ]);
    // Still composing: a new question now waits for this answer.
    expect(host.phase()).toBe("ADDRESSED");
    host.reply("It closes in March.");
    const rest = host.handle({ kind: "TICK", at: at + 6_000 });
    expect(rest).toEqual([
      { kind: "SAY", text: "It closes in March.", why: "REPLY" },
    ]);
  });

  it("never says the rest after someone talked over the first part", () => {
    const { host, at } = hostInCall();
    host.handle({
      kind: "UTTERANCE",
      participant: ADA,
      text: "Q, what is the round size?",
      at: at + 1_000,
    });
    host.replyPart("The deck says the round is two million, and more.");
    host.handle({ kind: "TICK", at: at + 2_500 });
    // Bayo starts speaking over Q in a quiet room, a moment in.
    const cut = host.handle({
      kind: "SPEECH_ON",
      participantId: BAYO.id,
      at: at + 4_500,
    });
    expect(cut).toContainEqual({ kind: "STOP_SPEAKING" });
    host.handle({
      kind: "SPEECH_OFF",
      participantId: BAYO.id,
      at: at + 5_000,
    });
    host.reply("It closes in March.");
    const after = host.handle({ kind: "TICK", at: at + 30_000 });
    expect(after.filter((a) => a.kind === "SAY")).toEqual([]);
  });

  it("a stale answer's first part is refused (a newer question came)", () => {
    const { host, at } = hostInCall();
    host.handle({
      kind: "UTTERANCE",
      participant: ADA,
      text: "Q, what is the round size?",
      at: at + 1_000,
    });
    host.handle({
      kind: "UTTERANCE",
      participant: ADA,
      text: "Q, actually, who leads it?",
      at: at + 1_500,
    });
    expect(host.replyPart("The deck says the round is two million.")).toBe(
      false,
    );
  });
});

describe("the host says when it next needs the clock", () => {
  it("a line to Q in progress: due when its words have stopped", () => {
    const { host, at } = hostInCall();
    host.handle({
      kind: "PARTIAL",
      participant: ADA,
      text: "Q, what is the",
      at: at + 1_000,
    });
    expect(host.nextWakeAt()).toBe(
      at + 1_000 + (DEFAULT_HOST_LIMITS.partialGapMs ?? 900),
    );
  });

  it("a queued answer: due when the room has been quiet long enough", () => {
    const { host, at } = hostInCall();
    host.handle({
      kind: "UTTERANCE",
      participant: ADA,
      text: "Q, what is the round size?",
      at: at + 1_000,
    });
    host.reply("Two million.");
    const due = host.nextWakeAt();
    expect(due).not.toBeNull();
    // Nothing is released before it, and the answer is released at it.
    expect(
      host
        .handle({ kind: "TICK", at: (due ?? 0) - 50 })
        .filter((a) => a.kind === "SAY"),
    ).toEqual([]);
    expect(host.handle({ kind: "TICK", at: due ?? 0 })).toContainEqual({
      kind: "SAY",
      text: "Two million.",
      why: "REPLY",
    });
  });

  it("nothing waiting on the clock: no wake-up", () => {
    const { host } = hostInCall();
    expect(host.nextWakeAt()).toBeNull();
  });
});

const grey = (value: number) => new Uint8Array(32 * 18).fill(value);

const frame = (over: Partial<ScreenFrame>): ScreenFrame => ({
  participantId: "100",
  participantName: "Adaeze Okafor",
  type: "screenshare",
  pngBase64: "iVBORw0KGgo".repeat(40),
  at: 0,
  ...over,
});

describe("screens and cameras are looked at when the picture changed", () => {
  it("a moving cursor (new bytes, same picture) is not a change", () => {
    const watch = createScreenWatch();
    expect(
      watch.offer(frame({ at: 0, pngBase64: "aaaa", thumb: () => grey(100) })),
    ).not.toBeNull();
    // A minute of frames whose bytes differ but whose picture does not.
    for (let at = 500; at <= 60_000; at += 500) {
      expect(
        watch.offer(
          frame({
            at,
            pngBase64: `aaaa${String(at)}`,
            thumb: () => grey(101),
          }),
        ),
      ).toBeNull();
    }
    expect(watch.looks()).toBe(1);
    // A new slide: looked at.
    expect(
      watch.offer(
        frame({ at: 61_000, pngBase64: "bbbb", thumb: () => grey(160) }),
      ),
    ).not.toBeNull();
    expect(watch.looks()).toBe(2);
  });

  it("an unchanged screen is decoded at most once a second", () => {
    const watch = createScreenWatch();
    let decoded = 0;
    const thumb = () => {
      decoded += 1;
      return grey(100);
    };
    watch.offer(frame({ at: 0, pngBase64: "x0", thumb }));
    for (let at = 15_000; at < 25_000; at += 500) {
      watch.offer(frame({ at, pngBase64: `x${String(at)}`, thumb }));
    }
    // Two frames a second for ten seconds: about ten decodes, not twenty.
    expect(decoded).toBeLessThanOrEqual(11);
  });

  it("a camera is not looked at on a timer: only a new camera or a visible change", () => {
    const watch = createCameraWatch();
    const cam = (at: number, value: number) =>
      frame({ type: "webcam", at, thumb: () => grey(value) });
    expect(watch.offer(cam(0, 90))).not.toBeNull();
    // Ten minutes of the same talking head: no more looks.
    for (let at = 500; at <= 600_000; at += 500) {
      expect(watch.offer(cam(at, 92))).toBeNull();
    }
    // They hold something up to the camera.
    expect(watch.offer(cam(603_000, 150))).not.toBeNull();
    expect(watch.looks()).toBe(2);
  });

  it("thumbDifference is the mean grey difference", () => {
    expect(thumbDifference(grey(10), grey(10))).toBe(0);
    expect(thumbDifference(grey(10), grey(30))).toBe(20);
    expect(thumbDifference(grey(1), new Uint8Array(3))).toBe(255);
  });
});
