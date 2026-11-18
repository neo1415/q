import { describe, expect, it } from "vitest";

import {
  hostEventOf,
  spokenLine,
} from "../src/composition/meeting-host-runtime.js";
import {
  FACE_IN_MEET_FOLLOW_UP,
  FIRST_MEETING_SOFT_COMMITMENT,
  SECOND_MEETING_NOT_ADMITTED,
  SECOND_MEETING_SIGNED_IN,
  ASKED_TO_LEAVE,
} from "./fixtures/meeting-scenarios.js";
import { simulateMeeting, type SimResult } from "./meeting-simulator.js";

/**
 * Meetings without a real meeting (owner, 2026-11-18). Each scenario is
 * replayed through the real host runtime, host policy, meeting memory,
 * snapshot, face service, screen vision and meeting assistant, with
 * Recall, Tavus, the model and speech faked at their boundary (see
 * meeting-simulator.ts).
 *
 * The `it` tests pin the behaviour of the slices built (S1, S2, S3, S8 of
 * docs/specs/meetings/2026-11-18-meetings-design.md, with decision 106 for
 * the face); each names its slice. `it.todo` lists requirements not built
 * yet. Latency is the simulator's fake clock (fixed model and caption
 * delays), never the wall clock.
 */

const runs = new Map<string, Promise<SimResult>>();
function run(scenario: Parameters<typeof simulateMeeting>[0]) {
  let held = runs.get(scenario.name);
  if (held === undefined) {
    held = simulateMeeting(scenario);
    runs.set(scenario.name, held);
  }
  return held;
}

const say = (scenario: typeof FIRST_MEETING_SOFT_COMMITMENT, text: RegExp) => {
  const step = scenario.steps.find(
    (s) => s.kind === "SAY" && text.test(s.text),
  );
  if (step === undefined) throw new Error(`no step ${String(text)}`);
  return step;
};

const answerOf = (scenario: typeof FIRST_MEETING_SOFT_COMMITMENT, re: RegExp) =>
  scenario.answers.find((a) => a.when.source === re.source)?.line ?? "";

describe("simulated first meeting: a soft commitment and a diligence request", () => {
  const S = FIRST_MEETING_SOFT_COMMITMENT;

  it("S1: without the owner's sign-in the bot knocks, and everyone on the booking is told at once, before it is let in", async () => {
    const r = await run(S);
    expect(JSON.stringify(r.botRequest)).not.toContain("google_login_group_id");
    expect(r.knocked).toBe(true);
    expect(r.admission).toEqual({
      state: "IN_CALL",
      end: null,
      admittedAt: 20_000,
    });
    const lobby = r.notices.filter((n) => n.key.startsWith("meeting-lobby:"));
    expect(lobby).toHaveLength(1);
    expect(lobby[0]?.at ?? Infinity).toBeLessThan(20_000);
    expect(r.qParticipants).toEqual(["Q (Capital Q notes)"]);
  });

  it("S2: one opening with the recording consent, then the sides introduced as finally meeting, then quiet", async () => {
    const r = await run(S);
    const heard = r.audible.map((l) => l.text);
    const all = heard.join(" ");
    // One opening for the meeting, not one per arrival.
    expect(all.match(/I'm Q from Capital Q/gu)?.length).toBe(1);
    expect(all).toMatch(
      /^Hi Bayo, welcome\. I'm Q from Capital Q\. This meeting is being recorded and transcribed for both sides\./u,
    );
    expect(all).toContain("Hi Adaeze, welcome.");
    expect(all).toContain(
      "Adaeze, this is Bayo Ade from Zino Capital. Bayo, this is Adaeze Okafor of Nixo Labs. It's nice you're finally meeting today, about Nixo Labs seed round.",
    );
    expect(all).toContain("I'm here taking notes for due diligence");
    expect(all).not.toMatch(/again/u);
  });

  it("answers a question that names Q in 1.0-1.8 s, from what the room may hear", async () => {
    const r = await run(S);
    const question = say(S, /monthly revenue/u);
    const latency = r.answerLatency(
      question,
      answerOf(S, /\bmonthly revenue\b|\bmrr\b/iu),
    );
    expect(latency).not.toBeNull();
    expect(latency ?? Infinity).toBeGreaterThanOrEqual(1_000);
    expect(latency ?? Infinity).toBeLessThanOrEqual(1_800);
    const call = r.modelCalls[0];
    expect(call?.prepared).toContain("$42,000");
    // Context Firewall: both sides present, so neither private layer.
    for (const m of r.modelCalls) {
      expect(m.prepared).not.toContain("PRIVATE-FOUNDER");
      expect(m.prepared).not.toContain("PRIVATE-INVESTOR");
    }
  });

  it("S3: after answering, Q is quiet; the soft commitment and the diligence request are notes only", async () => {
    const r = await run(S);
    // One model call: the question that named Q. Nothing else said to
    // the room reaches the model or is answered.
    expect(r.modelCalls.map((m) => m.utterance)).toEqual([
      "Q what is Nixo's monthly revenue right now?",
    ]);
    const unprompted = r.audible.filter(
      (l) => l.at > 85_000 && /I don't have that/u.test(l.text),
    );
    expect(unprompted).toEqual([]);
    const afterAnswer = r.audible.filter((l) => l.at > 85_000);
    expect(afterAnswer).toEqual([]);
  });

  it("records a hedged promise as tentative, and the diligence request with who asked whom", async () => {
    const r = await run(S);
    const kinds = r.events.map((e) => [
      e.kind,
      e.stance,
      e.speakerName,
      e.ownerName,
      e.dueText,
    ]);
    expect(kinds).toEqual([
      ["COMMITMENT", "TENTATIVE", "Bayo Ade", null, null],
      ["ACTION_ITEM", "SUGGESTION", "Bayo Ade", null, null],
      ["COMMITMENT", "COMMITMENT", "Adaeze Okafor", "Adaeze Okafor", "friday"],
    ]);
    const request = r.events[1];
    expect(r.events[2]?.refersTo).toBe(request?.id);
    // "We'd likely come in at a quarter of the round" leaves no record (S5).
    expect(r.events.some((e) => /quarter of the round/u.test(e.text))).toBe(
      false,
    );
  });

  it("looks at a shared screen for the organiser's private notes only", async () => {
    const r = await run(S);
    expect(r.screenNotes).toEqual([
      "Adaeze Okafor: Shared screen showing SLIDE-TRACTION -- Unverified figures; ask for the source.",
    ]);
    // A share starting or stopping is not an event the host sees (S4).
    expect(
      hostEventOf(
        {
          event: "participant_events.screenshare_on",
          data: {
            data: {
              participant: { id: 1, name: "Adaeze Okafor", email: null },
            },
            bot: { id: "b" },
          },
        },
        0,
      ),
    ).toBeNull();
  });

  it("S8: the relationship's held-meeting count rises by one, and only for a meeting that was held", async () => {
    const r = await run(S);
    expect(r.heldMeetings).toBe(S.priorMeetings + 1);
    const missed = await run(SECOND_MEETING_NOT_ADMITTED);
    expect(missed.heldMeetings).toBe(SECOND_MEETING_NOT_ADMITTED.priorMeetings);
  });

  it.todo(
    "S5: 'we'd likely come in at a quarter' is a SOFT commitment signal with amount and currency kept separate",
  );
  it.todo(
    "S5: the diligence request becomes a request record (asker side, askee side, item, due) after the call",
  );
  it.todo(
    "S6: the admin digest (no transcript) and the transcript to both sides, each once",
  );
  it.todo(
    "S7: the next Q conversation opens with the meeting's open requests and offers to share or upload",
  );
  it.todo(
    "S7: an email reminder is offered, not sent, for each commitment the person owns",
  );
});

describe("simulated second meeting with the owner's sign-in configured", () => {
  const S = SECOND_MEETING_SIGNED_IN;

  it("S1: the bot signs in as Capital Q and is on the invite, so it is admitted without a knock", async () => {
    const r = await run(S);
    expect(JSON.stringify(r.botRequest)).toContain(
      '"google_login_group_id":"login-group-sim-0001"',
    );
    expect(r.invite).toContain("q@capitalq.example.test");
    expect(r.knocked).toBe(false);
    expect(r.admission).toMatchObject({ state: "IN_CALL", admittedAt: 0 });
    expect(r.notices.some((n) => n.key.startsWith("meeting-lobby:"))).toBe(
      false,
    );
  });

  it("S2: one introduction that knows the relationship ('again', in diligence) and announces recording and transcript", async () => {
    const r = await run(S);
    const all = r.audible.map((l) => l.text).join(" ");
    expect(
      all.match(/This meeting is being recorded and transcribed/gu),
    ).toHaveLength(1);
    expect(all).toContain(
      "Good to see you both again, Adaeze and Bayo. Today is about Nixo Labs diligence follow-up, as part of diligence.",
    );
    expect(all).not.toMatch(/finally|this is Bayo Ade/u);
    expect(r.heldMeetings).toBe(2);
  });
});

describe("simulated meeting with the face (decision 106: one Q, lip-synced)", () => {
  const S = FACE_IN_MEET_FOLLOW_UP;

  it("S3: one Capital Q participant; the face is the note-taker's camera, never a second Q in Meet", async () => {
    const r = await run(S);
    expect(r.scenario.face).toBe("CAMERA");
    expect(r.qParticipants).toEqual(["Q (Capital Q notes)"]);
    expect(r.faceCalls).toEqual(["createPal:echo", "createMeetingRoom"]);
    expect(JSON.stringify(r.botRequest)).toContain('"output_media"');
  });

  it("every Q line goes through the face at once (echo, lip-synced): nothing waits for a turn or is dropped", async () => {
    const r = await run(S);
    const handed = r.spoken.filter(
      (l) => l.channel === "FACE" && l.source === "HOST",
    );
    expect(handed.length).toBeGreaterThan(0);
    // Each line handed to the face is said by it the moment it is handed.
    expect(r.faceSpeech.map((l) => [l.at, l.text])).toEqual(
      handed.map((l) => [l.at, l.text]),
    );
    const said = r.faceSpeech.map((l) => l.text).join(" ");
    expect(said).toMatch(
      /^Hi Bayo, welcome\. I'm Q from Capital Q\. This meeting is being recorded and transcribed for both sides\. Hi Adaeze, welcome\./u,
    );
    expect(said).toContain("It's nice you're finally meeting today");
    // The provider speaks nothing of its own: no greeting, no turns.
    expect(r.spoken.some((l) => l.source === "PROVIDER_GREETING")).toBe(false);
    expect(r.bridgeTurns.every((b) => b.said === "")).toBe(true);
    // No line goes to Q's separate voice while the face carries it.
    expect(r.spoken.filter((l) => l.channel === "VOICE")).toEqual([]);
  });

  it("answers a named question and its unnamed follow-up through the face within 1.8 s", async () => {
    const r = await run(S);
    for (const question of [say(S, /raising/u), say(S, /churn/u)]) {
      const heardAt = r.lastWordAt.get(question) ?? Infinity;
      // The first thing the face says after the question's last word.
      const first = r.faceSpeech.find((l) => l.at >= heardAt);
      expect(first).toBeDefined();
      expect((first?.at ?? Infinity) - heardAt).toBeLessThanOrEqual(1_800);
    }
    // "raising" is answered by code from the shared snapshot (the deck's
    // terms); the unnamed follow-up about churn goes to the model.
    expect(r.faceSpeech.map((l) => l.text).join(" ")).toContain("$1.5m");
    expect(r.modelCalls.map((m) => m.utterance)).toContain(
      "And what about churn?",
    );
  });

  it("S3: '$1.5m' is spoken whole", () => {
    expect(spokenLine("Raising $1.5m on a SAFE.")).toBe(
      "Raising $1.5m on a SAFE.",
    );
    expect(
      spokenLine("It was $1.5m. Then $2.25m in March. Now 3.1x. Fourth."),
    ).toBe("It was $1.5m. Then $2.25m in March. Now 3.1x.");
  });
});

describe("simulated second meeting nobody admits Q to", () => {
  const S = SECOND_MEETING_NOT_ADMITTED;

  it("ends NOT_ADMITTED and records nothing of the call", async () => {
    const r = await run(S);
    expect(r.admission).toEqual({
      state: "ENDED",
      end: "NOT_ADMITTED",
      admittedAt: null,
    });
    expect(r.qParticipants).toEqual([]);
    expect(r.events).toEqual([]);
    expect(r.audible).toEqual([]);
  });

  it("S1: everyone on the booking is told live that Q is waiting in the lobby, once, before Recall gives up", async () => {
    const r = await run(S);
    const lobby = r.notices.filter((n) => n.key.startsWith("meeting-lobby:"));
    expect(lobby.map((n) => n.key)).toEqual([`meeting-lobby:${S.meetingId}`]);
    expect(lobby[0]?.at ?? Infinity).toBeLessThan(S.lobbyTimeoutMs);
    // When Recall gives up, both sides hear that Q has no record.
    expect(
      r.notices.some((n) => n.key === `meeting-q-failed:${S.meetingId}`),
    ).toBe(true);
  });

  it.todo(
    "S8: a meeting Q missed still counts as held when both sides confirm it took place (built: either side confirms, once per meeting; schedule.test.ts)",
  );
  it.todo(
    "S9: a firm commitment said in a call is DETECTED only; the other side confirms it, and 'sent' needs evidence",
  );
});

describe("simulated meeting where a participant asks Q to leave (owner 2026-11-18)", () => {
  const S = ASKED_TO_LEAVE;

  it("Q stays: it records the ask, answers once, briefly, and goes quiet; the bot never leaves", async () => {
    const r = await run(S);
    const asked = say(S, /please leave/u);
    const heardAt = r.lastWordAt.get(asked) ?? 0;
    const answers = r.audible.filter((l) => l.at >= heardAt);
    expect(answers.map((l) => l.text).join(" ")).toBe(
      "I'm here to keep notes for both sides as part of Capital Q, so I'll stay and stay quiet. The organiser can remove me from Capital Q.",
    );
    expect((answers[0]?.at ?? Infinity) - heardAt).toBeLessThanOrEqual(1_800);
    expect(r.botLeftAt).toBeNull();
    expect(r.notes.map((n) => n.kind)).toContain("LEAVE_REQUESTED");
    // Read by code: no model call for it.
    expect(r.modelCalls).toEqual([]);
    // Still the record: the call took place and is counted.
    expect(r.heldMeetings).toBe(1);
  });
});
