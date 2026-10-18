import { describe, expect, it } from "vitest";

import { QWorkSinceDtoSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { readWorkSince } from "../src/composition/work/page.js";

/**
 * Arrival briefing (Zino, 2026-10-08): what happened since the person was
 * last here, counted by kind from their own rows, with their time zone.
 */
const actor = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  tenantId: "00000000-0000-4000-8000-0000000000f1",
  actorType: "HUMAN",
} as unknown as ActorContext;

const NOW = new Date("2026-10-08T14:00:00Z");

function fakeSql(rows: {
  readonly steps?: unknown[];
  readonly held?: unknown[];
  readonly replies?: unknown[];
  readonly matches?: unknown[];
  readonly zone?: unknown[];
}) {
  const seen: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    seen.push({ text, values });
    if (text.includes("instruction_steps s"))
      return Promise.resolve(rows.steps ?? []);
    if (text.includes("workforce_draft_outcomes"))
      return Promise.resolve(rows.held ?? []);
    if (text.includes("communication.messages"))
      return Promise.resolve(rows.replies ?? []);
    if (text.includes("current_state = 'CONNECTED'"))
      return Promise.resolve(rows.matches ?? []);
    if (text.includes("user_profiles")) return Promise.resolve(rows.zone ?? []);
    return Promise.resolve([]);
  };
  return { sql: sql as unknown as DatabaseExecutor, seen };
}

describe("what happened since they were last here", () => {
  it("counts by kind with a few names, and returns their own time zone", async () => {
    const { sql, seen } = fakeSql({
      steps: [
        {
          action: "chat.message.send",
          n: 2,
          names: ["Halyard", "Nimbus", null],
        },
        { action: "schedule.meeting.book", n: 1, names: ["Clearwater"] },
        { action: "something.else", n: 4, names: [] },
      ],
      held: [{ n: 1, names: ["Arc"] }],
      replies: [{ n: 1, names: ["Halyard"] }],
      matches: [{ n: 0, names: null }],
      zone: [{ zone: "Africa/Lagos" }],
    });
    const since = await readWorkSince(
      sql,
      actor,
      new Date("2026-10-08T09:00:00Z"),
      NOW,
    );
    expect(QWorkSinceDtoSchema.parse(since)).toEqual({
      since: "2026-10-08T09:00:00.000Z",
      sent: { n: 2, names: ["Halyard", "Nimbus"] },
      booked: { n: 1, names: ["Clearwater"] },
      interest: { n: 0, names: [] },
      held: { n: 1, names: ["Arc"] },
      replies: { n: 1, names: ["Halyard"] },
      matches: { n: 0, names: [] },
      timeZone: "Africa/Lagos",
    });
    // Every read is the person's own: their user id is bound in each.
    for (const read of seen) expect(read.values).toContain(actor.userId);
  });

  it("never reaches back more than a week, and drops a malformed zone", async () => {
    const { sql, seen } = fakeSql({
      zone: [{ zone: "not a zone; drop table" }],
    });
    const since = await readWorkSince(
      sql,
      actor,
      new Date("2026-01-01T00:00:00Z"),
      NOW,
    );
    expect(since.since).toBe("2026-10-01T14:00:00.000Z");
    expect(since.timeZone).toBeNull();
    expect(seen[0]?.values).toContainEqual(new Date("2026-10-01T14:00:00Z"));
  });
});
