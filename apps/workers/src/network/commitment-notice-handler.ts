import type { EventRegistry } from "@capital-q/contracts";
import type { CounterpartNotices } from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  RelationshipCommitmentChangedEvent,
  type CommitmentStep,
} from "@capital-q/network/events";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * The other side hears each step of a commitment (founder direction
 * 2026-10-04: "how does one now confirm they've gotten the money"): an
 * amount to confirm, both sides confirmed, money marked sent, money
 * received. The notice names who acted and the amount the two sides
 * already share; a transfer reference is never copied in. Once per
 * happening (dedupe on the outbox event id); links to their Capital page.
 */

export type CommitmentNoticeOptions = {
  readonly registry: EventRegistry;
  readonly sql: DatabaseExecutor;
  readonly notices: Pick<CounterpartNotices, "notify">;
  readonly logger: RunnerLogger;
};

/** Money as people write it: exact digits grouped, never via a float. */
export function moneyWords(amount: string, currency: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents =
    fraction === undefined || /^0*$/.test(fraction)
      ? ""
      : `.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return `${currency} ${grouped}${cents}`;
}

/** The words for the other side. Pure, so they are tested as words. */
export function commitmentNotice(input: {
  readonly step: CommitmentStep;
  readonly actor: string;
  readonly money: string;
}): {
  readonly title: string;
  readonly body: string | null;
  readonly priority: "NEEDS_YOU" | "UPDATE";
} {
  switch (input.step) {
    case "AMOUNT_STATED":
      return {
        title: `${input.actor} confirmed ${input.money}`,
        body: "Confirm the amount if it's right.",
        priority: "NEEDS_YOU",
      };
    case "AMOUNT_CONFIRMED":
      return {
        title: `${input.actor} confirmed ${input.money}`,
        body: "Both sides have confirmed the amount.",
        priority: "UPDATE",
      };
    case "TRANSFER_SENT":
      return {
        title: `${input.actor} sent ${input.money}`,
        body: "Confirm when it arrives.",
        priority: "NEEDS_YOU",
      };
    case "RECEIVED":
      return {
        title: `${input.actor} received ${input.money}`,
        body: null,
        priority: "UPDATE",
      };
  }
}

export function withCommitmentNotices(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: CommitmentNoticeOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (
      !parsed.ok ||
      parsed.message.type !== RelationshipCommitmentChangedEvent.name
    ) {
      return inner(message);
    }
    const data = RelationshipCommitmentChangedEvent.dataSchema.safeParse(
      parsed.message.data,
    );
    if (!data.success) return inner(message);
    const event = data.data;
    try {
      const facts = (
        await options.sql<
          {
            company: string;
            investor: string;
            amount: string;
            currency: string;
          }[]
        >`
          select c.canonical_name as company, i.display_name as investor,
                 m.amount::text as amount, m.currency_code as currency
            from network.commitments m
            join network.relationships r on r.id = m.relationship_id
            join core.companies c on c.id = r.company_id
            join core.investor_organisations i on i.id = r.investor_organisation_id
           where m.id = ${event.commitmentId}
             and m.relationship_id = ${event.relationshipId}`
      )[0];
      if (facts !== undefined) {
        const words = commitmentNotice({
          step: event.step,
          actor: event.side === "INVESTOR" ? facts.investor : facts.company,
          money: moneyWords(facts.amount, facts.currency),
        });
        await options.notices.notify({
          relationshipId: event.relationshipId,
          actingSide: event.side,
          kind: "COMMITMENT",
          title: words.title,
          body: words.body,
          target: "CAPITAL",
          key: parsed.message.id,
          priority: words.priority,
        });
      }
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "commitment notice not written; retrying",
      );
      return { kind: "RETRY", errorCode: "COMMITMENT_NOTICE_FAILED" };
    }
    return inner(message);
  };
}
