import { describe, expect, it } from "vitest";

import { HOST_TAKING_LATEST, type HostContext } from "@capital-q/communication";
import type { MeetingHostResultV2 as MeetingHostResult } from "@capital-q/q-core";

import {
  createMeetingHostRuntime,
  speechPieces,
  type HeardLine,
  type MeetingHostComposer,
  type MeetingHostStore,
} from "../src/composition/meeting-host-runtime.js";

/**
 * meet2-64 (live 2026-10-04, Zino and Nixo on two laptops in one room):
 * Q's answers were composed within 2 s but said 3 minutes later, all at
 * once. Recall's participant events showed why: Meet's speaking flag stayed
 * on for 130 s on an open microphone, then flipped between the two laptops
 * every 0.3-3 s, and Q waited for a moment nobody was "speaking". These
 * replay Recall's real event shapes (realtime webhook bodies) through the
 * runtime with a fake clock, model and voice; no provider is reached.
 */

const SECRET = "recall-key-for-tests-0000000000000000";
const MEETING = "21d82131-323f-4f66-b808-b8961d8646ff";
const START = Date.parse("2026-10-04T18:38:00Z");

const CONTEXT: HostContext = {
  meetingId: MEETING,
  purpose: "check something",
  startsAt: new Date(START),
  endsAt: new Date(START + 30 * 60_000),
  parties: [
    {
      userId: "u-nixo",
      name: "Priya Khandelwal",
      email: "adetimilehin502@gmail.com",
      side: "FOUNDER",
      organisation: "Nixo",
    },
    {
      userId: "u-zino",
      name: "Zino",
      email: "adedaniel502@gmail.com",
      side: "INVESTOR",
      organisation: "Zino Aviation",
    },
  ],
};

const OYENIYI = { id: 100, name: "oyeniyi Daniel" };
const ADEMOLA = { id: 200, name: "Ademola Daniel" };

/** A Recall realtime webhook body, as Recall sends it. */
function recall(
  kind: string,
  who: { id: number; name: string },
  relative: number,
  words?: string,
) {
  return {
    event: kind,
    data: {
      data: {
        participant: {
          id: who.id,
          name: who.name,
          is_host: who.id === 100,
          platform: "desktop",
          extra_data: {},
          email: null,
        },
        ...(words === undefined
          ? {
              timestamp: {
                absolute: new Date(START + relative * 1_000).toISOString(),
                relative,
              },
            }
          : {
              words: words.split(" ").map((text, i) => ({
                text,
                start_timestamp: { relative: relative + i * 0.3 },
                end_timestamp: { relative: relative + i * 0.3 + 0.25 },
              })),
            }),
      },
      realtime_endpoint: { id: "re-1", metadata: {} },
      recording: { id: "ee0d110c-2447-4fa2-8281-9dc03ce9c9fb", metadata: {} },
      bot: {
        id: "6cf27e41-0e34-4fd0-bb40-ce33c5f537a0",
        metadata: { meeting_id: MEETING },
      },
    },
  };
}

function harness(options: {
  /** The model's answer to each question, in order; held until released. */
  readonly answers?: readonly string[];
  readonly holdModel?: boolean;
  readonly pieces?: boolean;
}) {
  const clock = { at: START };
  const spokenAt: { text: string; at: number }[] = [];
  const played: string[] = [];
  const asked: string[] = [];
  const saved: HeardLine[][] = [];
  const held: (() => void)[] = [];
  let answer = 0;
  const store: MeetingHostStore = {
    context: () =>
      Promise.resolve({
        ...CONTEXT,
        botId: "6cf27e41-0e34-4fd0-bb40-ce33c5f537a0",
        tenantId: "t-1",
        organiserUserId: "u-zino",
        declined: false,
      }),
    roster: () => Promise.resolve(),
    removedBy: () => Promise.resolve(),
    note: () => Promise.resolve(),
    heard: (_m, _b, lines) => {
      saved.push([...lines]);
      return Promise.resolve();
    },
  };
  const composer: MeetingHostComposer = {
    turn: (_who, variables) => {
      if (variables.mode === "GUEST") {
        return Promise.resolve({
          kind: "ANSWER",
          line: "",
          proposal: null,
          guest: { name: null, role: null, organisation: null },
        } as MeetingHostResult);
      }
      asked.push(variables.utterance);
      const line = options.answers?.[answer] ?? `Answer ${String(answer + 1)}.`;
      answer += 1;
      const result = {
        kind: "ANSWER",
        line,
        proposal: null,
        guest: null,
      } as MeetingHostResult;
      if (options.holdModel !== true) return Promise.resolve(result);
      return new Promise((resolve) => held.push(() => resolve(result)));
    },
  };
  const runtime = createMeetingHostRuntime({
    enabled: true,
    publicBase: "https://q-api.example",
    secret: SECRET,
    store,
    composer,
    voice: {
      speak: (text) => {
        spokenAt.push({ text, at: clock.at });
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
      play: () => {
        played.push(spokenAt.at(-1)?.text ?? "");
        return Promise.resolve();
      },
      leave: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
    now: () => clock.at,
    tickEveryMs: null,
    leaveDelayMs: 0,
    speakInPieces: options.pieces ?? false,
  });
  const at = (relative: number) => START + relative * 1_000;
  /** Events at their call times, with the 100 ms ticker in between. */
  const play = async (
    events: readonly (readonly [number, unknown])[],
    untilRelative: number,
  ) => {
    const queue = [...events].sort((a, b) => a[0] - b[0]);
    for (let t = at(0); t <= at(untilRelative); t += 100) {
      clock.at = t;
      // As the webhook does: answered at once, handled in order per call,
      // never waiting on a model call in flight.
      while (queue.length > 0 && at(queue[0]?.[0] ?? Infinity) <= t) {
        const next = queue.shift();
        if (next !== undefined) void runtime.receive(MEETING, next[1]);
      }
      void runtime.tick(MEETING);
      await new Promise((done) => setImmediate(done));
    }
  };
  const answeredAt = (text: string) =>
    spokenAt.find((s) => s.text.includes(text))?.at;
  return {
    runtime,
    clock,
    play,
    at,
    spokenAt,
    played,
    asked,
    saved,
    held,
    answeredAt,
  };
}

/** Both laptops' open microphones: Meet's flag flips every 0.3 s. */
function toggling(from: number, to: number): [number, unknown][] {
  const out: [number, unknown][] = [];
  let who = OYENIYI;
  let other = ADEMOLA;
  for (let t = from; t < to; t += 0.3) {
    out.push([t, recall("participant_events.speech_off", other, t)]);
    out.push([t, recall("participant_events.speech_on", who, t)]);
    [who, other] = [other, who];
  }
  return out;
}

const JOINS: [number, unknown][] = [
  [0, recall("participant_events.join", OYENIYI, 0)],
  [0.1, recall("participant_events.speech_on", OYENIYI, 0.1)],
];

describe("Q answers within about two seconds of a question to it", () => {
  it("replays 2026-10-04: an open microphone's flag never drops, Q still answers", async () => {
    const t = harness({ answers: ["Yes, I can hear you."] });
    await t.play(
      [
        ...JOINS,
        [
          60,
          recall(
            "transcript.data",
            OYENIYI,
            58,
            "Um, hello, Q? Can you hear me?",
          ),
        ],
      ],
      70,
    );
    const answered = t.answeredAt("Yes, I can hear you.");
    expect(answered).toBeDefined();
    // Meet's flag stayed on the whole time (speech_on at 0.1, never off).
    expect((answered ?? Infinity) - t.at(60)).toBeLessThanOrEqual(2_000);
  });

  it("answers each question in order, one timely answer each, with two laptops' flags flipping", async () => {
    const t = harness({
      answers: ["First answer.", "Second answer.", "Third answer."],
    });
    await t.play(
      [
        ...JOINS,
        [0.2, recall("participant_events.join", ADEMOLA, 0.2)],
        ...toggling(1, 90),
        [
          40,
          recall("transcript.data", OYENIYI, 38, "Q, what's this call about?"),
        ],
        [55, recall("transcript.data", ADEMOLA, 53, "Q, who is on the call?")],
        [70, recall("transcript.data", OYENIYI, 68, "Q, what happens next?")],
      ],
      90,
    );
    expect(t.asked).toHaveLength(3);
    for (const [answer, asked] of [
      ["First answer.", 40],
      ["Second answer.", 55],
      ["Third answer.", 70],
    ] as const) {
      const said = t.answeredAt(answer);
      expect(said, answer).toBeDefined();
      expect((said ?? Infinity) - t.at(asked)).toBeLessThanOrEqual(2_000);
    }
  });

  it("never answers a pile of old questions: the latest is answered, once, and says so", async () => {
    const t = harness({ holdModel: true, answers: ["Old.", "Latest."] });
    await t.play(
      [
        ...JOINS,
        [40, recall("transcript.data", OYENIYI, 39, "Q, can you hear me?")],
        [41, recall("transcript.data", OYENIYI, 40, "Q, are you there?")],
        [
          42,
          recall("transcript.data", OYENIYI, 41, "Q, would you introduce us?"),
        ],
      ],
      43,
    );
    // The model is slow: one question in flight, the latest waiting.
    expect(t.asked).toEqual(["Q, can you hear me?"]);
    t.held.shift()?.();
    await t.play([], 44);
    expect(t.asked).toEqual([
      "Q, can you hear me?",
      "Q, would you introduce us?",
    ]);
    t.held.shift()?.();
    await t.play([], 47);
    const answers = t.spokenAt.filter(
      (s) => s.text.includes("Old.") || s.text.includes("Latest."),
    );
    expect(answers.map((s) => s.text)).toEqual([
      `${HOST_TAKING_LATEST} Latest.`,
    ]);
  });

  it("drops an answer nobody could hear in time instead of saying it minutes late", async () => {
    const t = harness({ answers: ["Too late now."] });
    // Real words keep arriving with no gap at all: Q never cuts in.
    const chatter: [number, unknown][] = [];
    for (let s = 21; s < 60; s += 0.5) {
      chatter.push([s, recall("transcript.data", ADEMOLA, s, "so anyway")]);
    }
    await t.play(
      [
        ...JOINS,
        [0.2, recall("participant_events.join", ADEMOLA, 0.2)],
        [20, recall("transcript.data", OYENIYI, 19, "Q, can you hear me?")],
        ...chatter,
      ],
      70,
    );
    expect(t.answeredAt("Too late now.")).toBeUndefined();
  });

  it("speaks a long answer a sentence at a time: the first plays before the next is made", async () => {
    const t = harness({
      pieces: true,
      answers: [
        "This call is about Nixo's seed round. Zino from Zino Aviation is here for the investor side.",
      ],
    });
    await t.play(
      [
        ...JOINS,
        [40, recall("transcript.data", OYENIYI, 39, "Q, what's this about?")],
      ],
      45,
    );
    const first = t.spokenAt.findIndex((s) => s.text.startsWith("This call"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(t.spokenAt[first]?.text).toBe(
      "This call is about Nixo's seed round.",
    );
    expect(t.played).toContain("This call is about Nixo's seed round.");
    expect(t.spokenAt.map((s) => s.text)).toContain(
      "Zino from Zino Aviation is here for the investor side.",
    );
  });
});

describe("what Q hears is kept as the call goes", () => {
  it("saves the live record, with the money said, without waiting for the call to end", async () => {
    const t = harness({});
    await t.play(
      [
        ...JOINS,
        [
          30,
          recall(
            "transcript.data",
            OYENIYI,
            29,
            "I like your company, I'm going to give you one million dollars",
          ),
        ],
      ],
      45,
    );
    await t.runtime.flush(MEETING);
    const last = t.saved.at(-1) ?? [];
    expect(last).toContainEqual({
      speaker: "oyeniyi Daniel",
      text: "I like your company, I'm going to give you one million dollars",
    });
    // Q's own lines are kept as Q's, from what it said.
    expect(last.some((line) => line.speaker === "Q")).toBe(true);
  });

  it("splits lines into sentences, keeping short ones together", () => {
    expect(speechPieces("Hi Zino, welcome. I'm Q from Capital Q.")).toEqual([
      "Hi Zino, welcome. I'm Q from Capital Q.",
    ]);
    expect(
      speechPieces(
        "This call is about the seed round. Zino is here for the investor side.",
      ),
    ).toEqual([
      "This call is about the seed round.",
      "Zino is here for the investor side.",
    ]);
  });
});
