import { describe, expect, it, vi } from "vitest";

import {
  createTavusClient,
  TavusError,
  type TavusClient,
} from "../src/composition/tavus/client.js";
import {
  createMeetingFace,
  ledgerRefusal,
  MEETING_FACE_NAME,
  meetingFaceGreeting,
  meetingFaceSecondsFrom,
  type MeetingFaceStore,
} from "../src/composition/meeting-face.js";

/**
 * Owner decision 35: Q's Tavus face in Google Meet. No live provider call:
 * every Tavus request goes to a fake fetch or a fake client.
 */

const MEET = "https://meet.google.com/abc-defg-hij";
const FACE = "r4f5b5ef55c8";
const MEETING = "00000000-0000-4000-8000-00000000f001";

function fakeFetch(status: number, body: unknown) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(body === null ? "" : JSON.stringify(body), { status }),
    ),
  );
}

describe("the Tavus adapter, for a meeting face", () => {
  it("sends the PAL into the Meet link with its own hard length", async () => {
    const fetch = fakeFetch(200, {
      conversation_id: "c-meet",
      status: "active",
    });
    const made = await createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch,
    }).joinMeeting({
      palId: "p1",
      faceId: FACE,
      name: MEETING_FACE_NAME,
      meetingUrl: MEET,
      maxCallSeconds: 600,
    });
    expect(made).toEqual({
      conversationId: "c-meet",
      conversationUrl: null,
      status: "active",
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://tavusapi.com/v2/conversations");
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent).toEqual({
      pal_id: "p1",
      face_id: FACE,
      conversation_name: MEETING_FACE_NAME,
      meeting_url: MEET,
      properties: {
        max_call_duration: 600,
        participant_left_timeout: 30,
        participant_absent_timeout: 120,
      },
    });
  });

  it("2026-10-21: carries the face's greeting as the provider's custom greeting", async () => {
    const fetch = fakeFetch(200, { conversation_id: "c-meet" });
    await createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch,
    }).joinMeeting({
      palId: "p1",
      faceId: FACE,
      name: MEETING_FACE_NAME,
      meetingUrl: MEET,
      maxCallSeconds: 600,
      greeting: "Zino booked this call on Capital Q and asked me to join.",
    });
    const sent = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(sent.custom_greeting).toBe(
      "Zino booked this call on Capital Q and asked me to join.",
    );
  });

  it("refuses a length past the cap, or any link that is not Google Meet, before any request", async () => {
    const fetch = fakeFetch(200, { conversation_id: "never" });
    const client = createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch,
    });
    const base = { palId: "p1", faceId: FACE, name: "Q", meetingUrl: MEET };
    await expect(
      client.joinMeeting({ ...base, maxCallSeconds: 1_801 }),
    ).rejects.toBeInstanceOf(TavusError);
    await expect(
      client.joinMeeting({
        ...base,
        meetingUrl: "https://evil.example/meet",
        maxCallSeconds: 600,
      }),
    ).rejects.toBeInstanceOf(TavusError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives the PAL a meeting identity that accepts no email invites", async () => {
    const fetch = fakeFetch(200, { pal_id: "p-meet" });
    await createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch,
    }).createPal({
      name: MEETING_FACE_NAME,
      systemPrompt: "Say the text you are given.",
      faceId: FACE,
      layers: {
        llm: {
          model: "capital-q-meeting",
          base_url: "https://q.example/v1/q/meetings/face/bridge/s1",
          api_key: "session-bearer",
        },
      },
      conferencing: {
        username: "cq-q-0123456789ab",
        allowlist: ["no-invites@capitalq.invalid"],
      },
    });
    const sent = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      default_face_id: FACE,
      layers: {
        llm: { model: "capital-q-meeting" },
        conferencing: {
          username: "cq-q-0123456789ab",
          allowlist: ["no-invites@capitalq.invalid"],
        },
      },
    });
  });
});

type Calls = {
  pals: Parameters<TavusClient["createPal"]>[0][];
  joins: Parameters<TavusClient["joinMeeting"]>[0][];
  ended: string[];
  deleted: string[];
};

function fakeClient(options: { failJoin?: boolean } = {}) {
  const calls: Calls = { pals: [], joins: [], ended: [], deleted: [] };
  const unused = () => Promise.reject(new Error("unused"));
  const client: TavusClient = {
    createPal: (input) => {
      calls.pals.push(input);
      return Promise.resolve({ palId: `pal${String(calls.pals.length)}` });
    },
    deletePal: (id) => {
      calls.deleted.push(id);
      return Promise.resolve();
    },
    createConversation: unused,
    joinMeeting: (input) => {
      calls.joins.push(input);
      if (options.failJoin === true) {
        return Promise.reject(new TavusError("join meeting", 400, "QUOTA"));
      }
      return Promise.resolve({
        conversationId: "conv1",
        conversationUrl: null,
        status: "active",
      });
    },
    findConversationsForPal: () => Promise.resolve([]),
    endConversation: (id) => {
      calls.ended.push(id);
      return Promise.resolve();
    },
    getConversation: unused,
    listVoices: () => Promise.resolve([]),
    listStockFaces: () => Promise.resolve([]),
  };
  return { client, calls };
}

type Row = {
  id: string;
  meetingId: string;
  palId: string | null;
  conversationId: string | null;
  status: "STARTING" | "LIVE" | "ENDED" | "FAILED";
  reason: string | null;
  requested: boolean;
  endsAt: Date;
  tokenHash: string;
};

/** Mirrors the table: one row per meeting; the ledger may refuse the insert. */
function memoryStore(refuse: string | null = null) {
  const rows = new Map<string, Row>();
  let claims = 0;
  const store: MeetingFaceStore = {
    meeting: (meetingId) =>
      Promise.resolve(
        meetingId === MEETING
          ? {
              tenantId: "00000000-0000-4000-8000-00000000f0a1",
              organiserUserId: "00000000-0000-4000-8000-00000000f0b1",
              meetLink: MEET,
              organiserName: "Zino Okafor",
              purpose: "TensorGate's seed round",
            }
          : null,
      ),
    claim: (input) => {
      claims += 1;
      if (refuse !== null) {
        return Promise.reject(new Error(`P0001: ${refuse}`));
      }
      if ([...rows.values()].some((r) => r.meetingId === input.meetingId)) {
        return Promise.resolve(false);
      }
      rows.set(input.id, {
        id: input.id,
        meetingId: input.meetingId,
        palId: null,
        conversationId: null,
        status: "STARTING",
        reason: null,
        requested: false,
        endsAt: input.endsAt,
        tokenHash: input.tokenHash,
      });
      return Promise.resolve(true);
    },
    requested: (id, palId) => {
      const row = rows.get(id);
      if (row !== undefined) Object.assign(row, { palId, requested: true });
      return Promise.resolve();
    },
    live: (id, conversationId) => {
      const row = rows.get(id);
      if (row !== undefined)
        Object.assign(row, { conversationId, status: "LIVE" });
      return Promise.resolve();
    },
    finish: (id, status, reason) => {
      const row = rows.get(id);
      if (row !== undefined) Object.assign(row, { status, reason });
      return Promise.resolve();
    },
    open: () =>
      Promise.resolve(
        [...rows.values()].filter(
          (r) => r.status === "STARTING" || r.status === "LIVE",
        ),
      ),
  };
  return { store, rows, claims: () => claims };
}

function setup(
  options: {
    refuse?: string | null;
    failJoin?: boolean;
    enabled?: boolean;
    /** null: the production default. */
    expectGraceMs?: number | null;
  } = {},
) {
  const { client, calls } = fakeClient({ failJoin: options.failJoin ?? false });
  const memory = memoryStore(options.refuse ?? null);
  let bearer = "";
  const face = createMeetingFace({
    enabled: options.enabled ?? true,
    client: {
      ...client,
      createPal: (input) => {
        bearer = input.layers.llm.api_key;
        return client.createPal(input);
      },
    },
    faceId: FACE,
    maxSeconds: 600,
    publicBaseUrl: "https://q.example",
    bridgePath: (id) => `/v1/q/meetings/face/bridge/${id}`,
    store: memory.store,
    answerWaitMs: 50,
    ...(options.expectGraceMs === null
      ? {}
      : { expectGraceMs: options.expectGraceMs ?? 30 }),
  });
  return { face, calls, memory, bearer: () => bearer };
}

const signal = () => new AbortController().signal;

describe("Q's face in a Meet call", () => {
  it("joins the booked Meet with the configured stock face, and Q's lines go to it", async () => {
    const { face, calls, memory, bearer } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    expect(face.live(MEETING)).toBe(true);
    expect(calls.pals[0]).toMatchObject({
      faceId: FACE,
      name: MEETING_FACE_NAME,
    });
    expect(calls.pals[0]?.layers.llm.base_url).toMatch(
      /^https:\/\/q\.example\/v1\/q\/meetings\/face\/bridge\/[0-9a-f-]{36}$/u,
    );
    expect(calls.joins).toEqual([
      expect.objectContaining({ meetingUrl: MEET, maxCallSeconds: 600 }),
    ]);
    const row = [...memory.rows.values()][0];
    expect(row).toMatchObject({
      status: "LIVE",
      requested: true,
      conversationId: "conv1",
    });
    // A greeting the host already decided is said at the next turn.
    face.say(MEETING, "Hello, I'm Q from Capital Q.");
    const id = row?.id ?? "";
    await expect(
      face.bridge(
        id,
        bearer(),
        [{ role: "user", text: "morning all" }],
        signal(),
      ),
    ).resolves.toEqual({ kind: "LINE", text: "Hello, I'm Q from Capital Q." });
  });

  it("waits for the host's answer to a line aimed at Q, and stays silent otherwise", async () => {
    const { face, memory, bearer } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    await expect(
      face.bridge(
        id,
        bearer(),
        [{ role: "user", text: "let's look at the deck" }],
        signal(),
      ),
    ).resolves.toEqual({ kind: "SILENT" });
    const asked = face.bridge(
      id,
      bearer(),
      [{ role: "user", text: "Q, what did we agree last time?" }],
      signal(),
    );
    face.say(MEETING, "You agreed to share the data room by Friday.");
    await expect(asked).resolves.toEqual({
      kind: "LINE",
      text: "You agreed to share the data room by Friday.",
    });
  });

  it("waits for an answer the host has begun, though the line never named Q (a conversation's follow-up)", async () => {
    const { face, memory, bearer } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    expect(face.starting?.(MEETING)).toBe(false);
    const followUp = face.bridge(
      id,
      bearer(),
      [{ role: "user", text: "and how much are they raising" }],
      signal(),
    );
    // The host hears the line through the note-taker and starts answering.
    face.expect?.(MEETING);
    face.say(MEETING, "Two million dollars, on a SAFE.");
    await expect(followUp).resolves.toEqual({
      kind: "LINE",
      text: "Two million dollars, on a SAFE.",
    });
  });

  it("refuses the bridge without the session's own bearer", async () => {
    const { face, memory } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    await expect(
      face.bridge(
        id,
        "not-the-bearer",
        [{ role: "user", text: "Q?" }],
        signal(),
      ),
    ).resolves.toEqual({ kind: "UNAUTHORISED" });
  });

  it("starts once per meeting: a second start, or a row already there, makes no second room", async () => {
    const { face, calls, memory } = setup();
    face.start(MEETING);
    face.start(MEETING);
    await face.settled(MEETING);
    face.start(MEETING);
    await face.settled(MEETING);
    expect(memory.claims()).toBe(1);
    expect(calls.joins).toHaveLength(1);

    // Another process (or a restart) already holds this meeting's row.
    const other = setup();
    await other.memory.store.claim({
      id: "00000000-0000-4000-8000-00000000f0c1",
      tenantId: "t",
      meetingId: MEETING,
      organiserUserId: "u",
      faceId: FACE,
      tokenHash: "0".repeat(64),
      createdAt: new Date(),
      endsAt: new Date(Date.now() + 600_000),
    });
    other.face.start(MEETING);
    await other.face.settled(MEETING);
    expect(other.calls.pals).toHaveLength(0);
    expect(other.calls.joins).toHaveLength(0);
    expect(other.face.live(MEETING)).toBe(false);
  });

  it("keeps Q's usual voice when the ledger refuses (cap or allowance): no provider call", async () => {
    for (const refuse of [
      "CQ_VIDEO_GLOBAL_CAP",
      "CQ_VIDEO_WEEKLY_ALLOWANCE_EXHAUSTED",
      "CQ_VIDEO_CONCURRENCY_LIMIT",
    ]) {
      const { face, calls } = setup({ refuse });
      face.start(MEETING);
      await face.settled(MEETING);
      expect(face.live(MEETING)).toBe(false);
      expect(calls.pals).toHaveLength(0);
      expect(calls.joins).toHaveLength(0);
      // say() is a no-op: the host speaks through its bot as today.
      face.say(MEETING, "Hello");
    }
    expect(ledgerRefusal(new Error("P0001: CQ_VIDEO_GLOBAL_CAP"))).toBe(
      "CQ_VIDEO_GLOBAL_CAP",
    );
  });

  it("keeps Q's usual voice when Tavus fails, and cleans up what it made", async () => {
    const { face, calls, memory } = setup({ failJoin: true });
    face.start(MEETING);
    await face.settled(MEETING);
    expect(face.live(MEETING)).toBe(false);
    expect(calls.deleted).toEqual(["pal1"]);
    expect([...memory.rows.values()][0]).toMatchObject({
      status: "FAILED",
      reason: "PROVIDER_FAILED",
      // Asked the provider for a room: the ledger counts it, never releases.
      requested: true,
    });
  });

  it("does nothing at all when off", async () => {
    const { face, calls, memory } = setup({ enabled: false });
    face.start(MEETING);
    await face.settled(MEETING);
    expect(face.live(MEETING)).toBe(false);
    expect(memory.claims()).toBe(0);
    expect(calls.pals).toHaveLength(0);
  });

  it("leaves with Q: ends the room, removes the PAL and records the end", async () => {
    const { face, calls, memory } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    face.end(MEETING, "REMOVED");
    await vi.waitFor(() => {
      expect([...memory.rows.values()][0]).toMatchObject({
        status: "ENDED",
        reason: "REMOVED",
      });
    });
    expect(calls.ended).toEqual(["conv1"]);
    expect(calls.deleted).toEqual(["pal1"]);
    expect(face.live(MEETING)).toBe(false);
  });

  it("at boot, ends rooms a previous process left open", async () => {
    const first = setup();
    first.face.start(MEETING);
    await first.face.settled(MEETING);
    const restarted = createMeetingFace({
      enabled: true,
      client: fakeClient().client,
      faceId: FACE,
      maxSeconds: 600,
      publicBaseUrl: "https://q.example",
      bridgePath: (id) => `/b/${id}`,
      store: first.memory.store,
    });
    await restarted.sweep({ atBoot: true });
    expect([...first.memory.rows.values()][0]).toMatchObject({
      status: "ENDED",
      reason: "RESTARTED",
    });
  });

  it("reads its hard length from configuration, bounded", () => {
    expect(meetingFaceSecondsFrom(undefined)).toBe(600);
    expect(meetingFaceSecondsFrom("300")).toBe(300);
    expect(meetingFaceSecondsFrom("5000")).toBe(600);
    expect(meetingFaceSecondsFrom("abc")).toBe(600);
  });
});

describe("2026-10-20: an answer streamed through the face", () => {
  it("says the first sentence at once and the rest in the same turn", async () => {
    const { face, memory, bearer } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    const asked = face.bridge(
      id,
      bearer(),
      [{ role: "user", text: "Q, how much are they raising?" }],
      signal(),
    );
    face.say(MEETING, "The deck says two million dollars.", true);
    const result = await asked;
    expect(result).toMatchObject({
      kind: "STREAM",
      first: "The deck says two million dollars.",
    });
    if (result.kind !== "STREAM") return;
    const rest: string[] = [];
    const reading = (async () => {
      for await (const part of result.rest) rest.push(part);
    })();
    face.say(MEETING, "It closes in March.");
    await reading;
    expect(rest).toEqual(["It closes in March."]);
  });

  it("an answer with nothing more ends its turn when the host says so", async () => {
    const { face, memory, bearer } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    const asked = face.bridge(
      id,
      bearer(),
      [{ role: "user", text: "Q, are you there?" }],
      signal(),
    );
    face.say(MEETING, "Yes, I'm here and listening.", true);
    const result = await asked;
    if (result.kind !== "STREAM") throw new Error("not streamed");
    const rest: string[] = [];
    const reading = (async () => {
      for await (const part of result.rest) rest.push(part);
    })();
    face.finish?.(MEETING);
    await reading;
    expect(rest).toEqual([]);
  });
});

describe("2026-10-21 live meeting: the face introduces itself and answers in the turn it was asked", () => {
  it("joins with who Q is, why it is here and for whom, from the booking", async () => {
    const { face, calls } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    expect(calls.pals[0]?.disclosure?.spoken).toBe(
      "Hello, I'm Q, the AI investment analyst inside Capital Q.",
    );
    expect(calls.joins[0]?.greeting).toBe(
      "Zino booked this call on Capital Q and asked me to join about TensorGate's seed round. I'll keep notes for both sides and answer questions from what this call shares. Just say \"Q\" when you need me.",
    );
    // Never the provider's default name.
    expect(calls.pals[0]?.name).toBe("Capital Q");
    expect(calls.joins[0]?.name).toBe("Capital Q");
  });

  it("writes a plain greeting when the booking names no organiser, and leaves out a long or odd purpose", () => {
    expect(meetingFaceGreeting({ organiserName: null, purpose: null })).toBe(
      "This call was booked on Capital Q, and I've been asked to join. I'll keep notes for both sides and answer questions from what this call shares. Just say \"Q\" when you need me.",
    );
    expect(
      meetingFaceGreeting({ organiserName: "Ada", purpose: "x".repeat(121) }),
    ).toMatch(/^Ada booked this call on Capital Q and asked me to join\. /u);
    expect(
      meetingFaceGreeting({
        organiserName: "Ada\u0000<b>",
        purpose: "Intro\u202e call.",
      }),
    ).toMatch(
      /^Adab booked this call on Capital Q and asked me to join about Intro call\. /u,
    );
  });

  it("a line queued while nobody spoke and the answer to the question asked now go in the same turn", async () => {
    const { face, memory, bearer } = setup();
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    // Said by the host while nobody was speaking: no turn was open.
    face.say(MEETING, "Hi Zino, welcome.");
    const asked = face.bridge(
      id,
      bearer(),
      [{ role: "user", text: "Q, what are you here for?" }],
      signal(),
    );
    const result = await asked;
    expect(result).toMatchObject({
      kind: "STREAM",
      first: "Hi Zino, welcome.",
    });
    if (result.kind !== "STREAM") return;
    const rest: string[] = [];
    const reading = (async () => {
      for await (const part of result.rest) rest.push(part);
    })();
    face.say(MEETING, "Zino asked me to keep notes for both sides.");
    await reading;
    expect(rest).toEqual(["Zino asked me to keep notes for both sides."]);
  });

  it("a follow-up whose answer begins seconds after the face's turn ends is still answered in that turn", async () => {
    const { face, memory, bearer } = setup({ expectGraceMs: null });
    face.start(MEETING);
    await face.settled(MEETING);
    const id = [...memory.rows.values()][0]?.id ?? "";
    vi.useFakeTimers();
    try {
      const followUp = face.bridge(
        id,
        bearer(),
        [{ role: "user", text: "and how big is that market" }],
        signal(),
      );
      // Captions plus the host's hold: the answer begins 3 s later.
      await vi.advanceTimersByTimeAsync(3_000);
      face.expect?.(MEETING);
      face.say(MEETING, "The deck says forty billion dollars.");
      await expect(followUp).resolves.toEqual({
        kind: "LINE",
        text: "The deck says forty billion dollars.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
