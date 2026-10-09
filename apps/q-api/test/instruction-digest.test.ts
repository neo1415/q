import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  digestOf,
  narrationOf,
  needsYouNotice,
} from "../src/composition/instructions/digest.js";
import type { InstructionStepRow } from "../src/composition/instructions/store.js";
import { createInstructionTriggers } from "../src/composition/instructions/triggers.js";
import { composeReturningOpener } from "../src/voice/returning-opener.js";

/** ADR 0043 S7: digest, NEEDS_YOU and what Q says when they come back. */

const step = (
  status: InstructionStepRow["status"],
  words: string,
): InstructionStepRow => ({
  run_key: "run-0001",
  step_index: 0,
  action: "chat.message.send",
  mode: "AUTO",
  status,
  relationship_id: null,
  words,
  reason_code: null,
  q_action_id: null,
  created_at: new Date("2026-10-07T09:00:00Z"),
});

describe("the digest, from recorded steps only", () => {
  it("counts and lists what happened; nothing happened, no digest", () => {
    const digest = digestOf("Handle all the work for me", [
      step("DONE", "Said hello to Acme."),
      step("DONE", "Booked an intro call with Beta."),
      step("ASKED", "Waiting for your yes: ask Acme about terms."),
      step("REFUSED", "Can't negotiate terms: always yours. Instead: ..."),
    ]);
    expect(digest?.title).toBe(
      'For "Handle all the work for me", Q did 2 things, asked you about 1 step, couldn\'t do 1 step',
    );
    expect(digest?.body.split("\n")).toHaveLength(4);
    expect(digestOf("x", [])).toBeNull();
    expect(
      digestOf("x", [step("NOTED", "Waiting for your working hours.")]),
    ).toBeNull();
  });

  it("NEEDS_YOU only when something waits", () => {
    expect(
      needsYouNotice({ goal: "g", asked: [], overBudget: false }),
    ).toBeNull();
    expect(
      needsYouNotice({ goal: "g", asked: ["Ask Acme."], overBudget: false })
        ?.title,
    ).toBe('1 thing needs your yes for "g"');
  });

  it("what Q says when they come back, from what it did, never the goal's text (Zino live 2026-10-07)", () => {
    expect(narrationOf({ done: [], needsYou: 0 })).toBeNull();
    expect(
      narrationOf({
        done: [
          { action: "relationship.interest.express", n: 3 },
          { action: "chat.message.send", n: 1 },
        ],
        needsYou: 2,
      }),
    ).toBe(
      "While you were away, I expressed interest in 3 companies and sent 1 message, and 2 things are waiting for your yes. Want to go through them?",
    );
    expect(
      narrationOf({
        done: [{ action: "q.delegation.step_executed", n: 2 }],
        needsYou: 0,
      }),
    ).toBe("While you were away, I took care of 2 things. Want the rundown?");
    expect(narrationOf({ done: [], needsYou: 1 })).toBe(
      "1 thing is waiting for your yes. Want to go through it?",
    );
    const opener = composeReturningOpener(
      "Zino",
      {
        nextCall: null,
        remindersDue: 0,
        firstReminder: null,
        notesReady: 1,
        unreadNotices: 4,
        instructionNews: narrationOf({
          done: [{ action: "chat.message.send", n: 4 }],
          needsYou: 0,
        }),
      },
      new Date(),
    );
    expect(opener).toBe(
      "Hi Zino. While you were away, I sent 4 messages. Want the rundown?",
    );
    expect(opener).not.toMatch(/standing instruction|"/u);
  });

  it("a notice's title names the goal without its framing", () => {
    expect(
      needsYouNotice({
        goal: 'Please set this up as a standing instruction for me: "Reply to founders"',
        asked: ["Ask Acme."],
        overBudget: false,
      })?.title,
    ).toBe('1 thing needs your yes for "Reply to founders"');
  });
});

describe("the digest sweep", () => {
  it("sends each due digest once, as an UPDATE, and nothing when nothing happened", async () => {
    const [busy, idle] = [randomUUID(), randomUUID()];
    const sent: { key: string; priority: string; title: string }[] = [];
    const claimedAt = new Date("2026-10-08T07:00:00Z");
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => Promise.resolve([]),
        defer: () => Promise.resolve(),
        wakeFor: () => Promise.resolve(0),
        claimDigestDue: () =>
          Promise.resolve([
            { id: busy, since: new Date(0), claimed_at: claimedAt },
            { id: idle, since: new Date(0), claimed_at: claimedAt },
          ]),
        instruction: (id: string) =>
          Promise.resolve({
            id,
            tenant_id: randomUUID(),
            user_id: randomUUID(),
            goal_text: "Handle all the work for me",
          } as never),
        stepsSince: (id: string) =>
          Promise.resolve(id === busy ? [step("DONE", "Said hello.")] : []),
        notify: (notice) => {
          sent.push(notice);
          return Promise.resolve(true);
        },
      },
      engine: () => ({
        retryHeld: () => Promise.reject(new Error("not under test")),
        fire: () =>
          Promise.resolve({
            outcome: "RAN",
            done: 0,
            asked: 0,
            refused: 0,
            cannot: [],
          }),
      }),
    });
    await triggers.sweep();
    expect(sent).toEqual([
      expect.objectContaining({
        key: "digest:2026-10-08T07:00:00.000Z",
        priority: "UPDATE",
        title: 'For "Handle all the work for me", Q did 1 thing',
      }),
    ]);
  });
});
