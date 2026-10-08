import { describe, expect, it } from "vitest";

import {
  applyCardEdit,
  arrivalGreeting,
  BANNED_SPOKEN_PHRASES,
  cardLine,
  focusedCard,
  lowdownOf,
  parseCardCommand,
  partOfDay,
  remainingAfterFocus,
  sameShownMessage,
  startSequence,
  stepSequence,
  type SequenceCard,
  type SequenceState,
} from "../src/index.js";

/**
 * Arrival briefing (Zino, 2026-10-08): greeting by the person's own clock,
 * a lowdown from recorded facts, and the decision cards one at a time,
 * with spoken words mapped by code to the same typed actions as buttons.
 */

const at = (iso: string) => new Date(iso);

describe("greeting by timezone", () => {
  it("greets by the hour where the person is, not the server's", () => {
    // 13:30 UTC is 14:30 in Lagos, 09:30 in New York, 22:30 in Tokyo.
    const now = at("2026-10-08T13:30:00Z");
    expect(
      arrivalGreeting({ firstName: "Zino", now, timeZone: "Africa/Lagos" }),
    ).toBe("Good afternoon, Zino.");
    expect(
      arrivalGreeting({ firstName: "Zino", now, timeZone: "America/New_York" }),
    ).toBe("Good morning, Zino.");
    expect(
      arrivalGreeting({ firstName: "Zino", now, timeZone: "Asia/Tokyo" }),
    ).toBe("Hi Zino, you're up late.");
  });

  it("switches exactly on the edge hours", () => {
    const zone = "UTC";
    expect(partOfDay(at("2026-10-08T04:59:59Z"), zone)).toBe("LATE");
    expect(partOfDay(at("2026-10-08T05:00:00Z"), zone)).toBe("MORNING");
    expect(partOfDay(at("2026-10-08T11:59:59Z"), zone)).toBe("MORNING");
    expect(partOfDay(at("2026-10-08T12:00:00Z"), zone)).toBe("AFTERNOON");
    expect(partOfDay(at("2026-10-08T16:59:59Z"), zone)).toBe("AFTERNOON");
    expect(partOfDay(at("2026-10-08T17:00:00Z"), zone)).toBe("EVENING");
    expect(partOfDay(at("2026-10-08T21:59:59Z"), zone)).toBe("EVENING");
    expect(partOfDay(at("2026-10-08T22:00:00Z"), zone)).toBe("LATE");
    expect(partOfDay(at("2026-10-08T00:00:00Z"), zone)).toBe("LATE");
  });

  it("handles half-hour zones and a date line crossing", () => {
    // 06:45 UTC is 12:15 in Kolkata (+05:30): afternoon.
    expect(partOfDay(at("2026-10-08T06:45:00Z"), "Asia/Kolkata")).toBe(
      "AFTERNOON",
    );
    // 10:00 UTC is 23:00 next day in Auckland (+13 in October): late.
    expect(partOfDay(at("2026-10-08T10:00:00Z"), "Pacific/Auckland")).toBe(
      "LATE",
    );
  });

  it("falls back to UTC for an unknown zone and greets without a name", () => {
    const now = at("2026-10-08T09:00:00Z");
    expect(
      arrivalGreeting({ firstName: null, now, timeZone: "Mars/Olympus" }),
    ).toBe("Good morning.");
    expect(
      arrivalGreeting({ firstName: "Zino Ade", now, timeZone: null }),
    ).toBe("Good morning, Zino.");
  });
});

describe("lowdown from facts", () => {
  it("says what was done, what came in and how many need them", () => {
    const lowdown = lowdownOf({
      activity: {
        sent: { n: 2, names: ["Halyard Security", "Nimbus"] },
        booked: { n: 1, names: ["Clearwater"] },
        replies: { n: 1, names: ["Halyard Security"] },
      },
      decisions: 3,
      hoursAway: 5,
    });
    expect(lowdown.quiet).toBe(false);
    expect(lowdown.text).toMatch(
      /I replied to Halyard Security and Nimbus and booked your call with Clearwater\./u,
    );
    expect(lowdown.text).toMatch(
      /Halyard Security wrote back, and (three things need you|there are three things for you)\./u,
    );
    expect(lowdown.text.split(/[.!?]\s/u).length).toBeLessThanOrEqual(3);
    for (const name of lowdown.mustSay) expect(lowdown.text).toContain(name);
  });

  it("counts instead of naming when there are many", () => {
    const lowdown = lowdownOf({
      activity: {
        sent: { n: 6, names: ["A", "B", "C"] },
        replies: { n: 4, names: ["A", "B"] },
        matches: { n: 2, names: [] },
        held: { n: 1, names: ["Arc"] },
      },
      decisions: 1,
      hoursAway: 30,
    });
    expect(lowdown.text).toMatch(/sent six messages/u);
    expect(lowdown.text).toMatch(/four people wrote back/iu);
    expect(lowdown.text).toMatch(/two new matches came in/u);
    expect(lowdown.text).toMatch(/held back a message to Arc/u);
    expect(lowdown.text).toMatch(/one thing (needs you|for you)/u);
  });

  it("is quiet when nothing happened, and never invents a zero", () => {
    const quiet = lowdownOf({ activity: {}, decisions: 0, hoursAway: 3 });
    expect(quiet.quiet).toBe(true);
    expect(quiet.text).toMatch(/nothing needs you/u);
    const zeros = lowdownOf({
      activity: { sent: { n: 0, names: [] } },
      decisions: 0,
      hoursAway: 40,
    });
    expect(zeros.quiet).toBe(true);
    expect(zeros.text).toMatch(/away/u);
  });

  it("leads with decisions when Q did nothing itself", () => {
    const lowdown = lowdownOf({ activity: {}, decisions: 2, hoursAway: 2 });
    expect(lowdown.text).toMatch(/two things/u);
    expect(lowdown.text).not.toMatch(/^I /u);
  });

  it("uses none of the banned template phrases", () => {
    const line = cardLine(
      {
        kind: "APPROVAL",
        counterpart: "Halyard",
        theySaid: "Could we find 30 minutes next week? Thanks.",
        message: "Happy to. Tuesday works.",
        summary: "Reply to Halyard",
      },
      1,
      3,
    );
    expect(line).toMatch(
      /^First, Halyard wrote: "Could we find 30 minutes next week\?"/u,
    );
    for (const pattern of BANNED_SPOKEN_PHRASES)
      expect(line).not.toMatch(pattern);
  });
});

describe("spoken words map to the same typed commands", () => {
  it.each([
    ["send it", "APPROVE"],
    ["Yes, send it.", "APPROVE"],
    ["ok send that please", "APPROVE"],
    ["go ahead and send it", "APPROVE"],
    ["skip", "LATER"],
    ["next one", "LATER"],
    ["not now", "LEAVE"],
    ["Let's talk about something else.", "LEAVE"],
    ["dismiss it", "DISMISS"],
    ["don't send it", "DISMISS"],
    ["never mind", "CANCEL"],
    ["yes", "YES"],
    ["let me edit it", "EDIT"],
  ])("%s → %s", (words, kind) => {
    expect(parseCardCommand(words)?.kind).toBe(kind);
  });

  it("reads a sentence edit with its new words", () => {
    expect(
      parseCardCommand(
        "change the second sentence to Thursday at 3pm my time works best",
      ),
    ).toEqual({
      kind: "EDIT",
      edit: {
        kind: "SENTENCE",
        index: 2,
        text: "Thursday at 3pm my time works best",
      },
    });
    expect(parseCardCommand("replace the last line with: Talk soon.")).toEqual({
      kind: "EDIT",
      edit: { kind: "SENTENCE", index: -1, text: "Talk soon." },
    });
  });

  it("leaves anything else to Q as an ordinary turn", () => {
    expect(parseCardCommand("what did they say about the pilot?")).toBeNull();
    expect(
      parseCardCommand(
        "send me the deck from last week about Halyard and their numbers",
      ),
    ).toBeNull();
    expect(parseCardCommand("")).toBeNull();
  });

  it("applies a sentence edit and keeps the rest", () => {
    const body =
      "Happy to. Tuesday 10:00 or Thursday 15:00 both work for me. I'll bring the pilot numbers.";
    expect(
      applyCardEdit(body, {
        kind: "SENTENCE",
        index: 2,
        text: "thursday at 3pm my time works best",
      }),
    ).toBe(
      "Happy to. Thursday at 3pm my time works best. I'll bring the pilot numbers.",
    );
    expect(
      applyCardEdit(body, { kind: "SENTENCE", index: 7, text: "x" }),
    ).toBeNull();
    expect(
      applyCardEdit(body, {
        kind: "REPLACE",
        from: "Tuesday 10:00 or ",
        to: "",
      }),
    ).toBe(
      "Happy to. Thursday 15:00 both work for me. I'll bring the pilot numbers.",
    );
  });
});

const APPROVAL: SequenceCard = {
  key: "ap-1",
  kind: "APPROVAL",
  approvalId: "ap-1",
  draftId: null,
  relationshipId: "rel-1",
  message: "Happy to. Tuesday works. Talk soon.",
  canDecide: true,
};
const HELD: SequenceCard = {
  key: "dr-2",
  kind: "HELD",
  approvalId: null,
  draftId: "dr-2",
  relationshipId: "rel-2",
  message: "Hi Arc, following up on the deck.",
  canDecide: false,
};
const PLAN: SequenceCard = {
  key: "ap-3",
  kind: "APPROVAL",
  approvalId: "ap-3",
  draftId: null,
  relationshipId: null,
  message: null,
  canDecide: true,
};

function say(state: SequenceState, words: string) {
  const command = parseCardCommand(words);
  if (command === null) throw new Error(`not a command: ${words}`);
  return stepSequence(state, { type: "COMMAND", command });
}

describe("card sequence", () => {
  it("'send it' approves exactly the card in focus, with what was shown", () => {
    const start = startSequence([APPROVAL, HELD, PLAN]);
    const step = say(start, "send it");
    expect(step.effect).toEqual({
      kind: "APPROVE",
      key: "ap-1",
      approvalId: "ap-1",
      shown: "Happy to. Tuesday works. Talk soon.",
    });
    // The same typed action a button sends.
    const button = stepSequence(start, {
      type: "COMMAND",
      command: { kind: "APPROVE" },
    });
    expect(button.effect).toEqual(step.effect);
    // In flight: a second "send it" does nothing.
    expect(say(step.state, "send it").effect).toBeNull();
    const settled = stepSequence(step.state, {
      type: "SETTLED",
      key: "ap-1",
      ok: true,
    });
    expect(focusedCard(settled.state)?.key).toBe("dr-2");
    expect(settled.state.outcomes["ap-1"]).toBe("APPROVED");
    expect(remainingAfterFocus(settled.state)).toBe(1);
  });

  it("a failed approval keeps the card in focus, undecided", () => {
    const step = say(startSequence([APPROVAL]), "send it");
    const failed = stepSequence(step.state, {
      type: "SETTLED",
      key: "ap-1",
      ok: false,
    });
    expect(focusedCard(failed.state)?.key).toBe("ap-1");
    expect(failed.state.outcomes["ap-1"]).toBeUndefined();
  });

  it("an edit creates a new payload that needs its own yes", () => {
    const edited = say(
      startSequence([APPROVAL]),
      "change the second sentence to Thursday is better",
    );
    expect(edited.effect).toBeNull();
    expect(edited.note).toBe("CONFIRM_EDIT");
    expect(edited.state.confirming).toEqual({
      key: "ap-1",
      body: "Happy to. Thursday is better. Talk soon.",
    });
    // A bare "yes" now confirms the edited body, which is sent as the
    // person's own message; the original approval is declined after.
    const sent = say(edited.state, "yes");
    expect(sent.effect).toMatchObject({
      kind: "SEND_EDITED",
      relationshipId: "rel-1",
      body: "Happy to. Thursday is better. Talk soon.",
      replacesApprovalId: "ap-1",
    });
    // Another change re-opens confirmation with the new body and a new key.
    const again = say(edited.state, "change the last sentence to See you then");
    expect(again.state.confirming?.body).toBe(
      "Happy to. Thursday is better. See you then.",
    );
    const resent = say(again.state, "send it");
    expect(resent.effect?.kind).toBe("SEND_EDITED");
    if (
      resent.effect?.kind === "SEND_EDITED" &&
      sent.effect?.kind === "SEND_EDITED"
    ) {
      expect(resent.effect.idempotencyKey).not.toBe(sent.effect.idempotencyKey);
    }
  });

  it("a bare yes never approves the original", () => {
    const step = say(startSequence([APPROVAL]), "yes");
    expect(step.effect).toBeNull();
    expect(step.note).toBe("SAY_SEND");
  });

  it("cancel drops the edit and the original stays", () => {
    const edited = say(
      startSequence([APPROVAL]),
      "change the first sentence to Sure",
    );
    const cancelled = say(edited.state, "never mind");
    expect(cancelled.state.confirming).toBeNull();
    expect(say(cancelled.state, "send it").effect).toMatchObject({
      kind: "APPROVE",
      shown: APPROVAL.message,
    });
  });

  it("a held draft is never sent on the first word", () => {
    const start = { ...startSequence([HELD]) };
    const asked = say(start, "send it");
    expect(asked.effect).toBeNull();
    expect(asked.state.confirming?.body).toBe(HELD.message);
    const sent = say(asked.state, "yes, send it");
    expect(sent.effect).toMatchObject({
      kind: "SEND_EDITED",
      replacesDraftId: "dr-2",
      replacesApprovalId: null,
    });
  });

  it("dismiss, later and leave", () => {
    const start = startSequence([APPROVAL, HELD, PLAN]);
    const dismissed = say(start, "dismiss it");
    expect(dismissed.effect).toEqual({
      kind: "DISMISS_APPROVAL",
      key: "ap-1",
      approvalId: "ap-1",
    });
    const next = stepSequence(dismissed.state, {
      type: "SETTLED",
      key: "ap-1",
      ok: true,
    });
    expect(next.state.outcomes["ap-1"]).toBe("DISMISSED");
    const later = say(next.state, "skip");
    expect(later.effect).toBeNull();
    expect(later.state.outcomes["dr-2"]).toBe("LATER");
    expect(focusedCard(later.state)?.key).toBe("ap-3");
    const left = say(later.state, "let's talk about something else");
    expect(left.state.left).toBe(true);
    expect(focusedCard(left.state)).toBeNull();
    // The card left behind is undecided: it stays in Needs you.
    expect(left.state.outcomes["ap-3"]).toBeUndefined();
  });

  it("a non-message card cannot be edited by voice", () => {
    const step = say(startSequence([PLAN]), "change the first sentence to x");
    expect(step.effect).toBeNull();
    expect(step.note).toBe("CANNOT_EDIT");
  });

  it("binds approval to the exact message shown", () => {
    expect(sameShownMessage("Happy to.", " Happy to. ")).toBe(true);
    expect(sameShownMessage("Happy to.", "Happy to!")).toBe(false);
    expect(sameShownMessage(null, null)).toBe(true);
  });
});
