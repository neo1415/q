import { describe, expect, it } from "vitest";

import type { AnyQActionDefinition } from "@capital-q/q-actions";

import { createAppActionDefinitions } from "../src/composition/app-actions.js";
import { createChatMessageSendAction } from "../src/composition/chat-actions.js";
import { createConnectionRequestAnswerAction } from "../src/composition/connection-request-answer-action.js";
import { createConnectionRequestSendAction } from "../src/composition/connection-request-send-action.js";
import { createEmailSendAction } from "../src/composition/email-action.js";
import { createExpressInterestAction } from "../src/composition/express-interest-action.js";
import { createReviewRequestAction } from "../src/composition/human-review-action.js";
import { createInboundReplyAction } from "../src/composition/inbound-email.js";
import { createRespondToInterestAction } from "../src/composition/respond-to-interest-action.js";
import {
  createMeetingCancelAction,
  createMeetingRescheduleAction,
  createMeetingScheduleAction,
} from "../src/composition/schedule-actions.js";

/**
 * Coordinator 2026-10-23 (live: "Message Ledgerfold. Not saved yet" with
 * no words): every outward proposal -- something the other side receives
 * -- is prepared with the drafted text in full and "Ready to send", never
 * "Not saved yet". One case per outward action type, from the definition's
 * own proposed(payload, summary), as the narrator says it.
 */
const deps = {} as never;
const RELATIONSHIP = "11111111-1111-4111-8111-111111111111";
const READY = "Ready to send: approve on the card, or tell me what to change.";

function lineOf(definition: AnyQActionDefinition, payload: unknown): string {
  const summary = definition.describe(payload, []).summary;
  const proposed = definition.proposed;
  if (proposed === undefined) {
    throw new Error(`${definition.actionType} has no prepared line`);
  }
  return proposed(payload, summary);
}

const BODY = "Hi Ledgerfold team, I'd like a call next week. Best, Amara";

const cases: readonly [string, AnyQActionDefinition, unknown, string | null][] =
  [
    [
      "chat.message.send",
      createChatMessageSendAction(deps),
      {
        relationshipId: RELATIONSHIP,
        counterpartName: "Ledgerfold",
        body: BODY,
      },
      BODY,
    ],
    [
      "email.send",
      createEmailSendAction(deps),
      {
        relationshipId: RELATIONSHIP,
        counterpartName: "Savanna Seed Partners",
        to: "amara@example.com",
        toName: "Amara",
        subject: "Kiosk economics",
        body: BODY,
      },
      `Subject: Kiosk economics\n\n${BODY}`,
    ],
    [
      "email.inbound.reply",
      createInboundReplyAction(deps),
      {
        inboundEmailId: RELATIONSHIP,
        to: "amara@example.com",
        toName: "Amara",
        replyTo: "q@example.com",
        subject: "Re: hello",
        body: BODY,
      },
      `Subject: Re: hello\n\n${BODY}`,
    ],
    [
      "relationship.interest.express (with a note)",
      createExpressInterestAction(deps),
      { companyId: RELATIONSHIP, companyName: "Silo Credit", note: BODY },
      BODY,
    ],
    [
      "relationship.interest.respond",
      createRespondToInterestAction(deps),
      {
        interestId: RELATIONSHIP,
        investorName: "Rift Valley Seed Fund",
        decision: "ACCEPTED",
      },
      null,
    ],
    [
      "relationship.connection_request.send",
      createConnectionRequestSendAction(deps),
      { investorOrganisationId: RELATIONSHIP, investorName: "Kestrel" },
      null,
    ],
    [
      "relationship.connection_request.respond (with its message)",
      createConnectionRequestAnswerAction(deps),
      {
        interestId: RELATIONSHIP,
        companyId: RELATIONSHIP,
        companyName: "Ledgerfold",
        decision: "ACCEPTED",
        openingMessage: BODY,
      },
      BODY,
    ],
    [
      "review.request",
      createReviewRequestAction(deps),
      {
        subjectType: "COMPANY",
        subjectRef: RELATIONSHIP,
        reason: "Check our deck.",
      },
      "Check our deck.",
    ],
    [
      "meeting.schedule",
      createMeetingScheduleAction(deps),
      {
        relationshipId: RELATIONSHIP,
        counterpartName: "Ledgerfold",
        purpose: "Introductory call",
        startsAt: "2026-10-30T09:00:00.000Z",
        timeZone: "UTC",
        durationMinutes: 30,
      },
      null,
    ],
    [
      "meeting.reschedule",
      createMeetingRescheduleAction(deps),
      {
        relationshipId: RELATIONSHIP,
        meetingId: RELATIONSHIP,
        purpose: "Introductory call",
        startsAt: "2026-10-30T09:00:00.000Z",
        durationMinutes: 30,
      },
      null,
    ],
    [
      "meeting.cancel",
      createMeetingCancelAction(deps),
      {
        relationshipId: RELATIONSHIP,
        meetingId: RELATIONSHIP,
        purpose: "Introductory call",
        startsAt: "2026-10-30T09:00:00.000Z",
      },
      null,
    ],
  ];

describe("every outward proposal is ready to send, with its words in full", () => {
  it.each(cases)("%s", (_name, definition, payload, text) => {
    const line = lineOf(definition, payload);
    expect(line).toContain(READY);
    expect(line).not.toContain("Not saved yet");
    if (text !== null) expect(line).toContain(`"${text}"`);
  });

  it("the app actions that reach the other side say it the same way", () => {
    const outward = new Map<string, unknown>([
      [
        "app.chat.message.send",
        {
          relationshipId: RELATIONSHIP,
          idempotencyKey: "k",
          input: { kind: "TEXT", body: BODY },
        },
      ],
      [
        "app.relationship.interest.express",
        { companyId: RELATIONSHIP, idempotencyKey: "k", input: { note: BODY } },
      ],
      [
        "app.relationship.connection_request.send",
        { investorOrganisationId: RELATIONSHIP, idempotencyKey: "k" },
      ],
    ]);
    const definitions = createAppActionDefinitions(deps).filter((one) =>
      outward.has(one.actionType),
    );
    expect(definitions.map((one) => one.actionType).sort()).toEqual(
      [...outward.keys()].sort(),
    );
    for (const definition of definitions) {
      const line = lineOf(definition, outward.get(definition.actionType));
      expect(line, definition.actionType).toContain(READY);
      expect(line).not.toContain("Not saved yet");
    }
    const chat = definitions.find(
      (one) => one.actionType === "app.chat.message.send",
    );
    expect(
      lineOf(
        chat as AnyQActionDefinition,
        outward.get("app.chat.message.send"),
      ),
    ).toContain(`"${BODY}"`);
  });

  it("a profile edit keeps no prepared line of its own (Not saved yet stays for edits)", () => {
    const edits = createAppActionDefinitions(deps).filter(
      (one) => one.actionType === "app.person.profile.update",
    );
    expect(edits).toHaveLength(1);
    for (const definition of edits) expect(definition.proposed).toBeUndefined();
  });
});
