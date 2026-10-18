import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { workforceCorrelationId } from "@capital-q/contracts";
import {
  DRAFT_INTEGRITY_RULES,
  DRAFT_RUBRIC_CRITERIA,
} from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import { createEmailActionBoard } from "../src/composition/email-action.js";
import {
  createOutwardReview,
  createPassedDrafts,
  reviewedReply,
} from "../src/composition/workforce/review.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * The workforce review gaps (2026-10-06): an email draft is tied to its
 * approval card, it is graded under the person's real name, a first draft
 * is filed (and priced) under the job before it is written, a delegated
 * reply records "sent" only once it really went.
 */

const OWNER = { tenantId: randomUUID(), userId: randomUUID() };
const actor = ActorContextSchema.parse({
  tenantId: OWNER.tenantId,
  userId: OWNER.userId,
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

const PASS = {
  criteria: DRAFT_RUBRIC_CRITERIA.map((criterion) => ({
    criterion,
    score: 5,
    note: "",
  })),
  integrity: DRAFT_INTEGRITY_RULES.map((rule) => ({
    rule,
    ok: true,
    note: "",
  })),
  feedback: "",
};

function graded() {
  const store = createInMemoryWorkforceStore();
  const principals: string[] = [];
  const review = createOutwardReview({
    store,
    models: {
      review: (_who, _trace, variables) => {
        principals.push(variables.principalName);
        return Promise.resolve(PASS);
      },
      redraft: () => Promise.resolve(null),
    },
  });
  return { store, review, principals };
}

describe("review gaps", () => {
  it("an email draft is graded under their own name and tied to its card", async () => {
    const { store, review, principals } = graded();
    const board = createEmailActionBoard({
      review,
      principalName: () => Promise.resolve("Ada Obi"),
    });
    const payload = {
      relationshipId: randomUUID(),
      to: "priya@kestrel.example",
      toName: "Priya Shah",
      counterpartName: "Kestrel Heat",
      subject: "Hello",
      body: "Priya, your installs stand out.",
    };
    board.prepareForApproval({
      runId: "run-email",
      tenantId: OWNER.tenantId,
      actorUserId: OWNER.userId,
      payload,
    });
    const proposal = await board.proposer.propose({
      runId: "run-email",
      actor,
    } as unknown as Parameters<typeof board.proposer.propose>[0]);
    expect(principals).toEqual(["Ada Obi"]);
    if (proposal === null || "refused" in proposal) throw new Error("none");
    // Nothing is linked until the card exists...
    expect(store.rows.outcomes).toEqual([]);
    const actionId = randomUUID();
    await proposal.onProposed?.(actionId);
    // ...then the card's decision is the draft's feedback.
    expect(await store.draftForAction(OWNER, actionId)).toBe(
      store.rows.drafts[0]?.id,
    );
  });

  it("files a first draft before it is written, so its writer is priced under the job", async () => {
    const { store, review } = graded();
    const source = {
      kind: "DELEGATED_WORK",
      id: "deleg-1",
      goal: "Q's outreach",
    } as const;
    const prepared = await review.prepare(OWNER, source, {
      channel: "CHAT",
      counterpartName: "Priya",
    });
    if (prepared === null) throw new Error("not filed");
    expect(prepared.correlationId).toBe(
      workforceCorrelationId(prepared.jobId, prepared.writer),
    );
    const passed = createPassedDrafts();
    const result = await reviewedReply(
      review,
      OWNER,
      source,
      {
        principalName: "Ada Obi",
        counterpartName: "Priya",
        channel: "CHAT",
        stage: "REPLY",
        purpose: "Reply",
        material: "",
        thread: "",
      },
      { reply: "Thanks Priya.", forPerson: [] },
      (verdict) => {
        passed.remember("deleg-1", verdict);
      },
      prepared,
    );
    expect(result?.reply).toBe("Thanks Priya.");
    // One writer and one reviewer: the prepared runs, not a second pair.
    expect(store.rows.runs.filter((run) => run.role === "WRITER")).toHaveLength(
      1,
    );
    expect(store.rows.drafts[0]?.writer_run_id).toBe(prepared.writer);
    // Not "sent" until it really went.
    expect(store.rows.outcomes).toEqual([]);
    const verdict = passed.take("deleg-1", "Thanks Priya.");
    expect(verdict).not.toBeNull();
    if (verdict !== null) await review.settle(OWNER, verdict, "SENT");
    expect(store.rows.outcomes).toEqual([
      expect.objectContaining({ outcome: "SENT" }),
    ]);
    // Taken once.
    expect(passed.take("deleg-1", "Thanks Priya.")).toBeNull();
  });

  it("a prepared message with nothing to say ends its runs", async () => {
    const { store, review } = graded();
    const source = {
      kind: "ERRAND",
      id: "errand-1",
      goal: "Look after Priya",
    } as const;
    const prepared = await review.prepare(OWNER, source, {
      channel: "CHAT",
      counterpartName: "Priya",
    });
    await reviewedReply(
      review,
      OWNER,
      source,
      {
        principalName: "Ada",
        counterpartName: "Priya",
        channel: "CHAT",
        stage: "REPLY",
        purpose: "Reply",
        material: "",
        thread: "",
      },
      { reply: null, forPerson: [] },
      undefined,
      prepared,
    );
    expect(
      store.rows.runs
        .filter((run) => run.role === "WRITER" || run.role === "REVIEWER")
        .map((run) => run.status),
    ).toEqual(["DONE", "SKIPPED"]);
  });
});
