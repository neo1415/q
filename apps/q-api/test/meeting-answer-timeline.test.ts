import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostContext } from "@capital-q/communication";
import type { MeetingHostResultV3 as MeetingHostResult } from "@capital-q/q-core";

import {
  createMeetingHostRuntime,
  type MeetingHostComposer,
  type MeetingHostStore,
} from "../src/composition/meeting-host-runtime.js";
import { createSpokenLineReader } from "../src/composition/meeting-host-speech.js";

/**
 * 2026-10-21 (round 4, live Zino <> TensorGate: answers 5-10 s, some never
 * came). The real runtime and host, end to end, on one fake clock; Recall,
 * the model and the face are fakes replaying these latencies:
 *
 *   - Recall partial captions every 300 ms while someone speaks, 300 ms
 *     behind the words; the final caption 1 000 ms after the last word.
 *   - Meet's speaking flag off 300 ms after the last word -- or never, on
 *     an open microphone (replayed from 2026-10-04, meeting-host-latency).
 *   - The model's first token 600 ms after the call, the whole reply at
 *     1 800 ms (meeting-speed's recorded 1.2-3.4 s band).
 *   - The face: live, or still joining until 1.5 s after the question.
 *
 * Per question: heard (the last word) -> answer started (the model asked)
 * -> first words handed to the face (or the bot's voice).
 * Set CQ_TIMELINE=1 to print the table.
 */

const SECRET = "recall-key-for-tests-0000000000000000";
const MEETING = "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f10";
const BOT = "6cf27e41-0e34-4fd0-bb40-ce33c5f537a0";
const START = Date.parse("2026-10-21T10:00:00Z");
const STEP = 50;

const PARTIAL_EVERY_MS = 300;
const PARTIAL_LAG_MS = 300;
const FINAL_CAPTION_MS = 1_000;
const FLAG_OFF_MS = 300;
const FIRST_TOKEN_MS = 600;
const MODEL_DONE_MS = 1_800;

const CONTEXT: HostContext = {
  meetingId: MEETING,
  purpose: "Nixo's seed round",
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

const ADA = { id: 1, name: "Adaeze Okafor" };
const BAYO = { id: 2, name: "Bayo Ade" };

const QUESTION = "Q what is the round size and who is leading it";
const ANSWER =
  "Two million dollars on a SAFE. Zino Capital is leading with half of it.";

function recall(
  kind: string,
  who: { id: number; name: string },
  words?: string,
) {
  return {
    event: kind,
    data: {
      data: {
        participant: { id: who.id, name: who.name, email: null },
        ...(words === undefined
          ? {}
          : { words: words.split(" ").map((text) => ({ text })) }),
      },
      bot: { id: BOT },
    },
  };
}

type Scenario = {
  readonly face: "LIVE" | "JOINING" | "NONE";
  /** Meet's speaking flag drops after the question (false: open mic). */
  readonly flagDrops: boolean;
};

type Timeline = {
  readonly heard: number;
  readonly started: number | null;
  readonly firstWords: number | null;
  readonly said: readonly string[];
  readonly modelCalls: number;
};

async function replay(scenario: Scenario): Promise<Timeline> {
  const clock = { at: START };
  const asked: number[] = [];
  const toFace: { text: string; at: number }[] = [];
  const toVoice: { text: string; at: number }[] = [];
  const pending: {
    readonly startedAt: number;
    readonly fragments: string[];
    readonly result: MeetingHostResult;
    sent: number;
    readonly feed: ((fragment: string) => void) | undefined;
    readonly resolve: (result: MeetingHostResult) => void;
  }[] = [];
  // A slow face join: asked 6 s after Q joined, the face in 1.5 s after.
  const questionAt = scenario.face === "JOINING" ? 6_000 : 40_000;
  const wordsFor = QUESTION.split(" ");
  // About three words a second.
  const lastWordAt = questionAt + (wordsFor.length - 1) * 330;
  // The face joins on Q's first event; "joining" is a slow join still
  // under way 1.5 s after the question.
  const faceLiveAt =
    scenario.face === "LIVE"
      ? START
      : scenario.face === "JOINING"
        ? START + lastWordAt + 1_500
        : Number.POSITIVE_INFINITY;
  const settledWaiters: (() => void)[] = [];
  const store: MeetingHostStore = {
    context: () =>
      Promise.resolve({
        ...CONTEXT,
        botId: BOT,
        tenantId: "t-1",
        organiserUserId: "u-i",
        declined: false,
      }),
    roster: () => Promise.resolve(),
    removedBy: () => Promise.resolve(),
    note: () => Promise.resolve(),
  };
  const composer: MeetingHostComposer = {
    turn: (_who, variables, _images, stream) => {
      const result: MeetingHostResult =
        variables.mode === "GUEST"
          ? {
              kind: "GUEST",
              line: "",
              proposal: null,
              guest: { name: null, role: null, organisation: null },
            }
          : { kind: "ANSWER", line: ANSWER, proposal: null, guest: null };
      if (variables.mode !== "GUEST") asked.push(clock.at);
      const raw = JSON.stringify(result);
      const fragments: string[] = [];
      for (let i = 0; i < raw.length; i += 7)
        fragments.push(raw.slice(i, i + 7));
      const reader =
        stream === undefined
          ? undefined
          : createSpokenLineReader(stream.onFirstPiece);
      return new Promise((resolve) => {
        pending.push({
          startedAt: clock.at,
          fragments,
          result,
          sent: 0,
          feed: reader?.feed,
          resolve,
        });
      });
    },
  };
  const live = () => clock.at >= faceLiveAt;
  const runtime = createMeetingHostRuntime({
    enabled: true,
    publicBase: "https://q-api.example",
    secret: SECRET,
    store,
    composer,
    voice: {
      speak: (text) => {
        toVoice.push({ text, at: clock.at });
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
      play: () => Promise.resolve(),
      leave: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
    ...(scenario.face === "NONE"
      ? {}
      : {
          face: {
            start: () => undefined,
            live: () => live(),
            say: (_m: string, text: string) => {
              toFace.push({ text, at: clock.at });
            },
            finish: () => undefined,
            end: () => undefined,
            starting: () => !live(),
            settled: () =>
              live()
                ? Promise.resolve()
                : new Promise<void>((done) => settledWaiters.push(done)),
            expect: () => undefined,
          },
        }),
    now: () => clock.at,
    tickEveryMs: null,
    wakeTimers: true,
    leaveDelayMs: 0,
  });

  const events: [number, unknown][] = [
    [0, recall("participant_events.join", ADA)],
    [100, recall("participant_events.join", BAYO)],
    [questionAt, recall("participant_events.speech_on", BAYO)],
  ];
  for (let t = questionAt; t <= lastWordAt; t += PARTIAL_EVERY_MS) {
    const count = Math.min(
      wordsFor.length,
      1 + Math.floor((t - questionAt) / 330),
    );
    events.push([
      t + PARTIAL_LAG_MS,
      recall(
        "transcript.partial_data",
        BAYO,
        wordsFor.slice(0, count).join(" "),
      ),
    ]);
  }
  events.push([
    lastWordAt + PARTIAL_LAG_MS,
    recall("transcript.partial_data", BAYO, QUESTION),
  ]);
  if (scenario.flagDrops) {
    events.push([
      lastWordAt + FLAG_OFF_MS,
      recall("participant_events.speech_off", BAYO),
    ]);
  }
  events.push([
    lastWordAt + FINAL_CAPTION_MS,
    recall("transcript.data", BAYO, QUESTION),
  ]);
  events.sort((a, b) => a[0] - b[0]);

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const until = lastWordAt + 15_000;
  for (let t = 0; t <= until; t += STEP) {
    clock.at = START + t;
    if (t > 0) vi.advanceTimersByTime(STEP);
    if (live()) for (const done of settledWaiters.splice(0)) done();
    while (events.length > 0 && (events[0]?.[0] ?? Infinity) <= t) {
      const next = events.shift();
      if (next !== undefined) void runtime.receive(MEETING, next[1]);
    }
    for (const call of [...pending]) {
      const elapsed = clock.at - call.startedAt;
      if (elapsed >= FIRST_TOKEN_MS && call.feed !== undefined) {
        const share = Math.min(
          1,
          (elapsed - FIRST_TOKEN_MS) / (MODEL_DONE_MS - FIRST_TOKEN_MS),
        );
        const due = Math.max(1, Math.ceil(share * call.fragments.length));
        while (call.sent < due) {
          call.feed(call.fragments[call.sent] ?? "");
          call.sent += 1;
        }
      }
      if (elapsed >= MODEL_DONE_MS) {
        pending.splice(pending.indexOf(call), 1);
        call.resolve(call.result);
      }
    }
    for (let i = 0; i < 5; i += 1) {
      await new Promise((done) => setImmediate(done));
    }
  }
  vi.useRealTimers();
  const out = scenario.face === "NONE" ? toVoice : toFace;
  if (process.env.CQ_TIMELINE === "2") {
    console.log(
      JSON.stringify({
        scenario,
        face: toFace.map((l) => [
          l.text.slice(0, 24),
          l.at - START - lastWordAt,
        ]),
        voice: toVoice.map((l) => [
          l.text.slice(0, 24),
          l.at - START - lastWordAt,
        ]),
      }),
    );
  }
  const answerLines = out.filter((line) =>
    ANSWER.includes(line.text.slice(0, 20)),
  );
  const heard = START + lastWordAt;
  return {
    heard,
    started: asked[0] === undefined ? null : asked[0] - heard,
    firstWords: answerLines[0] === undefined ? null : answerLines[0].at - heard,
    said: answerLines.map((line) => line.text),
    modelCalls: asked.length,
  };
}

const SCENARIOS: readonly (readonly [string, Scenario])[] = [
  ["face live, Meet's flag drops", { face: "LIVE", flagDrops: true }],
  ["face live, open microphone", { face: "LIVE", flagDrops: false }],
  ["face still joining", { face: "JOINING", flagDrops: true }],
  ["no face (bot voice), flag drops", { face: "NONE", flagDrops: true }],
  ["no face (bot voice), open microphone", { face: "NONE", flagDrops: false }],
];

afterEach(() => {
  vi.useRealTimers();
});

describe("a question to Q in a meeting, heard to first words (round 4)", () => {
  it("answers every scenario, once, with the whole answer said", async () => {
    const rows: string[] = [];
    for (const [name, scenario] of SCENARIOS) {
      const t = await replay(scenario);
      rows.push(
        `| ${name} | ${String(t.started)} | ${String(t.firstWords)} | ${String(t.modelCalls)} |`,
      );
      // Never dropped, never said twice, nothing cut.
      expect(t.modelCalls, name).toBe(1);
      expect(t.said.join(" "), name).toContain(
        "Two million dollars on a SAFE.",
      );
      expect(t.said.join(" "), name).toContain(
        "Zino Capital is leading with half of it.",
      );
    }
    if (process.env.CQ_TIMELINE === "1") {
      console.log(
        [
          "| scenario | heard -> answer started (ms) | heard -> first words (ms) | model calls |",
          "| --- | --- | --- | --- |",
          ...rows,
        ].join("\n"),
      );
    }
  });

  it("hands the face its first words within about two seconds of the last word", async () => {
    for (const flagDrops of [true, false]) {
      const t = await replay({ face: "LIVE", flagDrops });
      expect(t.firstWords).not.toBeNull();
      // Recorded: the model's first sentence ~1 s after it is asked.
      expect(t.firstWords ?? Infinity).toBeLessThanOrEqual(2_200);
    }
  });

  it("streams the first sentence once a joining face is in, not after the whole reply", async () => {
    const t = await replay({ face: "JOINING", flagDrops: true });
    // The face is in 1.5 s after the last word; the first sentence is
    // written by then, so it goes at once rather than at the reply's end.
    expect(t.firstWords ?? Infinity).toBeLessThanOrEqual(1_700);
  });
});
