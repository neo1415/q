import { describe, expect, it } from "vitest";

import { startSequence, stepSequence } from "@capital-q/q-core/speech";

import {
  arrivalWords,
  commandCardsOf,
  planFromReading,
  readSpokenReply,
  sequenceCardOf,
  voiceOutcome,
  zoneFor,
  type ArrivalCard,
  type ArrivalData,
} from "../src/features/briefing/arrival";
import {
  arrivalGateOf,
  RETURN_AFTER_MS,
} from "../src/features/briefing/arrival-gate";
import {
  decideCardByVoice,
  registerCardDecider,
} from "../src/features/voice/line-cards";

/**
 * The arrival briefing (Zino, 2026-10-08): once per session or after two
 * hours away, a greeting by the person's clock, a lowdown from facts, the
 * cards one at a time, and spoken replies decided by their own words.
 */

const CARD: ArrivalCard = {
  key: "00000000-0000-4000-8000-000000000001",
  kind: "APPROVAL",
  approvalId: "00000000-0000-4000-8000-000000000001",
  draftId: null,
  relationshipId: "00000000-0000-4000-8000-000000000101",
  counterpart: "Halyard Security",
  named: null,
  title: "Reply ready to send",
  summary: "Reply to Halyard Security",
  message: "Happy to. Tuesday works.",
  theySaid: "Could we find 30 minutes next week?",
  reason: null,
  canDecide: true,
  at: "2026-10-08T11:00:00.000Z",
};
const SECOND: ArrivalCard = {
  ...CARD,
  key: "00000000-0000-4000-8000-000000000002",
  approvalId: "00000000-0000-4000-8000-000000000002",
  counterpart: "Tensorgate",
};

const DATA: ArrivalData = {
  firstName: "Zino",
  timeZone: "Africa/Lagos",
  activity: {
    sent: { n: 1, names: ["Nimbus Grid"] },
    replies: { n: 1, names: ["Halyard Security"] },
  },
  hoursAway: 4,
  cards: [CARD, SECOND],
};

describe("when the briefing is given", () => {
  const now = Date.parse("2026-10-08T13:00:00Z");
  it("on the first page of a browser session", () => {
    expect(
      arrivalGateOf({ now, lastSeen: null, arrivedThisSession: false }).give,
    ).toBe(true);
  });
  it("not again on another page in the same session", () => {
    const lastSeen = new Date(now - 5 * 60_000).toISOString();
    expect(arrivalGateOf({ now, lastSeen, arrivedThisSession: true })).toEqual({
      give: false,
      since: lastSeen,
    });
  });
  it("again after two hours away, from the last visit", () => {
    const lastSeen = new Date(now - RETURN_AFTER_MS).toISOString();
    expect(arrivalGateOf({ now, lastSeen, arrivedThisSession: true })).toEqual({
      give: true,
      since: lastSeen,
    });
    const justUnder = new Date(now - RETURN_AFTER_MS + 1_000).toISOString();
    expect(
      arrivalGateOf({ now, lastSeen: justUnder, arrivedThisSession: true })
        .give,
    ).toBe(false);
  });
  it("never trusts a last visit in the future or a broken one", () => {
    expect(
      arrivalGateOf({
        now,
        lastSeen: "2099-01-01T00:00:00Z",
        arrivedThisSession: false,
      }).since,
    ).toBeNull();
    expect(
      arrivalGateOf({ now, lastSeen: "garbage", arrivedThisSession: false })
        .since,
    ).toBeNull();
  });
});

describe("what Q says on arrival", () => {
  it("greets by their zone from Capital Q, else the browser's", () => {
    const at = new Date("2026-10-08T13:30:00Z");
    expect(arrivalWords(DATA, at, "America/New_York").greeting).toBe(
      "Good afternoon, Zino.",
    );
    expect(
      arrivalWords({ ...DATA, timeZone: null }, at, "America/New_York")
        .greeting,
    ).toBe("Good morning, Zino.");
    expect(zoneFor({ timeZone: "Nope/Nope" }, "Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("gives the lowdown, then puts the first card to them", () => {
    const words = arrivalWords(DATA, new Date("2026-10-08T13:30:00Z"), null);
    expect(words.lowdown).toMatch(/I replied to Nimbus Grid\./u);
    expect(words.lowdown).toMatch(/Halyard Security wrote back/u);
    expect(words.firstCard).toMatch(
      /^First, Halyard Security wrote: "Could we find 30 minutes next week\?"/u,
    );
    expect(words.spoken.startsWith("Good afternoon, Zino. ")).toBe(true);
    expect(words.spoken).not.toMatch(/I'm listening/u);
  });

  const STORY = (id: string, headline: string, summary: string) => ({
    editionId: "7b1c0e55-0000-4000-8000-0000000000e1",
    editionDate: "2026-10-07",
    sectionCode: "YOUR_SECTOR" as const,
    storyId: id,
    headline,
    summary,
    detail: null,
    sources: [
      {
        publisher: "TechCabal",
        title: headline,
        url: "https://techcabal.com/x",
        publishedAt: null,
      },
    ],
    publishedAt: "2026-10-07T06:00:00.000Z",
    path: `/daily/7b1c0e55-0000-4000-8000-0000000000e1#story-${id}`,
    sectionPath: null,
  });
  const QUIET_DATA = { ...DATA, activity: {}, cards: [] };
  const snapshotWith = (daily: ReturnType<typeof STORY>[]) =>
    ({
      contractVersion: "arrival-snapshot.v2",
      version: "v",
      asOf: "2026-10-08T13:00:00.000Z",
      items: [],
      unread: [],
      briefsRead: true,
      activity: null,
      daily,
    }) as unknown as NonNullable<ArrivalData["snapshot"]>;

  it("a quiet day with no prepared story is a plain greeting, never 'all quiet'", () => {
    const words = arrivalWords(
      QUIET_DATA,
      new Date("2026-10-08T13:30:00Z"),
      null,
    );
    expect(words.quiet).toBe(true);
    // Owner 2026-10-16: nothing waiting is the greeting and one open
    // question, with no urgency of its own.
    expect(words.spoken).toMatch(
      /^Good afternoon, Zino\. (?:Good to see you\.|Nice to have you back\.|Glad you're here\.|Good to have you back\.) What would you like to look at\?$/u,
    );
    expect(words.opener.offersChoice).toBe(false);
    expect(words.spoken).not.toMatch(/quiet|nothing needs you/iu);
    expect(words.dailyPaths).toEqual([]);
    expect(words.firstCard).toBeNull();
  });

  it("a quiet day with stories mentions one or two, dated, and invites a follow-up", () => {
    const stories = [
      STORY("a1", "Paystack Labs raises $20 million.", "Closed a round."),
      STORY("b2", "Nigeria cuts licence fees", "Fees fall."),
      STORY("c3", "A third story", "Not mentioned."),
    ];
    const words = arrivalWords(
      { ...QUIET_DATA, snapshot: snapshotWith(stories) },
      new Date("2026-10-08T13:30:00Z"),
      null,
    );
    // Owner 2026-10-16: the opener is the greeting and one question; the
    // stories stay in the full lowdown, said when they ask for it.
    expect(words.spoken).not.toContain("Paystack");
    expect(words.spoken).toMatch(/What would you like to look at\?$/u);
    expect(words.briefing).toContain("7 October");
    expect(words.briefing).toContain("Paystack Labs raises $20 million");
    expect(words.briefing).toContain("Nigeria cuts licence fees");
    expect(words.briefing).not.toContain("third story");
    expect(words.briefing).toMatch(
      /gist|short version|tell you more|open one/iu,
    );
    expect(words.briefing).not.toMatch(/all quiet|nothing needs you/iu);
    expect(words.dailyPaths).toEqual([
      "/daily/7b1c0e55-0000-4000-8000-0000000000e1",
    ]);
  });

  it("varies by day: consecutive days never say the same line", () => {
    const stories = [STORY("a1", "Paystack Labs raises $20 million", "x")];
    const lines = [8, 9, 10, 11, 12, 13].map(
      (day) =>
        arrivalWords(
          { ...QUIET_DATA, snapshot: snapshotWith(stories) },
          new Date(`2026-10-${String(day).padStart(2, "0")}T13:30:00Z`),
          null,
        ).lowdown,
    );
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i]).not.toBe(lines[i - 1]);
    }
  });

  it("something that needs them comes first and stories are not mentioned", () => {
    const words = arrivalWords(
      { ...DATA, snapshot: snapshotWith([STORY("a1", "A story", "x")]) },
      new Date("2026-10-08T13:30:00Z"),
      null,
    );
    expect(words.spoken).not.toContain("A story");
    expect(words.dailyPaths).toEqual([]);
  });
});

describe("spoken replies are decided by the person's own words", () => {
  it("their transcript decides, whatever the model passed", () => {
    expect(readSpokenReply({ words: "skip", heard: "send it" })).toEqual({
      kind: "COMMAND",
      command: { kind: "APPROVE" },
    });
  });
  it("a send the transcript does not carry is not a send", () => {
    expect(
      readSpokenReply({ words: "send it", heard: "what did they say again" }),
    ).toEqual({ kind: "UNSURE" });
    expect(readSpokenReply({ words: "send it", heard: null })).toEqual({
      kind: "UNSURE",
    });
  });
  it("moving on needs no transcript; anything else is Q's", () => {
    expect(readSpokenReply({ words: "not now", heard: null })).toEqual({
      kind: "COMMAND",
      command: { kind: "LEAVE" },
    });
    expect(
      readSpokenReply({ words: "how big is their round", heard: null }),
    ).toEqual({ kind: "NOT_A_COMMAND" });
  });

  it("after a send, the voice is told what happened and the next card", () => {
    const start = startSequence(DATA.cards.map(sequenceCardOf));
    const step = stepSequence(start, {
      type: "COMMAND",
      command: { kind: "APPROVE" },
    });
    const settled = stepSequence(step.state, {
      type: "SETTLED",
      key: CARD.key,
      ok: true,
    });
    const told = voiceOutcome({
      state: settled.state,
      cards: DATA.cards,
      note: null,
      done: "Sent to Halyard Security",
    });
    expect(told).toMatchObject({
      ok: true,
      done: "Sent to Halyard Security",
      nextCard: { position: 2, of: 2, to: "Tensorgate" },
      left: 0,
    });
  });

  it("the line hands the call to the page's decider, with what was heard", async () => {
    const seen: unknown[] = [];
    const off = registerCardDecider((input) => {
      seen.push(input);
      return Promise.resolve({ ok: true });
    });
    expect(
      await decideCardByVoice(JSON.stringify({ words: "send it" }), "send it"),
    ).toBe('{"ok":true}');
    expect(seen).toEqual([{ words: "send it", heard: "send it" }]);
    off();
    expect(await decideCardByVoice("{}", null)).toBeNull();
  });
});

describe("all of it up front, then any words (Zino, 2026-10-08)", () => {
  const HELD: ArrivalCard = {
    ...CARD,
    key: "00000000-0000-4000-8000-000000000003",
    kind: "HELD",
    approvalId: null,
    draftId: "00000000-0000-4000-8000-000000000003",
    counterpart: "Spheros",
    theySaid: null,
    message: "Hi Ada, would 20 minutes next week work?",
  };
  const cards = [HELD, SECOND, CARD];

  it("says every card in one sentence before anything else is asked", () => {
    const words = arrivalWords(
      { ...DATA, cards },
      new Date("2026-10-08T13:00:00Z"),
      null,
    );
    expect(words.summary).toBe(
      "Three things: the Spheros reply is held, Tensorgate wants a call next week, and Halyard Security wants a call next week.",
    );
    // Said once they choose to look; the opener only counts them.
    expect(words.briefing).toContain(words.summary ?? "-");
    expect(words.briefing).toMatch(/Tell me what you'd like done/u);
    expect(words.spoken).not.toContain(words.summary ?? "-");
    expect(words.spoken).toMatch(/You have \d+ things waiting\./u);
  });

  it("numbers the cards c1.. in screen order for the reader", () => {
    expect(commandCardsOf(cards).map((one) => [one.ref, one.to])).toEqual([
      ["c1", "Spheros"],
      ["c2", "Tensorgate"],
      ["c3", "Halyard Security"],
    ]);
  });

  it("turns 'send the Tensorgate one but make it warmer, ignore Spheros' into a dismiss, then the rewrite for its own yes", () => {
    const words = "send the Tensorgate one but make it warmer, ignore Spheros";
    const plan = planFromReading(
      {
        actions: [
          { ref: "c2", verb: "REWRITE", rewrite: "Warmer: Tuesday works." },
          { ref: "c1", verb: "DISMISS", rewrite: null },
        ],
        unclear: false,
      },
      cards,
      words,
    );
    expect(plan.events).toEqual([
      { type: "FOCUS", key: HELD.key },
      { type: "COMMAND", command: { kind: "DISMISS" } },
      { type: "FOCUS", key: SECOND.key },
      { type: "EDITED", body: "Warmer: Tuesday works." },
    ]);
    // Run through the real sequence: nothing goes until the exact-message yes.
    let state = startSequence(cards.map(sequenceCardOf));
    const effects: string[] = [];
    for (const event of plan.events) {
      const step = stepSequence(state, event);
      state = step.state;
      if (step.effect !== null) {
        effects.push(step.effect.kind);
        state = stepSequence(state, {
          type: "SETTLED",
          key: step.effect.key,
          ok: true,
        }).state;
      }
    }
    expect(effects).toEqual(["DISMISS_HELD"]);
    expect(state.confirming).toEqual({
      key: SECOND.key,
      body: "Warmer: Tuesday works.",
    });
  });

  it("never sends on a model's say-so when their words don't ask for it", () => {
    const plan = planFromReading(
      { actions: [{ ref: "c2", verb: "SEND", rewrite: null }], unclear: false },
      cards,
      "don't send the Tensorgate one yet",
    );
    expect(plan.events).toEqual([{ type: "FOCUS", key: SECOND.key }]);
    expect(plan.held[0]).toMatch(/nothing was sent/u);
    const sends = planFromReading(
      { actions: [{ ref: "c2", verb: "SEND", rewrite: null }], unclear: false },
      cards,
      "send the Tensorgate one",
    );
    expect(sends.events).toEqual([
      { type: "FOCUS", key: SECOND.key },
      { type: "COMMAND", command: { kind: "APPROVE" } },
    ]);
  });
});
