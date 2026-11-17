import { describe, expect, it } from "vitest";

import {
  decidePending,
  followsUpCard,
  PREPARE_AGAIN_OFFER,
  type DecisionReading,
  type PendingDecisionPort,
  type PendingDecisionStatus,
  type PendingTurnReading,
} from "../src/pending-decision.js";

/**
 * Replay of production conversation 9995dcca (17 Nov 2026, investor Zino
 * Aviation, company Ajopot), from q_runtime.conversation_messages, runs,
 * actions and approvals. No live call: the decision reader's reading is
 * faked; every status and card text is the stored one.
 *
 * 15:01:34  card c02fa2c8 "Send Ajopot this question", preview "1. The
 *           records do not establish exactly who pays Ajopot's 1% payout
 *           fee." (app.diligence.questions.send)
 * 15:03:14  run a3ea0ea5 failed RUN_EXPIRED; action WITHDRAWN, approval
 *           REVOKED (plain status EXPIRED); never approved
 * 15:05:53  "Yeah, I approved what he wanted to send" (TOOL_REQUEST)
 *           -> Q: "I didn't prepare that, so nothing was changed."
 * 15:06:52  "please go ahead and ask that question and send it to them"
 *           (TOOL_REQUEST, tool NAVIGATE RELATIONSHIPS)
 *           -> Q: pipeline counts and "Opening the CRM…"
 */

const CARD_SUMMARY = "Send Ajopot this question";
const CARD_PREVIEW =
  "1. The records do not establish exactly who pays Ajopot's 1% payout fee.";
const TOOL = "send_questions_to_founder";
const READY_LINE = `Send Ajopot this question: "${CARD_PREVIEW}". Ready to send: approve on the card, or tell me what to change.`;

const POINTS: DecisionReading = {
  decision: "YES",
  remainder: null,
  explicit: true,
  pointsAtIt: true,
  asksSomethingElse: false,
};

function port(
  status: PendingDecisionStatus,
  reading: DecisionReading = POINTS,
) {
  const approved: string[] = [];
  const value: PendingDecisionPort = {
    proposals: () =>
      Promise.resolve([
        {
          proposalId: "c02fa2c8-9049-4f1b-add8-48baaba329b4",
          summary: CARD_SUMMARY,
          status,
          outward: true,
          tool: TOOL,
          preview: CARD_PREVIEW,
        },
      ]),
    read: () => Promise.resolve(reading),
    approve: (_context, proposalId) => {
      approved.push(proposalId);
      return Promise.resolve({
        status: "SAVED",
        line: "Sent in your chat with them.",
      });
    },
    decline: () => Promise.resolve({ status: "DECLINED" }),
  };
  return { value, approved };
}

const context = {
  actor: {} as never,
  runId: "r",
  correlationId: "c",
  tenantId: "t",
  userId: "u",
};

/** The turn reader's readings, as routed in production. */
const CLAIMED_APPROVAL: PendingTurnReading = {
  kind: "TOOL_REQUEST",
  addressedToQ: true,
  namesAction: false,
  askedAction: null,
  hand: null,
};
const SEND_IT_READ_AS_CRM: PendingTurnReading = {
  kind: "TOOL_REQUEST",
  addressedToQ: true,
  namesAction: true,
  askedAction: null,
  hand: "NAVIGATE",
};

function decide(
  utterance: string,
  status: PendingDecisionStatus,
  turn: PendingTurnReading,
  reading?: DecisionReading,
) {
  const { value, approved } = port(status, reading);
  return decidePending(value, {
    context,
    utterance,
    recentTurns: [
      { role: "USER", text: "Go ahead and do that" },
      { role: "Q", text: READY_LINE },
    ],
    turn,
  }).then((outcome) => ({ outcome, approved }));
}

describe("a follow-up to Q's own card resolves to that card (replay 9995dcca)", () => {
  it("15:05:53, the card had lapsed: the record says so and offers it again, never 'I didn't prepare that'", async () => {
    const { outcome, approved } = await decide(
      "Yeah, I approved what he wanted to send",
      "EXPIRED",
      CLAIMED_APPROVAL,
    );
    expect(approved).toEqual([]);
    expect(outcome.kind).toBe("REPLY");
    if (outcome.kind !== "REPLY") return;
    expect(outcome.line).toBe(
      `That card expired before it was approved, so nothing was sent: ${CARD_SUMMARY}. ${PREPARE_AGAIN_OFFER}`,
    );
    expect(outcome.line).not.toMatch(/didn't prepare/u);
    // The offer is exactly what the card showed, for a new approval.
    expect(outcome.offer).toEqual({
      action: TOOL,
      request: `${CARD_SUMMARY}, exactly as the card showed it: ${CARD_PREVIEW}`,
      said: PREPARE_AGAIN_OFFER,
    });
  });

  it("15:06:52, 'send it to them' read as a move to the CRM: answered from the card, not the pipeline", async () => {
    const { outcome } = await decide(
      "Sorry, it's just—thank you. Yeah, so please go ahead and ask that question and send it to them.",
      "EXPIRED",
      SEND_IT_READ_AS_CRM,
    );
    expect(outcome.kind).toBe("REPLY");
    if (outcome.kind !== "REPLY") return;
    expect(outcome.line).toMatch(/^That card expired before it was approved/u);
  });

  it("with the card still waiting (as it would have been without the lapse), the same words approve it through the engine", async () => {
    const { outcome, approved } = await decide(
      "Sorry, it's just—thank you. Yeah, so please go ahead and ask that question and send it to them.",
      "PENDING",
      SEND_IT_READ_AS_CRM,
    );
    expect(approved).toEqual(["c02fa2c8-9049-4f1b-add8-48baaba329b4"]);
    expect(outcome).toEqual({
      kind: "REPLY",
      line: "Sent in your chat with them.",
    });
  });

  it("a yes that points at the card without deciding it in clear words points to the card; nothing is approved", async () => {
    const { outcome, approved } = await decide(
      "Yeah, I approved what he wanted to send",
      "PENDING",
      CLAIMED_APPROVAL,
      { ...POINTS, explicit: false, onlyDecision: false, remainder: null },
    );
    expect(approved).toEqual([]);
    expect(outcome.kind).toBe("REPLY");
    if (outcome.kind !== "REPLY") return;
    expect(outcome.line).toMatch(/Tap Approve on the card/u);
  });

  it("the yes to Q's offer to prepare it again is the offer's, not the card's status again", async () => {
    const { value } = port("EXPIRED");
    const outcome = await decidePending(value, {
      context,
      utterance: "Yes please",
      recentTurns: [
        {
          role: "Q",
          text: `That card expired before it was approved, so nothing was sent: ${CARD_SUMMARY}. ${PREPARE_AGAIN_OFFER}`,
        },
      ],
      turn: { kind: "ANSWER", addressedToQ: true, namesAction: false },
    });
    expect(outcome).toEqual({ kind: "NONE" });
  });

  it("a request for a different action, or another hand, is never taken for the card", async () => {
    expect(
      followsUpCard(
        { ...SEND_IT_READ_AS_CRM, askedAction: "book_meeting", hand: null },
        { tool: TOOL },
      ),
    ).toBe(false);
    expect(
      followsUpCard(
        { ...SEND_IT_READ_AS_CRM, hand: "SET_VISIBILITY" },
        {
          tool: TOOL,
        },
      ),
    ).toBe(false);
    expect(
      followsUpCard(
        { ...SEND_IT_READ_AS_CRM, askedAction: TOOL, hand: null },
        {
          tool: TOOL,
        },
      ),
    ).toBe(true);
    const { outcome } = await decide(
      "Book a call with Ajopot for Friday",
      "EXPIRED",
      { ...SEND_IT_READ_AS_CRM, askedAction: "book_meeting", hand: null },
    );
    expect(outcome).toEqual({ kind: "NONE" });
  });

  it("a request the reading says asks for something else is not the card", async () => {
    const { outcome } = await decide(
      "Open the CRM",
      "PENDING",
      SEND_IT_READ_AS_CRM,
      { decision: "UNRELATED", remainder: null },
    );
    expect(outcome).toEqual({ kind: "NONE" });
  });
});
