import { describe, expect, it } from "vitest";

import {
  hostEventOf,
  spokenLine,
} from "../src/composition/meeting-host-runtime.js";
import {
  FACE_IN_MEET_FOLLOW_UP,
  FIRST_MEETING_SOFT_COMMITMENT,
  SECOND_MEETING_NOT_ADMITTED,
} from "./fixtures/meeting-scenarios.js";
import { simulateMeeting, type SimResult } from "./meeting-simulator.js";

/**
 * Meetings without a real meeting (owner, 2026-11-18). Each scenario is
 * replayed through the real host runtime, host policy, meeting memory,
 * snapshot, face service and screen vision, with Recall, Tavus, the model
 * and speech faked at their boundary (see meeting-simulator.ts).
 *
 * The `it` tests pin TODAY's behaviour, including the behaviour the design
 * (docs/specs/meetings/2026-11-18-meetings-design.md) changes; each such
 * assertion names its slice. `it.todo` lists requirements not built yet.
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

  it("knocks: the bot is not signed in, so someone must admit it from the lobby", async () => {
    const r = await run(S);
    // S1: today the login group is only sent with the camera page.
    expect(JSON.stringify(r.botRequest)).not.toContain("google_login_group_id");
    expect(r.admission).toEqual({
      state: "IN_CALL",
      end: null,
      admittedAt: 20_000,
    });
    expect(r.qParticipants).toEqual(["Q (Capital Q notes)"]);
  });

  it("greets each arrival with the same introduction, then introduces the sides as strangers", async () => {
    const r = await run(S);
    const heard = r.audible.map((l) => l.text).join(" ");
    // S2 changes this: one introduction, aware of the relationship.
    expect(heard.match(/I'm Q from Capital Q/gu)?.length).toBe(2);
    expect(heard).toContain("Adaeze, this is Bayo Ade from Zino Capital.");
    expect(heard).not.toMatch(/finally|again|first time/iu);
    // Recording consent is not announced in those words today (S2).
    expect(heard).not.toMatch(/record|transcri/iu);
  });

  it("answers a question that names Q in under 2.5 s, from what the room may hear", async () => {
    const r = await run(S);
    const question = say(S, /monthly revenue/u);
    const latency = r.answerLatency(
      question,
      answerOf(S, /\bmonthly revenue\b|\bmrr\b/iu),
    );
    expect(latency).not.toBeNull();
    expect(latency ?? Infinity).toBeLessThanOrEqual(2_500);
    const call = r.modelCalls[0];
    expect(call?.prepared).toContain("$42,000");
    // Context Firewall: both sides present, so neither private layer.
    for (const m of r.modelCalls) {
      expect(m.prepared).not.toContain("PRIVATE-FOUNDER");
      expect(m.prepared).not.toContain("PRIVATE-INVESTOR");
    }
  });

  it("keeps talking: unnamed lines from the same person within 20 s get an answer too", async () => {
    const r = await run(S);
    // S3 changes this: answer, then quiet until named again.
    expect(r.modelCalls.map((m) => m.utterance)).toEqual([
      "Q what is Nixo's monthly revenue right now?",
      "We will probably put in around two hundred and fifty thousand if diligence checks out.",
      "We'd likely come in at around a quarter of the round.",
      "Could you send us the cohort retention data and the cap table by Friday?",
    ]);
    const unprompted = r.audible.filter(
      (l) => l.at > 95_000 && /I don't have that/u.test(l.text),
    );
    expect(unprompted.length).toBe(3);
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

  it.todo(
    "S1: the bot signs in as Capital Q and is on the invite, so it is admitted without a knock",
  );
  it.todo(
    "S2: one introduction that knows the relationship (first meeting, or 'again') and announces recording and transcript",
  );
  it.todo(
    "S3: after answering, Q is quiet until named again; unnamed lines are notes only",
  );
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
  it.todo(
    "S8: the relationship's held-meeting count rises by one, and only for a meeting that was held",
  );
});

describe("simulated meeting with the face joining Meet itself (today's face mode)", () => {
  const S = FACE_IN_MEET_FOLLOW_UP;

  it("puts two Capital Q participants in the call: the note-taker and the face", async () => {
    const r = await run(S);
    expect(r.qParticipants).toEqual(["Q (Capital Q notes)", "PAL AI"]);
    expect(r.faceCalls).toEqual(["createPal", "joinMeeting"]);
  });

  it("hands the welcome and introductions to the face, which never says them", async () => {
    const r = await run(S);
    const handed = r.spoken.filter(
      (l) => l.channel === "FACE" && l.source === "HOST",
    );
    expect(handed.some((l) => /welcome/u.test(l.text))).toBe(true);
    expect(handed.some((l) => /this is Bayo Ade/u.test(l.text))).toBe(true);
    const heard = r.audible.map((l) => l.text).join(" ");
    // A line waits for Tavus' next turn and is dropped after 20 s.
    expect(heard).not.toMatch(/welcome|this is Bayo Ade/u);
    // The provider's own greeting is the only introduction heard.
    expect(heard).toMatch(/booked this call on Capital Q/u);
  });

  it("answers a named question and its unnamed follow-up through the face", async () => {
    const r = await run(S);
    const first = say(S, /raising/u);
    const heardAt = r.lastWordAt.get(first) ?? 0;
    const answered = r.bridgeTurns.find(
      (b) => b.at >= heardAt && b.said.length > 0,
    );
    // Tavus heard "Cue"; the host heard "Q" through Recall and answered.
    expect(answered?.heard).toMatch(/^Cue/u);
    expect((answered?.resolvedAt ?? Infinity) - heardAt).toBeLessThanOrEqual(
      2_500,
    );
    const follow = say(S, /churn/u);
    expect(
      r.answerLatency(follow, answerOf(S, /\bchurn\b/iu)) ?? Infinity,
    ).toBeLessThanOrEqual(2_500);
  });

  it("speaks '$1.5m' as '$1. 5m': the spoken-line cap splits sentences inside numbers", async () => {
    const r = await run(S);
    expect(r.audible.map((l) => l.text).join(" ")).toContain("$1. 5m");
    expect(spokenLine("Raising $1.5m on a SAFE.")).toBe(
      "Raising $1. 5m on a SAFE.",
    );
  });

  it.todo(
    "S1: one Capital Q participant; the face (if kept) is the note-taker's camera and says nothing",
  );
  it.todo("S3: '$1.5m' is spoken whole");
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

  it.todo(
    "S1: the organiser is told live that Q is waiting in the lobby, before Recall gives up",
  );
  it.todo(
    "S8: a meeting Q missed still counts as held when both sides confirm it took place",
  );
  it.todo(
    "S9: a firm commitment said in a call is DETECTED only; the other side confirms it, and 'sent' needs evidence",
  );
});
