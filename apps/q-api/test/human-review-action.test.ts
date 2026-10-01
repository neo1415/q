import { describe, expect, it } from "vitest";

import {
  createHumanReviewBoard,
  REVIEW_REQUEST,
} from "../src/composition/human-review-action.js";

/**
 * ADMIN-3: propose_human_review leaves exactly one request per run for the
 * run's own person; the approved payload names that person and nobody else.
 */
const USER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const TENANT = "c0000000-0000-4000-8000-000000000001";

function actor(userId: string) {
  return { userId, tenantId: TENANT } as never;
}

describe("human review board", () => {
  it("holds one request per run for the person, and proposes it once", async () => {
    const board = createHumanReviewBoard();
    const entry = {
      runId: "run-1",
      tenantId: TENANT,
      actorUserId: USER,
      subjectType: "VERIFICATION_DECISION" as const,
      subjectRef: "verification_claim:abc",
      reason: "The registry lists us under our old name.",
    };
    expect((await board.prepareHumanReview(entry)).status).toBe("PREPARED");
    expect(
      (
        await board.prepareHumanReview({
          ...entry,
          reason: "A different reason entirely.",
        })
      ).status,
    ).toBe("ONE_PER_TURN");
    const proposal = await board.proposer.propose({
      runId: "run-1",
      actor: actor(USER),
    } as never);
    expect(proposal).toEqual({
      actionType: REVIEW_REQUEST,
      payload: {
        requesterUserId: USER,
        subjectType: "VERIFICATION_DECISION",
        subjectRef: "verification_claim:abc",
        reason: "The registry lists us under our old name.",
      },
    });
    expect(
      await board.proposer.propose({
        runId: "run-1",
        actor: actor(USER),
      } as never),
    ).toBeNull();
  });

  it("never proposes for another person, and refuses a reason too short to review", async () => {
    const board = createHumanReviewBoard();
    await board.prepareHumanReview({
      runId: "run-2",
      tenantId: TENANT,
      actorUserId: USER,
      subjectType: "OTHER",
      subjectRef: null,
      reason: "Please have a person look at this.",
    });
    expect(
      await board.proposer.propose({
        runId: "run-2",
        actor: actor(OTHER),
      } as never),
    ).toBeNull();
    expect(
      (
        await board.prepareHumanReview({
          runId: "run-3",
          tenantId: TENANT,
          actorUserId: USER,
          subjectType: "OTHER",
          subjectRef: null,
          reason: "why",
        })
      ).status,
    ).toBe("REFUSED");
  });
});
