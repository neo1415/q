import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createSendGuard,
  sendAllowed,
} from "../src/composition/instructions/send-guard.js";
import { threadPace } from "../src/composition/instructions/quarantine.js";

/**
 * Founder 2026-10-09: "they keep sending messages without a response from
 * the receiver". At the send itself: Q writes when they wrote last; when
 * its side wrote last, ONE follow-up after three of their working days;
 * then nothing until they reply. A thread it couldn't read: nothing.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

type Message = {
  readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
  readonly sentAt: string;
};

describe("the send guard (hard rule at the send path)", () => {
  it("simulates three weeks with no reply: the first message and one follow-up, then waiting on them", async () => {
    // Monday 2026-10-05, 10:00 UTC: Q's first message.
    const start = Date.parse("2026-10-05T10:00:00Z");
    const thread: Message[] = [
      { from: "YOU", sentAt: new Date(start).toISOString() },
    ];
    let now = start;
    const guard = createSendGuard({
      readThread: () => Promise.resolve([...thread]),
      now: () => new Date(now),
    });
    const sentOn: string[] = [];
    const reasons = new Set<string>();
    // Q tries every few hours, every day, for 21 days.
    for (let hour = 4; hour <= 21 * 24; hour += 4) {
      now = start + hour * 3_600_000;
      const verdict = await guard(actor, "rel-1");
      if (verdict.ok) {
        thread.push({ from: "YOU", sentAt: new Date(now).toISOString() });
        sentOn.push(new Date(now).toISOString().slice(0, 10));
      } else {
        reasons.add(verdict.code);
      }
    }
    // Exactly one follow-up, after three working days (Thu 8 Oct).
    expect(sentOn).toEqual(["2026-10-08"]);
    expect([...reasons].sort()).toEqual([
      "TOO_SOON_TO_FOLLOW_UP",
      "WAITING_ON_THEM",
    ]);
    // Never a loop: two of ours in a row is the most the thread holds.
    expect(threadPace(thread).unansweredFromUs).toBe(2);

    // They reply: Q may answer once, and the count starts again.
    thread.push({ from: "OTHER_SIDE", sentAt: new Date(now).toISOString() });
    expect((await guard(actor, "rel-1")).ok).toBe(true);
  });

  it("counts working days, not calendar days: Friday's message waits past the weekend", () => {
    const friday = new Date("2026-10-09T10:00:00Z");
    const pace = threadPace([{ from: "YOU", sentAt: friday.toISOString() }]);
    expect(sendAllowed(pace, new Date("2026-10-12T10:00:00Z")).ok).toBe(false);
    expect(sendAllowed(pace, new Date("2026-10-14T11:00:00Z")).ok).toBe(true);
  });

  it("never writes into a thread it couldn't read", async () => {
    const guard = createSendGuard({
      readThread: () => Promise.reject(new Error("chat down")),
    });
    expect(await guard(actor, "rel-1")).toMatchObject({
      ok: false,
      code: "NOT_READ",
    });
  });

  it("answers freely when they wrote last, or when nobody has written yet", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    expect(
      sendAllowed(
        threadPace([
          { from: "YOU", sentAt: "2026-10-08T10:00:00Z" },
          { from: "OTHER_SIDE", sentAt: "2026-10-09T09:00:00Z" },
        ]),
        now,
      ).ok,
    ).toBe(true);
    expect(sendAllowed(threadPace([]), now).ok).toBe(true);
  });
});
