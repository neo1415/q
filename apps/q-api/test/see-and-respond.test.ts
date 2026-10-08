import { describe, expect, it } from "vitest";

import {
  createCameraWatch,
  createMeetingHost,
  HOST_SEES_SCREENS_AND_CAMERAS,
  HOST_TAKING_LATEST,
  sameRequest,
  type CallParticipant,
  type HostContext,
} from "@capital-q/communication";

import {
  asksAboutWhatIsShown,
  createMeetingHostRuntime,
  speechPieces,
  type HostImage,
  type MeetingHostComposer,
} from "../src/composition/meeting-host-runtime.js";
import {
  createMeetingScreenVision,
  LATEST_FRAME_TTL_MS,
  type MeetingScreenStore,
  type MeetingViewKind,
} from "../src/composition/meeting-screen-vision.js";
import { botRequest, PARTIAL_EVENTS } from "../src/composition/recall-bots.js";

/**
 * Founder 2026-10-08: "in Google meetings, can Q respond immediately and
 * also see the camera and my screen". No provider is reached: Recall's
 * webhook and frame payloads are recorded shapes; the model, the voice and
 * the store are fakes.
 */

const MEETING = "cfccb9a9-0000-4000-8000-000000000008";
const START = Date.parse("2026-10-08T12:30:00Z");
const CONTEXT: HostContext = {
  meetingId: MEETING,
  purpose: "Seed round follow-up",
  startsAt: new Date(START),
  endsAt: new Date(START + 30 * 60_000),
  parties: [
    {
      userId: "u-founder",
      name: "Adaeze Okafor",
      email: null,
      side: "FOUNDER",
      organisation: "Nixo",
    },
    {
      userId: "u-investor",
      name: "Tunde Bello",
      email: null,
      side: "INVESTOR",
      organisation: "Zino Aviation",
    },
  ],
};
const ADAEZE: CallParticipant = { id: "1", name: "Adaeze Okafor", email: null };
const TUNDE: CallParticipant = { id: "2", name: "Tunde Bello", email: null };

function joined(at = START) {
  const host = createMeetingHost(CONTEXT);
  host.handle({ kind: "JOIN", participant: ADAEZE, at });
  host.handle({ kind: "JOIN", participant: TUNDE, at: at + 1 });
  return host;
}

describe("respond immediately: the answer starts when the line ends", () => {
  it("composes on Meet's 'stopped speaking' from partial words, before the final line", () => {
    const host = joined();
    const at = START + 60_000;
    expect(
      host
        .handle({ kind: "PARTIAL", participant: TUNDE, text: "q what is", at })
        .filter((a) => a.kind === "COMPOSE"),
    ).toEqual([]);
    host.handle({
      kind: "PARTIAL",
      participant: TUNDE,
      text: "q what is the burn",
      at: at + 300,
    });
    const ended = host.handle({
      kind: "SPEECH_OFF",
      participantId: "2",
      at: at + 600,
    });
    expect(ended).toContainEqual({
      kind: "COMPOSE",
      speaker: "Tunde Bello",
      utterance: "q what is the burn",
      heardAt: at + 600,
      early: true,
    });
    // The final words ask the same: no second model call, and Q's own
    // answer is not "talked over" by its question's final words.
    const final = host.handle({
      kind: "UTTERANCE",
      participant: TUNDE,
      text: "Q, what is the burn?",
      at: at + 1_100,
    });
    expect(final.filter((a) => a.kind === "COMPOSE")).toEqual([]);
    expect(host.modelCalls()).toBe(1);
  });

  it("ends a line on a gap in its words when Meet's flag stays on (open mic)", () => {
    const host = joined();
    const at = START + 60_000;
    host.handle({ kind: "SPEECH_ON", participantId: "2", at });
    host.handle({
      kind: "PARTIAL",
      participant: TUNDE,
      text: "hey q whats the runway",
      at: at + 200,
    });
    expect(
      host
        .handle({ kind: "TICK", at: at + 600 })
        .filter((a) => a.kind === "COMPOSE"),
    ).toEqual([]);
    const later = host.handle({ kind: "TICK", at: at + 1_200 });
    expect(later.filter((a) => a.kind === "COMPOSE")).toHaveLength(1);
  });

  it("answers the final words instead when they ask something else, without 'taking the latest'", () => {
    const host = joined();
    const at = START + 60_000;
    host.handle({
      kind: "PARTIAL",
      participant: TUNDE,
      text: "q what do you think",
      at,
    });
    host.handle({ kind: "SPEECH_OFF", participantId: "2", at: at + 300 });
    host.handle({
      kind: "UTTERANCE",
      participant: TUNDE,
      text: "Q, what do you think of their churn and their payback period?",
      at: at + 900,
    });
    // The early answer comes back and is dropped; the final is composed.
    host.reply("An early answer.");
    const next = host.handle({ kind: "TICK", at: at + 1_000 });
    const compose = next.find((a) => a.kind === "COMPOSE");
    expect(compose).toMatchObject({
      utterance:
        "Q, what do you think of their churn and their payback period?",
    });
    host.reply("Churn is unknown so far; payback was said to be nine months.");
    const said = host
      .handle({ kind: "TICK", at: at + 3_000 })
      .filter((a) => a.kind === "SAY");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ why: "REPLY" });
    expect(JSON.stringify(said)).not.toContain(HOST_TAKING_LATEST);
    expect(JSON.stringify(said)).not.toContain("An early answer");
  });

  it("ignores partial words that do not address Q, and Q's own echo", () => {
    const host = joined();
    const at = START + 60_000;
    host.handle({
      kind: "PARTIAL",
      participant: TUNDE,
      text: "the queue of customers is long",
      at,
    });
    const out = host.handle({
      kind: "SPEECH_OFF",
      participantId: "2",
      at: at + 400,
    });
    expect(out.filter((a) => a.kind === "COMPOSE")).toEqual([]);
    expect(host.modelCalls()).toBe(0);
  });

  it("says an answer after a short quiet, not Q's unprompted-line pause", () => {
    const host = joined();
    const at = START + 120_000;
    host.handle({
      kind: "UTTERANCE",
      participant: TUNDE,
      text: "Q, the agenda?",
      at,
    });
    host.handle({ kind: "SPEECH_OFF", participantId: "2", at: at + 50 });
    host.reply("The seed round follow-up.");
    // 450 ms after the last speech: an answer goes (Q's own lines wait 1.2 s).
    const out = host.handle({ kind: "TICK", at: at + 500 });
    expect(out.filter((a) => a.kind === "SAY")).toHaveLength(1);
  });

  it("reads a final line as the same request when it adds at most one word", () => {
    expect(sameRequest("q what is the burn", "Q, what is the burn?")).toBe(
      true,
    );
    expect(sameRequest("hey q what is the", "what is the burn")).toBe(true);
    expect(
      sameRequest(
        "q what do you think",
        "Q what do you think of the churn rate",
      ),
    ).toBe(false);
  });

  it("says a long first sentence up to its first comma first", () => {
    const pieces = speechPieces(
      "Their burn is about forty thousand a month, which gives them roughly eighteen months of runway. Worth confirming.",
    );
    expect(pieces[0]).toBe("Their burn is about forty thousand a month,");
    expect(pieces.length).toBeGreaterThanOrEqual(2);
  });

  it("asks Recall for partial words only with its own streaming transcription", () => {
    const hosting = {
      realtimeUrl: "https://q-api.example/h",
      metadata: {},
      aloneLeaveMs: 600_000,
      maxCallMs: 7_200_000,
    };
    const base = {
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      joinAt: null,
      botName: "Q from Capital Q",
      hosting,
    } as const;
    const streaming = JSON.stringify(
      botRequest({ ...base, transcriber: "recallai_streaming" }),
    );
    for (const name of PARTIAL_EVENTS) expect(streaming).toContain(name);
    const captions = JSON.stringify(
      botRequest({ ...base, transcriber: "meeting_captions" }),
    );
    expect(captions).not.toContain("partial_data");
  });
});

// ---------------------------------------------------------------------------
// See cameras and screens (Recall video_separate_png over the websocket).
// ---------------------------------------------------------------------------

function frame(
  type: "webcam" | "screenshare",
  buffer: string,
  who: { id: number; name: string } = { id: 100, name: "Adaeze Okafor" },
) {
  return JSON.stringify({
    event: "video_separate_png.data",
    data: {
      data: {
        buffer,
        timestamp: { absolute: "2026-10-08T12:40:00Z", relative: 12.5 },
        type,
        participant: { ...who, is_host: false },
      },
      bot: { id: "b", metadata: {} },
    },
  });
}

function vision(options: { cameras: boolean }) {
  const clock = { at: 1_000_000 };
  const observed: Parameters<MeetingScreenStore["observe"]>[0][] = [];
  const looked: { kind: MeetingViewKind; image: string }[] = [];
  const v = createMeetingScreenVision({
    enabled: true,
    cameras: options.cameras,
    publicBase: "https://q-api.example",
    secret: "recall-key-for-tests-0000000000000000",
    store: {
      context: () =>
        Promise.resolve({
          tenantId: "t-owner",
          ownerUserId: "u-owner",
          meetingText: "Purpose: Seed round",
          declined: false,
        }),
      observe: (input) => {
        observed.push(input);
        return Promise.resolve();
      },
    },
    noter: {
      note: (_who, _variables, png, kind = "SCREEN") => {
        looked.push({ kind, image: png });
        return Promise.resolve(
          kind === "CAMERA"
            ? {
                worthNoting: true,
                shows: "Holding up the v2 sensor board",
                take: "Ask what the unit cost is at volume.",
              }
            : {
                worthNoting: true,
                shows: "Slide 'Unit economics': CAC $120",
                take: "Payback is unverified.",
              },
        );
      },
    },
    now: () => clock.at,
  });
  return { v, clock, observed, looked };
}

describe("see the camera and the screen in a call", () => {
  it("drops every camera frame when camera vision is off (as before)", async () => {
    const t = vision({ cameras: false });
    t.v.receive(MEETING, frame("webcam", "CAMERA-BYTES"));
    await t.v.idle(MEETING);
    expect(t.looked).toEqual([]);
    expect(t.v.frames(MEETING, "Adaeze Okafor")).toEqual([]);
  });

  it("looks at cameras when on, through the camera note, into the owner's private notes", async () => {
    const t = vision({ cameras: true });
    t.v.receive(MEETING, frame("webcam", "CAMERA-BYTES-1"));
    await t.v.idle(MEETING);
    expect(t.looked).toEqual([{ kind: "CAMERA", image: "CAMERA-BYTES-1" }]);
    expect(t.observed[0]).toMatchObject({
      source: "CAMERA",
      ownerUserId: "u-owner",
    });
    expect(t.observed[0]?.body).toContain(
      "On Adaeze Okafor's camera: Holding up the v2 sensor board",
    );
    // What it showed may be spoken from; Q's private take never.
    const seen = t.v.seen(MEETING);
    expect(seen).toContain("Holding up the v2 sensor board");
    expect(seen).not.toContain("unit cost");
  });

  it("keeps cameras on a budget: a gap per call, a longer one per person, a cap", async () => {
    const watch = createCameraWatch({
      minGapMs: 30_000,
      perPersonGapMs: 120_000,
      maxLooks: 3,
      maxBase64Chars: 1_000,
    });
    const at = 0;
    const cam = (id: string, t: number) =>
      watch.offer({
        participantId: id,
        participantName: id,
        type: "webcam",
        pngBase64: "x",
        at: t,
      });
    expect(cam("a", at)).not.toBeNull();
    expect(cam("b", at + 10_000)).toBeNull(); // call gap
    expect(cam("a", at + 40_000)).toBeNull(); // same person too soon
    expect(cam("b", at + 40_000)).not.toBeNull();
    expect(cam("a", at + 130_000)).not.toBeNull();
    expect(cam("b", at + 400_000)).toBeNull(); // cap of 3 spent
    expect(watch.looks()).toBe(3);
  });

  it("hands the latest screen frame for a question about it, else the asker's camera; stale frames never", async () => {
    const t = vision({ cameras: true });
    t.v.receive(
      MEETING,
      frame("webcam", "TUNDE-CAM", { id: 200, name: "Tunde Bello" }),
    );
    await t.v.idle(MEETING);
    expect(t.v.frames(MEETING, "Tunde Bello")).toEqual([
      { mediaType: "image/png", dataBase64: "TUNDE-CAM" },
    ]);
    t.v.receive(MEETING, frame("screenshare", "SLIDE-BYTES"));
    await t.v.idle(MEETING);
    expect(t.v.frames(MEETING, "Tunde Bello")[0]?.dataBase64).toBe(
      "SLIDE-BYTES",
    );
    t.clock.at += LATEST_FRAME_TTL_MS + 1;
    expect(t.v.frames(MEETING, "Tunde Bello")).toEqual([]);
  });
});

describe("Q's answers in the call use what is shown", () => {
  function runtime(options: { cameras: boolean }) {
    const clock = { at: START + 60_000 };
    const turns: { seen: string; images: readonly HostImage[] }[] = [];
    const said: string[] = [];
    const logs: Record<string, unknown>[] = [];
    const composer: MeetingHostComposer = {
      turn: (_who, variables, images = []) => {
        turns.push({ seen: variables.seen ?? "", images });
        clock.at += 900; // the model
        return Promise.resolve({
          kind: "ANSWER",
          line: "That slide shows CAC of $120.",
          proposal: null,
          guest: null,
        });
      },
    };
    const rt = createMeetingHostRuntime({
      enabled: true,
      publicBase: "https://q-api.example",
      secret: "recall-key-for-tests-0000000000000000",
      seesScreens: true,
      seesCameras: options.cameras,
      sight: {
        seen: () =>
          "- Screen shared by Adaeze Okafor (5 s ago): Slide 'Unit economics': CAC $120",
        frames: () => [{ mediaType: "image/png", dataBase64: "SLIDE-BYTES" }],
      },
      store: {
        context: () =>
          Promise.resolve({
            ...CONTEXT,
            botId: "bot-1",
            tenantId: "t-1",
            organiserUserId: "u-investor",
            declined: false,
          }),
        roster: () => Promise.resolve(),
        removedBy: () => Promise.resolve(),
        note: () => Promise.resolve(),
      },
      composer,
      voice: {
        speak: (text) => {
          said.push(text);
          clock.at += 300; // the first piece's synthesis
          return Promise.resolve(new Uint8Array([1, 2, 3]));
        },
        play: () => Promise.resolve(),
        leave: () => Promise.resolve(),
      },
      now: () => clock.at,
      tickEveryMs: null,
      leaveDelayMs: 0,
      logger: {
        warn: () => undefined,
        info: (fields) => {
          logs.push(fields);
        },
      },
    });
    const body = (kind: string, id: number, name: string, words?: string) => ({
      event: kind,
      data: {
        data: {
          participant: { id, name, email: null },
          ...(words === undefined
            ? {}
            : { words: words.split(" ").map((text) => ({ text })) }),
        },
        bot: { id: "bot-1" },
      },
    });
    return { rt, clock, turns, said, logs, body };
  }

  it("gives the model what is shown, and the frame only for a question about it; logs time to first audio", async () => {
    const t = runtime({ cameras: true });
    await t.rt.receive(
      MEETING,
      t.body("participant_events.join", 1, "Adaeze Okafor"),
    );
    await t.rt.receive(
      MEETING,
      t.body("participant_events.join", 2, "Tunde Bello"),
    );
    t.clock.at += 60_000;
    for (let i = 0; i < 20; i += 1) {
      t.clock.at += 1_500;
      await t.rt.tick(MEETING);
    }
    // Asked about the slide, from partial words, ended by Meet's flag.
    await t.rt.receive(
      MEETING,
      t.body(
        "transcript.partial_data",
        2,
        "Tunde Bello",
        "q what do you make of this slide",
      ),
    );
    t.clock.at += 300;
    await t.rt.receive(
      MEETING,
      t.body("participant_events.speech_off", 2, "Tunde Bello"),
    );
    for (let i = 0; i < 4; i += 1) {
      t.clock.at += 200;
      await t.rt.tick(MEETING);
    }
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]?.seen).toContain("CAC $120");
    expect(t.turns[0]?.images).toHaveLength(1);
    expect(t.said).toContain("That slide shows CAC of $120.");
    const spoke = t.logs.find(
      (l) => l["why"] === "REPLY" && typeof l["heardToAudioMs"] === "number",
    );
    expect(spoke).toMatchObject({ early: true });
    // Model 900 ms + first piece 300 ms + the short quiet, from the line's end.
    expect(Number(spoke?.["heardToAudioMs"])).toBeLessThan(2_500);

    // An ordinary question: what is shown rides as text; no frame.
    await t.rt.receive(
      MEETING,
      t.body(
        "transcript.data",
        1,
        "Adaeze Okafor",
        "Q, when is the next call?",
      ),
    );
    for (let i = 0; i < 4; i += 1) {
      t.clock.at += 500;
      await t.rt.tick(MEETING);
    }
    expect(t.turns[1]?.images).toEqual([]);
  });

  it("says so in the greeting when it can see cameras", async () => {
    const t = runtime({ cameras: true });
    await t.rt.receive(
      MEETING,
      t.body("participant_events.join", 1, "Adaeze Okafor"),
    );
    for (let i = 0; i < 10; i += 1) {
      t.clock.at += 1_500;
      await t.rt.tick(MEETING);
    }
    expect(t.said.join(" ")).toContain(HOST_SEES_SCREENS_AND_CAMERAS);
  });

  it("reads which questions are about what is shown", () => {
    expect(asksAboutWhatIsShown("q what do you make of this slide")).toBe(true);
    expect(asksAboutWhatIsShown("Q, can you see what I'm holding?")).toBe(true);
    expect(asksAboutWhatIsShown("Q, when is the next call?")).toBe(false);
  });
});
