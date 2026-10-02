import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createOwnCalls } from "../src/composition/own-calls.js";

/**
 * read_my("calls") (2026-10-02): what was agreed is both sides'; Q's
 * follow-ups are only the person's own notes; a proposal made to Q in the
 * call is only the organiser's to act on.
 */
describe("their recent calls with Q's notes", () => {
  const actor = {
    userId: "00000000-0000-4000-8000-0000000000a1",
    tenantId: "00000000-0000-4000-8000-0000000000f1",
    actorType: "HUMAN",
  } as unknown as ActorContext;

  const read = (row: Record<string, unknown>) => {
    const fake = () =>
      Promise.resolve([
        {
          id: "00000000-0000-4000-8000-000000000101",
          purpose: "Intro call with Apex",
          starts_at: new Date("2026-10-01T10:00:00Z"),
          agreements: ["Apex to start diligence"],
          follow_ups: [{ text: "Send the model", owner: null }],
          proposals: ["Book a call with the partners"],
          ...row,
        },
      ]);
    return createOwnCalls({ sql: fake as unknown as DatabaseExecutor })(actor);
  };

  it("the organiser who owns the notes sees agreements, follow-ups and in-call proposals", async () => {
    const [call] = await read({ own_notes: true, organiser: true });
    expect(call?.facts).toMatchObject({
      agreed: "Apex to start diligence",
      yourFollowUps: "Send the model",
      proposedToQInTheCall: "Book a call with the partners",
    });
  });

  it("the other side sees what was agreed, never the other side's Q notes or proposals", async () => {
    const [call] = await read({ own_notes: false, organiser: false });
    expect(call?.facts).toMatchObject({
      agreed: "Apex to start diligence",
      yourFollowUps: null,
      proposedToQInTheCall: null,
    });
  });
});
