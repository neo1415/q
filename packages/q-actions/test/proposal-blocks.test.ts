import { describe, expect, it } from "vitest";

import {
  createQActionNarrator,
  proposalBlocks,
  proposedLine,
} from "../src/application/narrator.js";

/**
 * QA 2026-10-01: a reminder proposed in a turn whose answer structure was
 * refused left no ACTION_PROPOSAL in the conversation, so a typed "go
 * ahead" and the card after a reload could not find it. The "Not saved
 * yet" line now carries the proposal.
 */
const action = {
  id: "7e09ef10-e6b2-4004-9227-580fe19b7a9c",
  runId: "687cdf89-6fcc-4f5a-988a-2dd336a7688e",
  actionType: "reminder.create",
  riskClass: "CONFIRM_REQUIRED",
  targets: [{ kind: "USER", userId: "56e3adff-bc0d-42aa-a161-e1fa522a901b" }],
  summary: "Reminder: Review the term sheet",
  preview: null,
  createdAt: "2026-10-01T12:43:40.890Z",
} as never;

describe("the waiting line carries its proposal", () => {
  it("as an ACTION_PROPOSAL block bound to the approval", () => {
    const blocks = proposalBlocks(action, {
      id: "c888abda-52aa-49ba-92df-80886d7831ff",
      expiresAt: "2026-10-02T12:43:40.890Z",
    });
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toMatchObject({
      kind: "ACTION_PROPOSAL",
      proposal: {
        proposalId: "7e09ef10-e6b2-4004-9227-580fe19b7a9c",
        summary: "Reminder: Review the term sheet",
        approval: {
          approval: { approvalId: "c888abda-52aa-49ba-92df-80886d7831ff" },
        },
      },
    });
  });

  it("not at all without the approval it is bound to", () => {
    expect(proposalBlocks(action, undefined)).toBeUndefined();
  });
});

describe("proposedLine (owner 2026-10-16)", () => {
  it("invites words only for a kind words may approve", () => {
    expect(proposedLine("Update your raise")).toMatch(/tell me to go ahead/);
    expect(proposedLine("Update your raise", true)).toBe(
      "Update your raise. Not saved yet: it needs your tap on Approve on the card.",
    );
  });
});

// Approval card upgrade (QA lead 2026-10-24): "Why: …" and whom it is for.
describe("the card says why, and whom it is for", () => {
  it("carries the reason and the named target with its picture", () => {
    const blocks = proposalBlocks(
      { ...(action as object), reason: "You asked to be reminded." } as never,
      {
        id: "c888abda-52aa-49ba-92df-80886d7831ff",
        expiresAt: "2026-10-02T12:43:40.890Z",
      },
      {
        kind: "COMPANY",
        id: "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70",
        photoUrl: null,
      },
    );
    expect(blocks?.[0]).toMatchObject({
      kind: "ACTION_PROPOSAL",
      proposal: {
        reason: "You asked to be reminded.",
        named: {
          kind: "COMPANY",
          id: "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70",
          photoUrl: null,
        },
      },
    });
  });
});

/**
 * F-106 (batch 9): "That's ready: … It's waiting for your yes" was said
 * with no card on screen. "Ready" and "tap Approve on the card" are said
 * only beside the card; a change whose card cannot be put in the answer is
 * named with where it waits.
 */
describe("ready is never said without its card (F-106)", () => {
  function narrator(registry: unknown = { get: () => undefined }) {
    const said: { content: string; blocks: unknown }[] = [];
    const n = createQActionNarrator({
      sql: {} as never,
      transactions: {
        run: (work: (tx: never) => unknown) => work({} as never),
      } as never,
      runtime: {
        runs: {
          findForActor: () => Promise.resolve({ conversationId: "c1" }),
        },
        messages: {
          insert: (
            _tx: unknown,
            row: { content: string; blocks?: unknown },
          ) => {
            said.push({ content: row.content, blocks: row.blocks });
            // The event write is not under test here.
            return Promise.reject(new Error("not recorded in this test"));
          },
        },
        runEvents: {},
      } as never,
      actions: {} as never,
      registry: registry as never,
    });
    return { said, n };
  }
  const run = {
    runId: "687cdf89-6fcc-4f5a-988a-2dd336a7688e",
    tenantId: "t1",
    actorUserId: "u1",
  } as never;
  const approval = {
    id: "c888abda-52aa-49ba-92df-80886d7831ff",
    expiresAt: "2026-10-02T12:43:40.890Z",
  };

  it("says ready with the card it already has", async () => {
    const { said, n } = narrator();
    await n.proposed(run, action, approval, { alreadyWaiting: true });
    expect(said[0]?.content).toMatch(/^That's ready: /u);
    expect(said[0]?.blocks).toMatchObject([{ kind: "ACTION_PROPOSAL" }]);
  });

  // Batch 9: "Draft a short reply… then send it" met the card already
  // waiting. Approval stays required (Prepare → Approve); the reply says
  // so plainly, with the words that would go.
  it("says a waiting message is ready to send, with its text", async () => {
    const { said, n } = narrator({
      get: () => ({
        payload: {
          safeParse: (value: unknown) => ({ success: true, data: value }),
        },
        proposed: (input: { body: string }, summary: string) =>
          `${summary}: "${input.body}". Ready to send: approve on the card, or tell me what to change.`,
      }),
    });
    await n.proposed(
      run,
      {
        ...(action as object),
        actionType: "app.chat.message.send",
        summary: "Message Savanna Seed Partners",
        payload: { body: "We'll share it once we've reconciled September." },
      },
      approval,
      { alreadyWaiting: true },
    );
    expect(said[0]?.content).toBe(
      `Message Savanna Seed Partners: "We'll share it once we've reconciled September.". Ready to send: approve on the card, or tell me what to change.`,
    );
    expect(said[0]?.blocks).toMatchObject([{ kind: "ACTION_PROPOSAL" }]);
  });

  it("names where it waits when no card can be shown", async () => {
    const { said, n } = narrator();
    await n.proposed(run, action, undefined, { alreadyWaiting: true });
    expect(said[0]?.content).toBe(
      "Reminder: Review the term sheet is waiting for your approval under Needs you.",
    );
    expect(said[0]?.blocks).toBeUndefined();
    expect(said[0]?.content).not.toMatch(/ready|card/iu);
  });
});
