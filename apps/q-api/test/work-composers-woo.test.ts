import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";

import { createWorkComposers } from "../src/composition/work/composers.js";

/**
 * Founder 2026-10-07 (messages that woo): a reply Q writes to the other
 * side in delegated work is checked by code and written once more when it
 * reads as a hard sell; still failing, nothing is sent. Fake gateway: no
 * model is called.
 */

const who = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
};

function composers(replies: readonly (string | null)[]) {
  const notes: string[] = [];
  let call = 0;
  const gateway = {
    execute: (request: { messages: readonly { content: string }[] }) => {
      notes.push(request.messages.map((message) => message.content).join("\n"));
      const reply = replies[Math.min(call, replies.length - 1)] ?? null;
      call += 1;
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: { reply, deferred: false, forPerson: [] },
        },
      });
    },
  } as unknown as ModelGateway;
  return { work: createWorkComposers({ gateway }), notes, calls: () => call };
}

const variables = {
  principalName: "Megan",
  counterpartName: "Zino Aviation",
  brief: "Shiftwell: $4.1m ARR, 290 agencies.",
  otherSideIsQ: false,
  thread: "Zino: What drew you to home care?",
};

describe("a founder's stand-in reply that woos", () => {
  it("a warm reply goes as written, in one call", async () => {
    const { work, calls } = composers([
      "Thank you for asking, Zino. Home care drew us in because agencies run on paper; 290 agencies now schedule and pay through Shiftwell.",
    ]);
    const out = await work.standInReply(who, variables);
    expect(out?.reply).toContain("Thank you for asking");
    expect(calls()).toBe(1);
  });

  it("a demanding reply is written once more with what to change", async () => {
    const { work, notes, calls } = composers([
      "Send us your term sheet by Friday.",
      "Thank you for asking, Zino. Home care drew us in because agencies run on paper; 290 agencies now use Shiftwell.",
    ]);
    const out = await work.standInReply(who, variables);
    expect(calls()).toBe(2);
    expect(notes[1]).toContain("Your last draft was sent back");
    expect(out?.reply).toContain("Thank you for asking");
  });

  it("still pushy after the rewrite: no reply goes", async () => {
    const { work, calls } = composers([
      "Act now: our round is closing soon.",
      "You must move fast, our round is closing soon.",
    ]);
    const out = await work.standInReply(who, variables);
    expect(calls()).toBe(2);
    expect(out?.reply).toBeNull();
  });
});
