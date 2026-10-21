import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { HostContext, RosterEntry } from "@capital-q/communication";
import type { MeetingHostResultV3 as MeetingHostResult } from "@capital-q/q-core";

import type { ModelGateway } from "@capital-q/model-gateway";

import {
  createMeetingHostComposer,
  createMeetingHostRuntime,
  type MeetingHostComposer,
  type MeetingHostStore,
} from "../src/composition/meeting-host-runtime.js";
import {
  createSpokenLineReader,
  firstSpeechPiece,
  restAfter,
} from "../src/composition/meeting-host-speech.js";
import {
  createRollingMeetingNotes,
  mergeNotes,
  tailPast,
} from "../src/composition/meeting-notes.js";
import { frameThumb, pngThumb } from "../src/composition/png-thumb.js";

/**
 * 2026-10-20 (meetings speed). Fake model, voice and clock; no provider is
 * reached. Each test asserts what was slow before: when Q's first audio
 * goes out, how many model calls a step makes, and how much is left to do
 * when a call ends.
 */

const SECRET = "recall-key-for-tests-0000000000000000";
const MEETING = "5b2a0c5e-8f6e-4a39-9c51-0d7c1c1b2f10";
const START = Date.parse("2026-10-20T10:00:00Z");
const BOT = "6cf27e41-0e34-4fd0-bb40-ce33c5f537a0";

const CONTEXT: HostContext = {
  meetingId: MEETING,
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

const ADA = { id: 1, name: "Adaeze Okafor" };
const BAYO = { id: 2, name: "Bayo Ade" };
const GUEST = { id: 3, name: "iPhone 14" };

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

/** The model's raw JSON, as a provider streams it, a few characters at a time. */
function streamed(result: MeetingHostResult): string[] {
  const raw = JSON.stringify(result);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 7) out.push(raw.slice(i, i + 7));
  return out;
}

/**
 * A fake model on the fake clock: the reply streams from `firstTokenMs`
 * and ends at `doneMs` after the call starts.
 */
function harness(options: {
  readonly line: string;
  readonly stream: boolean;
  readonly firstTokenMs?: number;
  readonly doneMs?: number;
}) {
  const clock = { at: START };
  const spokenAt: { text: string; at: number }[] = [];
  const turns: string[] = [];
  const roster: RosterEntry[] = [];
  const pending: {
    readonly startedAt: number;
    readonly fragments: string[];
    readonly result: MeetingHostResult;
    sent: number;
    readonly feed: ((fragment: string) => void) | undefined;
    readonly resolve: (result: MeetingHostResult) => void;
  }[] = [];
  const firstTokenMs = options.firstTokenMs ?? 400;
  const doneMs = options.doneMs ?? 1_800;
  const store: MeetingHostStore = {
    context: () =>
      Promise.resolve({
        ...CONTEXT,
        botId: BOT,
        tenantId: "t-1",
        organiserUserId: "u-i",
        declined: false,
      }),
    roster: (_m, _t, entry) => {
      roster.push(entry);
      return Promise.resolve();
    },
    removedBy: () => Promise.resolve(),
    note: () => Promise.resolve(),
  };
  const composer: MeetingHostComposer = {
    turn: (_who, variables, _images, stream) => {
      turns.push(variables.mode);
      const result: MeetingHostResult = {
        kind: variables.mode === "GUEST" ? "GUEST" : "ANSWER",
        line: variables.mode === "GUEST" ? "" : options.line,
        proposal: null,
        guest:
          variables.mode === "GUEST"
            ? { name: null, role: null, organisation: null }
            : null,
      };
      const reader =
        stream === undefined
          ? undefined
          : createSpokenLineReader(stream.onFirstPiece);
      return new Promise((resolve) => {
        pending.push({
          startedAt: clock.at,
          fragments: streamed(result),
          result,
          sent: 0,
          feed: reader?.feed,
          resolve,
        });
      });
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
      play: () => Promise.resolve(),
      leave: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
    now: () => clock.at,
    tickEveryMs: null,
    leaveDelayMs: 0,
    streamAnswers: options.stream,
  });
  /** The fake model's progress at the current time. */
  const advanceModel = () => {
    for (const call of [...pending]) {
      const elapsed = clock.at - call.startedAt;
      if (elapsed >= firstTokenMs && call.feed !== undefined) {
        // Tokens arrive evenly between the first token and the end.
        const share = Math.min(
          1,
          (elapsed - firstTokenMs) / Math.max(1, doneMs - firstTokenMs),
        );
        const due = Math.max(1, Math.ceil(share * call.fragments.length));
        while (call.sent < due) {
          call.feed(call.fragments[call.sent] ?? "");
          call.sent += 1;
        }
      }
      if (elapsed >= doneMs) {
        pending.splice(pending.indexOf(call), 1);
        call.resolve(call.result);
      }
    }
  };
  const play = async (
    events: readonly (readonly [number, unknown])[],
    untilMs: number,
  ) => {
    const queue = [...events].sort((a, b) => a[0] - b[0]);
    for (let t = 0; t <= untilMs; t += 50) {
      clock.at = START + t;
      while (queue.length > 0 && (queue[0]?.[0] ?? Infinity) <= t) {
        const next = queue.shift();
        if (next !== undefined) void runtime.receive(MEETING, next[1]);
      }
      advanceModel();
      void runtime.tick(MEETING);
      for (let i = 0; i < 5; i += 1) {
        await new Promise((done) => setImmediate(done));
      }
    }
  };
  return { clock, play, spokenAt, turns, roster };
}

/** Both sides in, greeted and introduced; the room quiet by 20 s. */
const ARRIVALS: [number, unknown][] = [
  [0, recall("participant_events.join", ADA)],
  [100, recall("participant_events.join", BAYO)],
];

const LINE =
  "The deck says the round is two million dollars. It closes in March, and the lead is not named yet.";

describe("Q's spoken answer starts while the model is still writing", () => {
  it("first audio within ~1.5 s of the question, though the reply takes 1.8 s to finish", async () => {
    const t = harness({ line: LINE, stream: true });
    await t.play(
      [
        ...ARRIVALS,
        [30_000, recall("transcript.data", ADA, "Q, what is the round size?")],
      ],
      38_000,
    );
    const first = t.spokenAt.find((s) => s.text.startsWith("The deck says"));
    expect(first?.text).toBe("The deck says the round is two million dollars.");
    const firstAudioMs = (first?.at ?? Infinity) - (START + 30_000);
    expect(firstAudioMs).toBeLessThanOrEqual(1_500);
    // The rest is said after it, and nothing is said twice.
    const rest = t.spokenAt.find((s) => s.text.startsWith("It closes"));
    expect(rest?.text).toBe(
      "It closes in March, and the lead is not named yet.",
    );
    expect((rest?.at ?? 0) > (first?.at ?? Infinity)).toBe(true);
    expect(
      t.spokenAt.filter((s) => s.text.includes("two million")),
    ).toHaveLength(1);
    // One model call for the turn.
    expect(t.turns.filter((m) => m === "ANSWER")).toHaveLength(1);
  });

  it("before (not streamed): the first audio waited for the whole reply", async () => {
    const t = harness({ line: LINE, stream: false });
    await t.play(
      [
        ...ARRIVALS,
        [30_000, recall("transcript.data", ADA, "Q, what is the round size?")],
      ],
      38_000,
    );
    const first = t.spokenAt.find((s) => s.text.startsWith("The deck says"));
    const firstAudioMs = (first?.at ?? Infinity) - (START + 30_000);
    expect(firstAudioMs).toBeGreaterThanOrEqual(1_800);
  });
});

describe("a guest's introduction costs no model call when code can read it", () => {
  it("adds them to the roster with what they said, without the model", async () => {
    const t = harness({ line: LINE, stream: true });
    await t.play(
      [
        ...ARRIVALS,
        [500, recall("participant_events.join", GUEST)],
        [
          25_000,
          recall(
            "transcript.data",
            GUEST,
            "Hi, I'm Ada Obi, partner at Acme Capital.",
          ),
        ],
      ],
      27_000,
    );
    expect(t.turns).toEqual([]);
    expect(t.roster).toContainEqual(
      expect.objectContaining({
        kind: "INTRODUCED",
        source: "SELF_INTRODUCTION",
        name: "Ada Obi",
        role: "partner",
        organisation: "Acme Capital",
      }),
    );
  });
});

describe("the streamed reply is read for its first sentence only", () => {
  it("first piece: a complete sentence of 25+ characters, or a long sentence's first comma", () => {
    expect(firstSpeechPiece("Yes. The deck says two million")).toBeNull();
    expect(firstSpeechPiece("Yes. The deck says two million. And")).toBe(
      "Yes. The deck says two million.",
    );
    expect(
      firstSpeechPiece(
        "From what the deck says about the company's revenue, it grew three times last year and",
      ),
    ).toBe("From what the deck says about the company's revenue,");
    expect(firstSpeechPiece("It is 3.5 million")).toBeNull();
  });

  it("starts only for a kind said in the model's words, decoding escapes", () => {
    const said: string[] = [];
    const answer = createSpokenLineReader((piece) => said.push(piece));
    for (const part of streamed({
      kind: "ANSWER",
      line: 'The deck says "two million" for this round. More to come.',
      proposal: null,
      guest: null,
    })) {
      answer.feed(part);
    }
    expect(said).toEqual(['The deck says "two million" for this round.']);
    const declined: string[] = [];
    const decline = createSpokenLineReader((piece) => declined.push(piece));
    for (const part of streamed({
      kind: "DECLINE",
      line: "I will send the email for you right now. Done.",
      proposal: null,
      guest: null,
    })) {
      decline.feed(part);
    }
    expect(declined).toEqual([]);
  });

  it("the rest is what follows the first piece, never a repeat", () => {
    expect(
      restAfter(
        "One two three four five six. Seven.",
        "One two three four five six.",
      ),
    ).toBe("Seven.");
    expect(restAfter("Something else entirely.", "One two three.")).toBe("");
  });
});

type Notes = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createRollingMeetingNotes>["compose"]>>
>;

const notesOf = (summary: string, agreements: string[] = []): Notes => ({
  summary,
  flags: [],
  followUps: [],
  attendees: [],
  agreements,
  commitments: [],
  nextSteps: [],
  composerVersion: "meeting-notes.v3",
});

const META = {
  tenantId: "t-1",
  userId: "u-i",
  purpose: "intro call",
  organiserName: "Bayo Ade",
  callDate: "2026-10-20",
};

/** A live record of `n` lines, each a person speaking ~60 characters. */
const transcript = (n: number, from = 0) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${i % 2 === 0 ? "Adaeze Okafor" : "Bayo Ade"}: line ${String(from + i)} about revenue growth and hiring plans`,
  ).join("\n");

describe("the meeting's notes are drafted during the call", () => {
  it("drafts on the way, reads only the tail at the end, and reuses it for the provider's transcript", async () => {
    const calls: { chars: number }[] = [];
    const rolling = createRollingMeetingNotes({
      compose: (input) => {
        calls.push({ chars: input.transcript.length });
        return Promise.resolve(
          notesOf(`Notes over ${String(input.transcript.length)} chars`, [
            `agreed ${String(calls.length)}`,
          ]),
        );
      },
    });
    // A 40-minute call: the record grows a line at a time.
    for (let lines = 1; lines <= 600; lines += 1) {
      rolling.observe(MEETING, META, transcript(lines));
      await rolling.idle(MEETING);
    }
    const live = transcript(600);
    const drafts = calls.length;
    // Drafts at growing intervals: a handful, never one per line.
    expect(drafts).toBeGreaterThanOrEqual(4);
    expect(drafts).toBeLessThanOrEqual(12);
    rolling.finish(MEETING, META, live);
    await rolling.idle(MEETING);
    // The end of the call read only the tail since the last draft.
    const finishing = calls.slice(drafts);
    expect(finishing).toHaveLength(1);
    expect(finishing[0]?.chars ?? Infinity).toBeLessThan(live.length * 0.4);
    // The provider's transcript is the same words: no model call at all.
    const before = calls.length;
    const notes = await rolling.compose({
      ...META,
      meetingId: MEETING,
      transcript: live,
    });
    expect(calls.length).toBe(before);
    expect(notes?.agreements.length).toBeGreaterThan(1);
  });

  it("a provider transcript with more words past the end reads only those", async () => {
    const calls: number[] = [];
    const rolling = createRollingMeetingNotes({
      compose: (input) => {
        calls.push(input.transcript.length);
        return Promise.resolve(notesOf("n"));
      },
    });
    rolling.observe(MEETING, META, transcript(60));
    await rolling.idle(MEETING);
    rolling.finish(MEETING, META, transcript(60));
    await rolling.idle(MEETING);
    const before = calls.length;
    const provider = `${transcript(60)}\n${transcript(4, 60)}`;
    await rolling.compose({
      ...META,
      meetingId: MEETING,
      transcript: provider,
    });
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1) ?? Infinity).toBeLessThan(400);
  });

  it("a transcript that does not match the live record is composed whole, as before", async () => {
    const calls: number[] = [];
    const rolling = createRollingMeetingNotes({
      compose: (input) => {
        calls.push(input.transcript.length);
        return Promise.resolve(notesOf("n"));
      },
    });
    rolling.observe(MEETING, META, transcript(60));
    await rolling.idle(MEETING);
    const other = "Someone: completely different words were heard here today";
    await rolling.compose({ ...META, meetingId: MEETING, transcript: other });
    expect(calls.at(-1)).toBe(other.length);
  });

  it("tails are matched on a person's last words, and merged without losing late items", () => {
    const covered =
      "Ada: we agreed the round is two million dollars\nQ: Noted.";
    const later = `${covered}\nBayo: and the deck goes out on Friday then`;
    expect(tailPast(covered, later)).toBe(
      "Q: Noted.\nBayo: and the deck goes out on Friday then",
    );
    const merged = mergeNotes(notesOf("Main.", ["Round is $2m"]), {
      ...notesOf("Deck on Friday.", ["Deck goes out Friday", "round is $2M"]),
    });
    expect(merged.agreements).toEqual(["Round is $2m", "Deck goes out Friday"]);
    expect(merged.summary).toBe("Main. Deck on Friday.");
  });
});

/** A real PNG (RGB, filter 0) of one grey level, for the decoder. */
function png(width: number, height: number, value: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes)
      c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3, value);
    // Filter 1 (Sub) on odd rows, to exercise unfiltering.
    if (y % 2 === 1) {
      row[0] = 1;
      row.fill(0, 4);
    } else row[0] = 0;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("a frame's thumbnail", () => {
  it("decodes a call frame to a 32 x 18 grey picture", () => {
    const thumb = pngThumb(png(640, 360, 120));
    expect(thumb?.length).toBe(32 * 18);
    expect(Math.abs((thumb?.[0] ?? 0) - 120)).toBeLessThanOrEqual(1);
    expect(frameThumb(png(64, 36, 30).toString("base64"))?.[100]).toBe(30);
  });

  it("is null for anything it cannot read", () => {
    expect(pngThumb(Buffer.from("not a png at all, just bytes"))).toBeNull();
    expect(frameThumb("")).toBeNull();
  });
});

describe("timed decisions wake exactly when due, not on a poll", () => {
  it("answers promptly though the heartbeat is a minute", async () => {
    const skew = { ms: START - Date.now() };
    const now = () => Date.now() + skew.ms;
    const spoken: { text: string; at: number }[] = [];
    const runtime = createMeetingHostRuntime({
      enabled: true,
      publicBase: "https://q-api.example",
      secret: SECRET,
      store: {
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
      },
      composer: {
        turn: () =>
          Promise.resolve({
            kind: "ANSWER",
            line: "Two million dollars.",
            proposal: null,
            guest: null,
          }),
      },
      voice: {
        speak: (text) => {
          spoken.push({ text, at: now() });
          return Promise.resolve(new Uint8Array([1]));
        },
        play: () => Promise.resolve(),
        leave: () => Promise.resolve(),
      },
      now,
      tickEveryMs: 60_000,
      wakeTimers: true,
      leaveDelayMs: 0,
    });
    await runtime.receive(MEETING, recall("participant_events.join", ADA));
    await runtime.receive(MEETING, recall("participant_events.join", BAYO));
    // Skip past the greetings and introductions.
    skew.ms += 60_000;
    await runtime.tick(MEETING);
    skew.ms += 60_000;
    await runtime.tick(MEETING);
    const askedAt = now();
    await runtime.receive(
      MEETING,
      recall("transcript.data", ADA, "Q, what is the round size?"),
    );
    const deadline = Date.now() + 3_000;
    while (
      !spoken.some((s) => s.text === "Two million dollars.") &&
      Date.now() < deadline
    ) {
      await new Promise((done) => setTimeout(done, 20));
    }
    const answered = spoken.find((s) => s.text === "Two million dollars.");
    expect(answered).toBeDefined();
    // The room's quiet rule (400 ms) plus a few ms, not a minute's poll.
    expect((answered?.at ?? Infinity) - askedAt).toBeLessThan(1_000);
  });
});

describe("the real composer streams the turn through the gateway", () => {
  it("asks for text as it is written, passes the first sentence on, and keeps a faster fallback", async () => {
    const seen: { firstAttemptTimeoutMs?: number; streamed: boolean }[] = [];
    const reply = {
      kind: "ANSWER",
      line: "The deck says the round is two million dollars. It closes in March.",
      proposal: null,
      guest: null,
    };
    const gateway = {
      execute: (
        _request: unknown,
        options: {
          readonly firstAttemptTimeoutMs?: number;
          readonly onTextDelta?: (text: string) => void;
        },
      ) => {
        seen.push({
          ...(options.firstAttemptTimeoutMs === undefined
            ? {}
            : { firstAttemptTimeoutMs: options.firstAttemptTimeoutMs }),
          streamed: options.onTextDelta !== undefined,
        });
        for (const part of streamed(reply as MeetingHostResult)) {
          options.onTextDelta?.(part);
        }
        return Promise.resolve({
          output: { kind: "STRUCTURED", value: reply },
        });
      },
    } as unknown as ModelGateway;
    const composer = createMeetingHostComposer({ gateway });
    const first: string[] = [];
    const result = await composer.turn(
      { tenantId: "t-1", userId: "u-i" },
      {
        mode: "ANSWER",
        meeting: "Purpose: intro call",
        roster: "",
        transcript: "",
        speaker: "Adaeze Okafor",
        utterance: "Q, what is the round size?",
      },
      [],
      { onFirstPiece: (piece) => first.push(piece) },
    );
    expect(first).toEqual(["The deck says the round is two million dollars."]);
    expect(result?.line).toBe(reply.line);
    expect(seen).toEqual([{ firstAttemptTimeoutMs: 2_500, streamed: true }]);
  });
});

describe("after a restart the snapshot is rebuilt alongside the opening reads (A6)", () => {
  it("starts the snapshot before the booking read comes back", async () => {
    const order: string[] = [];
    let releaseContext: () => void = () => undefined;
    const contextGate = new Promise<void>((done) => {
      releaseContext = done;
    });
    const runtime = createMeetingHostRuntime({
      enabled: true,
      publicBase: "https://q-api.example",
      secret: SECRET,
      store: {
        context: async () => {
          order.push("context:start");
          await contextGate;
          order.push("context:end");
          return {
            ...CONTEXT,
            botId: BOT,
            tenantId: "t-1",
            organiserUserId: "u-i",
            declined: false,
          };
        },
        snapshotContext: () => {
          order.push("snapshot:start");
          return Promise.resolve(null);
        },
        roster: () => Promise.resolve(),
        removedBy: () => Promise.resolve(),
        note: () => Promise.resolve(),
      },
      snapshots: () => Promise.reject(new Error("not reached")),
      composer: {
        turn: () =>
          Promise.resolve({
            kind: "ANSWER",
            line: "Fine.",
            proposal: null,
            guest: null,
          }),
      },
      voice: {
        speak: () => Promise.resolve(new Uint8Array([1])),
        play: () => Promise.resolve(),
        leave: () => Promise.resolve(),
      },
      now: () => START,
      tickEveryMs: null,
      leaveDelayMs: 0,
    });
    const received = runtime.receive(
      MEETING,
      recall("participant_events.join", ADA),
    );
    await new Promise((done) => setImmediate(done));
    expect(order).toContain("snapshot:start");
    expect(order).not.toContain("context:end");
    releaseContext();
    await received;
    expect(order.indexOf("snapshot:start")).toBeLessThan(
      order.indexOf("context:end"),
    );
  });
});

describe("the meeting's context is there for the answer (2026-10-21, live 'couldn't find')", () => {
  it("retries a failed snapshot build once, and says so in the log", async () => {
    let builds = 0;
    const warnings: string[] = [];
    const contexts: unknown[] = [];
    const runtime = createMeetingHostRuntime({
      enabled: true,
      publicBase: "https://q-api.example",
      secret: SECRET,
      store: {
        context: () =>
          Promise.resolve({
            ...CONTEXT,
            botId: BOT,
            tenantId: "t-1",
            organiserUserId: "u-i",
            declined: false,
          }),
        snapshotContext: () => Promise.resolve({ meetingId: MEETING } as never),
        roster: () => Promise.resolve(),
        removedBy: () => Promise.resolve(),
        note: () => Promise.resolve(),
      },
      snapshots: (context) => {
        builds += 1;
        contexts.push(context);
        return Promise.reject(new Error(`build ${String(builds)} failed`));
      },
      composer: {
        turn: () =>
          Promise.resolve({
            kind: "ANSWER",
            line: "Fine.",
            proposal: null,
            guest: null,
          }),
      },
      voice: {
        speak: () => Promise.resolve(new Uint8Array([1])),
        play: () => Promise.resolve(),
        leave: () => Promise.resolve(),
      },
      logger: {
        info: () => undefined,
        warn: (_fields: unknown, message: string) => {
          warnings.push(message);
        },
      },
      now: () => START,
      tickEveryMs: null,
      leaveDelayMs: 0,
    });
    await runtime.prepare(MEETING);
    // The first build and its one retry.
    expect(builds).toBe(2);
    expect(warnings).toContain(
      "meeting context snapshot not built; retrying once",
    );
    expect(warnings).toContain("meeting context snapshot not built");
  });
});
