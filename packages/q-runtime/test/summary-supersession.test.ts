import { describe, expect, it } from "vitest";

import type { QConversationId } from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import {
  planSummarySupersession,
  SUMMARY_CORRECTION_GATE_VERSION,
  supersedeConversationSummary,
  type SummarySupersessionDependencies,
} from "../src/application/summary-supersession.js";
import type { QConversation } from "../src/contracts/index.js";
import { CONVERSATION_SUMMARY_GATE_VERSION } from "../src/contracts/conversation-state.js";

/**
 * Thames Arc, 16 Nov 2026: conversation 8811f9c7's summary held Q's wrong
 * "4 public-sector account managers" (the plan's row says 3). The
 * correction is the summary's own lifecycle: the next, append-only
 * revision, marked as a correction; the stale revision stays as history
 * and the digest recall reads moves to the corrected text. Running it
 * again does nothing.
 */

const TENANT = "47677daa-109b-4b92-add7-a5a94f91ed9c" as TenantId;
const USER = "fd9945d9-a463-4b01-949f-0be1aee9e5c8" as UserId;
const CONVERSATION = "8811f9c7-9d7a-42f6-9cae-4ae22c069a08" as QConversationId;
const STALE =
  "The plan projects 15 hires if the seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1.";
const PUT_RIGHT =
  "The plan projects 15 hires if the seed round closes: 3 public-sector account managers and 1 information security and assurance manager in Q1.";

function world(summary: string | null = STALE) {
  const revisions = [
    {
      revision: 1,
      summary: "Amelia asked about the plan.",
      gateVersion: CONVERSATION_SUMMARY_GATE_VERSION,
      coversThroughAt: "2026-11-16T18:19:40.000Z",
      coveredMessages: 3,
    },
    {
      revision: 2,
      summary: STALE,
      gateVersion: CONVERSATION_SUMMARY_GATE_VERSION,
      coversThroughAt: "2026-11-16T18:20:30.956Z",
      coveredMessages: 5,
    },
  ];
  const conversation = {
    id: CONVERSATION,
    tenantId: TENANT,
    userId: USER,
    title: "Halyard Security hiring plan",
    summary,
    summaryThrough: "2026-11-16T18:20:30.956Z",
  } as unknown as QConversation & { summary: string | null };
  const transactions: TransactionManager = {
    run: (work) => work({ sql: {} } as unknown as TransactionContext),
  };
  const dependencies: SummarySupersessionDependencies = {
    sql: {} as never,
    transactions,
    conversations: {
      findForOwner: (_e, tenantId, userId, id) =>
        Promise.resolve(
          tenantId === TENANT && userId === USER && id === CONVERSATION
            ? { ...conversation }
            : null,
        ),
      setDigest: (_tx, _tenant, _id, digest) => {
        conversation.summary = digest.summary;
        return Promise.resolve();
      },
    },
    states: {
      latestSummary: () => {
        const last = revisions.at(-1);
        return Promise.resolve(
          last === undefined
            ? null
            : {
                revision: last.revision,
                summary: last.summary,
                coversThroughAt: last.coversThroughAt,
                coveredMessages: last.coveredMessages,
              },
        );
      },
      appendSummary: (_tx, input) => {
        const revision = revisions.length + 1;
        revisions.push({
          revision,
          summary: input.summary,
          gateVersion: input.gateVersion,
          coversThroughAt: input.coversThroughAt,
          coveredMessages: input.coveredMessages,
        });
        return Promise.resolve(revision);
      },
    },
  };
  return { dependencies, revisions, conversation };
}

const input = {
  tenantId: TENANT,
  userId: USER,
  conversationId: CONVERSATION,
  from: STALE,
  summary: PUT_RIGHT,
  grounds: [],
};

describe("superseding a summary whose count the document contradicts", () => {
  it("appends a correction revision, keeps the stale one, and moves the digest", async () => {
    const { dependencies, revisions, conversation } = world();
    const outcome = await supersedeConversationSummary(dependencies, input);
    expect(outcome).toEqual({ kind: "SUPERSEDED", revision: 3 });
    expect(revisions.map((r) => r.summary)).toEqual([
      "Amelia asked about the plan.",
      STALE,
      PUT_RIGHT,
    ]);
    expect(revisions[2]?.gateVersion).toBe(SUMMARY_CORRECTION_GATE_VERSION);
    // It covers exactly what the stale revision covered.
    expect(revisions[2]?.coversThroughAt).toBe(revisions[1]?.coversThroughAt);
    expect(revisions[2]?.coveredMessages).toBe(5);
    expect(conversation.summary).toBe(PUT_RIGHT);
  });

  it("is idempotent: run again, nothing more is written", async () => {
    const { dependencies, revisions } = world();
    await supersedeConversationSummary(dependencies, input);
    const again = await supersedeConversationSummary(dependencies, input);
    expect(again).toEqual({ kind: "MOVED_ON" });
    expect(revisions).toHaveLength(3);
  });

  it("leaves a summary that moved on, another person's, and an ungrounded figure alone", async () => {
    const moved = world("Amelia asked something newer.");
    expect(
      await supersedeConversationSummary(moved.dependencies, input),
    ).toEqual({ kind: "MOVED_ON" });
    expect(moved.revisions).toHaveLength(2);

    const other = world();
    expect(
      await supersedeConversationSummary(other.dependencies, {
        ...input,
        userId: "00000000-0000-4000-8000-000000000001" as UserId,
      }),
    ).toEqual({ kind: "NOT_FOUND" });

    const minted = world();
    expect(
      await planSummarySupersession(minted.dependencies, {
        ...input,
        summary: `${PUT_RIGHT} It will cost £480,000.`,
      }),
    ).toMatchObject({ kind: "REFUSED" });
    expect(minted.revisions).toHaveLength(2);
  });
});
