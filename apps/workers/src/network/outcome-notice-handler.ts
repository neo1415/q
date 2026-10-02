import type { EventRegistry } from "@capital-q/contracts";
import type { CounterpartNotices } from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import { RelationshipOutcomeRecordedEvent } from "@capital-q/network/events";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * The other side hears about a post-meeting outcome (founder request
 * 2026-10-02). A pass reaches the company's people respectfully: "<Fund>
 * has decided not to proceed for now". The reason is added ONLY when the
 * investor ticked "share this reason with the founder" (founder decision
 * (a)); otherwise it stays the investor's private note and is never read
 * here. A pause and a resume are told the same plain way. Once per
 * happening (dedupe on the outbox event id), so redelivery tells nobody
 * twice. Diligence and progress are recorded by a person on either side
 * and need no notice of their own.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OutcomeNoticeOptions = {
  readonly registry: EventRegistry;
  readonly sql: DatabaseExecutor;
  readonly notices: Pick<CounterpartNotices, "notify">;
  readonly logger: RunnerLogger;
};

/** The words for the company's people. Pure, so they are tested as words. */
export function outcomeNotice(input: {
  readonly outcome: "PASSED" | "PAUSED" | "RESUMED";
  readonly investor: string;
  readonly sharedReason: {
    readonly label: string | null;
    readonly note: string | null;
  } | null;
}): { readonly title: string; readonly body: string | null } {
  switch (input.outcome) {
    case "PASSED": {
      const reason = input.sharedReason;
      const said =
        reason === null
          ? null
          : [
              reason.label === null ? null : `Their reason: ${reason.label}.`,
              reason.note === null ? null : `"${reason.note}"`,
            ]
              .filter((part): part is string => part !== null)
              .join(" ");
      return {
        title: `${input.investor} has decided not to proceed for now`,
        body:
          said === null || said === ""
            ? "Thank you for the time you gave them. Your conversation stays where it is."
            : said,
      };
    }
    case "PAUSED":
      return {
        title: `${input.investor} has paused for now`,
        body: "Nothing else changes; they can pick it up again.",
      };
    case "RESUMED":
      return {
        title: `${input.investor} has picked things up again`,
        body: null,
      };
  }
}

export function withOutcomeNotices(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: OutcomeNoticeOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (
      !parsed.ok ||
      parsed.message.type !== RelationshipOutcomeRecordedEvent.name
    ) {
      return inner(message);
    }
    const data = RelationshipOutcomeRecordedEvent.dataSchema.safeParse(
      parsed.message.data,
    );
    if (
      !data.success ||
      data.data.side !== "INVESTOR" ||
      !UUID.test(data.data.relationshipId) ||
      (data.data.outcome !== "PASSED" &&
        data.data.outcome !== "PAUSED" &&
        data.data.outcome !== "RESUMED")
    ) {
      return inner(message);
    }
    const event = data.data;
    const outcome = data.data.outcome;
    try {
      const investor = (
        await options.sql<{ name: string }[]>`
          select i.display_name as name
            from network.relationships r
            join core.investor_organisations i on i.id = r.investor_organisation_id
           where r.id = ${event.relationshipId}`
      )[0]?.name;
      // Only a shared reason is ever read for the founder.
      const shared =
        outcome === "PASSED" && event.passId !== undefined
          ? ((
              await options.sql<
                { label: string | null; note: string | null }[]
              >`
                select r.label, p.note
                  from network.relationship_passes p
                  left join network.relationship_pass_reasons r on r.code = p.reason_code
                 where p.id = ${event.passId}
                   and p.relationship_id = ${event.relationshipId}
                   and p.share_with_founder`
            )[0] ?? null)
          : null;
      if (investor !== undefined) {
        const words = outcomeNotice({
          outcome,
          investor,
          sharedReason: shared,
        });
        await options.notices.notify({
          relationshipId: event.relationshipId,
          actingSide: "INVESTOR",
          kind: "RELATIONSHIP_OUTCOME",
          title: words.title,
          body: words.body,
          target: "RELATIONSHIP",
          key: parsed.message.id,
          priority: "UPDATE",
        });
      }
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "outcome notice not written; retrying",
      );
      return { kind: "RETRY", errorCode: "OUTCOME_NOTICE_FAILED" };
    }
    return inner(message);
  };
}
