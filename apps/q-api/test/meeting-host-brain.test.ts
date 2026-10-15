import { describe, expect, it } from "vitest";

import {
  buildMeetingSnapshot,
  DEFAULT_HOST_POLICY,
  type HostContext,
  type MeetingEvent,
} from "@capital-q/communication";

import {
  createMeetingHostRuntime,
  type MeetingHostComposer,
  type MeetingHostStore,
} from "../src/composition/meeting-host-runtime.js";
import type { MeetingEventStore } from "../src/composition/meeting-events.js";

/**
 * Founder ask P3 (2026-10-11): Q in a call is a real conversational
 * assistant with a prepared, room-permitted context and an append-only
 * meeting record. No provider: fake store, voice, model and event store.
 */

const MEETING = "cfccb9a9-0000-4000-8000-000000000002";
const START = Date.parse("2026-10-12T12:30:00Z");
const RUNWAY = "Runway is 4 months; we are quietly raising a bridge.";
const CEILING = "Our internal ceiling for this deal is 2M USD.";

const CONTEXT: HostContext = {
  meetingId: MEETING,
  purpose: "Diligence scope for Kobo Pay's seed round",
  startsAt: new Date(START),
  endsAt: new Date(START + 30 * 60_000),
  parties: [
    {
      userId: "u-founder",
      name: "Adaeze Okafor-Nwosu",
      email: "adaeze@kobo.example",
      side: "FOUNDER",
      organisation: "Kobo Pay",
    },
    {
      userId: "u-investor",
      name: "Khalid Al-Thani",
      email: null,
      side: "INVESTOR",
      organisation: "Doha Growth Partners",
    },
  ],
};

const event = (kind: string, id: number, name: string, words?: string) => ({
  event: kind,
  data: {
    data: {
      participant: {
        id,
        name,
        is_host: false,
        platform: "google_meet",
        extra_data: {},
        email: null,
      },
      ...(words === undefined
        ? {}
        : { words: words.split(" ").map((text) => ({ text })) }),
      timestamp: { absolute: "2026-10-12T12:31:00Z", relative: 1 },
    },
    bot: { id: "bot-1", metadata: { meeting_id: MEETING } },
  },
});
const join = (id: number, name: string) =>
  event("participant_events.join", id, name);
const says = (id: number, name: string, words: string) =>
  event("transcript.data", id, name, words);

function setup() {
  const clock = { at: START - 3 * 60_000 };
  const said: string[] = [];
  const asked: {
    utterance: string;
    transcript: string;
    prepared: string;
    memory: string;
  }[] = [];
  const stored: { tenantId: string; event: MeetingEvent }[] = [];
  const built: string[] = [];
  const store: MeetingHostStore = {
    context: () =>
      Promise.resolve({
        ...CONTEXT,
        botId: "bot-1",
        tenantId: "t-1",
        organiserUserId: "u-investor",
        declined: false,
      }),
    snapshotContext: () =>
      Promise.resolve({
        meetingId: MEETING,
        purpose: CONTEXT.purpose,
        startsAt: CONTEXT.startsAt,
        endsAt: CONTEXT.endsAt,
        parties: CONTEXT.parties,
        companyId: "c-1",
        organisationIdOf: () => null,
      }),
    roster: () => Promise.resolve(),
    removedBy: () => Promise.resolve(),
    note: () => Promise.resolve(),
  };
  const composer: MeetingHostComposer = {
    turn: (_who, variables) => {
      asked.push({
        utterance: variables.utterance,
        transcript: variables.transcript,
        prepared: variables.prepared ?? "",
        memory: variables.memory ?? "",
      });
      return Promise.resolve({
        kind: "ANSWER",
        line: "From what I have, that looks reasonable.",
        proposal: null,
        guest: null,
      });
    },
  };
  const events: MeetingEventStore = {
    append: (tenantId, e) => {
      stored.push({ tenantId, event: e });
      return Promise.resolve();
    },
    nextSeq: () => Promise.resolve(1),
  };
  const runtime = createMeetingHostRuntime({
    enabled: true,
    publicBase: "https://q-api.example",
    secret: "recall-key-for-tests-0000000000000000",
    store,
    composer,
    events,
    snapshots: (context) => {
      built.push(context.meetingId);
      return buildMeetingSnapshot({
        meetingId: context.meetingId,
        sources: {
          shared: () =>
            Promise.resolve({
              agenda: context.purpose,
              participants: context.parties.map((p) => ({
                userId: p.userId,
                name: p.name,
                role: null,
                side: p.side,
                organisation: p.organisation,
              })),
              facts: [
                {
                  id: "company",
                  topic: "COMPANY" as const,
                  text: "Kobo Pay offers cross-border payments for SMEs",
                  source: "profile",
                },
              ],
            }),
          disclosed: () => Promise.resolve([]),
          founderPrivate: () =>
            Promise.resolve([
              {
                id: "runway",
                topic: "COMPANY" as const,
                text: RUNWAY,
                source: "own record",
              },
            ]),
          investorPrivate: () =>
            Promise.resolve([
              {
                id: "ceiling",
                topic: "MANDATE" as const,
                text: CEILING,
                source: "own record",
              },
            ]),
        },
      });
    },
    voice: {
      speak: (text) => {
        said.push(text);
        return Promise.resolve(new Uint8Array([1]));
      },
      play: () => Promise.resolve(),
      leave: () => Promise.resolve(),
    },
    now: () => clock.at,
    tickEveryMs: null,
    leaveDelayMs: 0,
    speakInPieces: false,
  });
  const send = async (...bodies: unknown[]) => {
    for (const body of bodies) {
      await runtime.receive(MEETING, body);
      clock.at += 500;
    }
    for (let i = 0; i < 12; i += 1) {
      clock.at += 1_500;
      await runtime.tick(MEETING);
    }
  };
  return { runtime, clock, said, asked, stored, built, send };
}

const ADA = "Adaeze Okafor-Nwosu";
const KHALID = "Khalid Al-Thani";
const spokenTail = (said: string[]) => said.slice(-3).join(" ");

describe("the snapshot is prepared before Q joins", () => {
  it("is built when the bot's address is asked for, and only once", async () => {
    const { runtime, built, send } = setup();
    expect(runtime.urlFor(MEETING)).toContain("/meeting-host");
    await runtime.prepare(MEETING);
    await send(join(1, ADA), join(2, KHALID));
    expect(built).toEqual([MEETING]);
  });
});

describe("no cross-party private leakage", () => {
  it("a founder-private fact is never spoken or shown to the model in a two-party room", async () => {
    const { said, asked, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    for (const question of [
      "Q, what is our runway?",
      "Q, tell me about the company.",
      "Q, what do you think about the bridge?",
    ]) {
      await send(says(2, KHALID, question));
    }
    expect(said.join(" ")).not.toContain("Runway");
    expect(said.join(" ")).not.toContain("ceiling");
    expect(asked.map((a) => a.prepared).join(" ")).not.toContain("Runway");
    expect(asked.map((a) => a.prepared).join(" ")).not.toContain("ceiling");
    // The shared company fact is spoken, by code.
    expect(said.join(" ")).toContain("cross-border payments");
  });

  it("alone, the founder may hear their own record; once the investor joins it is gone, and so is what was said alone", async () => {
    const { said, asked, send } = setup();
    await send(join(1, ADA));
    await send(says(1, ADA, "Our real position is we have six weeks of cash."));
    await send(says(1, ADA, "Q, tell me about the company."));
    expect(spokenTail(said)).toContain("Runway is 4 months");
    await send(join(2, KHALID));
    await send(says(1, ADA, "Q, what do you think of that?"));
    const last = asked.at(-1);
    expect(last).toBeDefined();
    expect(last?.prepared).not.toContain("Runway");
    expect(last?.transcript).not.toContain("six weeks of cash");
    expect(last?.transcript).not.toContain("Runway is 4 months");
  });
});

describe("the meeting brain", () => {
  it("answers agenda and company questions by code: no model call", async () => {
    const { said, asked, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(2, KHALID, "Q, what's on the agenda?"));
    expect(said.at(-1)).toContain("Diligence scope");
    await send(says(2, KHALID, "Q, tell me about the company."));
    expect(said.at(-1)).toContain("Kobo Pay offers cross-border payments");
    expect(asked).toHaveLength(0);
  });

  it("'Q, can you hear me?' and 'Q, what do you think?'", async () => {
    const { said, asked, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(2, KHALID, "Q, can you hear me?"));
    expect(said.at(-1)).toBe("Yes, I can hear you.");
    expect(asked).toHaveLength(0);
    await send(says(2, KHALID, "Q, what do you think?"));
    expect(asked).toHaveLength(1);
    expect(said.at(-1)).toBe("From what I have, that looks reasonable.");
  });

  it("'Q, hold on, that's not what I meant' corrects the record, keeps the original, and is not a wait", async () => {
    const { said, stored, asked, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(1, ADA, "I will send the full model by Friday"));
    await send(says(1, ADA, "Q, hold on, that's not what I meant"));
    expect(said.at(-1)).toContain("I've set that aside");
    expect(asked).toHaveLength(0);
    const kinds = stored.map((s) => s.event.kind);
    expect(kinds).toContain("COMMITMENT");
    expect(kinds).toContain("CORRECTION");
    const correction = stored.find((s) => s.event.kind === "CORRECTION");
    const original = stored.find((s) => s.event.kind === "COMMITMENT");
    expect(correction?.event.refersTo).toBe(original?.event.id);
  });

  it("'Q, remember that commitment' holds it; a suggestion is held as a suggestion", async () => {
    const { said, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(1, ADA, "I'll send the data room index by Friday latest"));
    await send(says(2, KHALID, "Q, remember that commitment"));
    expect(said.at(-1)).toMatch(/Held: Adaeze Okafor-Nwosu will do that/);
    await send(says(2, KHALID, "We could do a technical session next week"));
    await send(says(2, KHALID, "Q, remember that commitment"));
    expect(said.at(-1)).toContain("suggestion, not an agreement");
  });
});

describe("a time said in the call is only proposed", () => {
  it("the founder's 'let's do Tuesday 3pm' is PROPOSED + pending; Q says it is not confirmed; only the investor's explicit yes resolves it; nothing is booked", async () => {
    const { said, stored, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(1, ADA, "Let's do Tuesday 3pm"));
    const kinds = stored.map((s) => s.event.kind);
    expect(kinds).toEqual(["PROPOSAL", "PENDING_APPROVAL"]);
    expect(stored[0]?.event.stance).toBe("SUGGESTION");
    await send(says(2, KHALID, "Q, where are we?"));
    expect(said.at(-1)).toContain("Awaiting approval");
    expect(said.at(-1)).toContain("not confirmed");
    // Silence, then a bare 'okay', then the founder agreeing with herself:
    // none of them confirms.
    await send(says(2, KHALID, "okay"));
    await send(says(1, ADA, "That works for me"));
    expect(stored.filter((s) => s.event.kind === "AGREEMENT")).toHaveLength(1);
    expect(
      stored.find((s) => s.event.kind === "AGREEMENT")?.event.speakerSide,
    ).toBe("FOUNDER");
    await send(says(2, KHALID, "Q, where are we?"));
    expect(said.at(-1)).toContain("Awaiting approval");
    await send(says(2, KHALID, "Tuesday 3pm works for me, confirmed"));
    await send(says(2, KHALID, "Q, where are we?"));
    expect(said.at(-1)).not.toContain("Awaiting approval");
  });
});

describe("the meeting record", () => {
  it("is appended in order under the booking's tenant, with names attributed from the booking", async () => {
    const { stored, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(1, ADA, "I will share the cap table by Monday"));
    await send(
      says(2, KHALID, "Can you send the audited accounts by Tuesday?"),
    );
    await send(says(1, ADA, "Yes, will do"));
    expect(stored.every((s) => s.tenantId === "t-1")).toBe(true);
    const seqs = stored.map((s) => s.event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const commitments = stored.filter((s) => s.event.kind === "COMMITMENT");
    expect(commitments.map((c) => c.event.ownerName)).toEqual([ADA, ADA]);
    expect(commitments[0]?.event.speakerSide).toBe("FOUNDER");
    // The request alone was only a suggestion, with no owner.
    const request = stored.find((s) => s.event.kind === "ACTION_ITEM");
    expect(request?.event.stance).toBe("SUGGESTION");
    expect(request?.event.ownerName).toBeNull();
  });

  it("after the call: a working summary and PROPOSED follow-ups are written, none sent", async () => {
    const { runtime, clock, stored, send } = setup();
    await send(join(1, ADA), join(2, KHALID));
    await send(says(1, ADA, "I will share the cap table by Monday"));
    await send(says(1, ADA, "Let's do Tuesday 3pm"));
    // The hard cap ends the call.
    clock.at = START + DEFAULT_HOST_POLICY.hardCapAfterStartMs;
    await runtime.tick(MEETING);
    await runtime.flush(MEETING);
    // The record is written in order behind the call; let the chain drain.
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
    const followUps = stored.filter((s) => s.event.kind === "FOLLOW_UP");
    expect(followUps).toHaveLength(2);
    expect(followUps.map((f) => f.event.text).join(" ")).toContain(
      "needs the investor's explicit acceptance",
    );
    expect(stored.some((s) => s.event.kind === "SUMMARY")).toBe(true);
    // A follow-up is a record, never a message or a booking.
    expect(followUps.every((f) => f.event.stance === null)).toBe(true);
  });
});
