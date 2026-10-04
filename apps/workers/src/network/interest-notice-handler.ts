import type { EventRegistry } from "@capital-q/contracts";
import type { CounterpartNotices } from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  RelationshipInterestDeclinedEvent,
  RelationshipInterestExpressedEvent,
  RelationshipMatchedEvent,
} from "@capital-q/network/events";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * The receiving side hears about it (AUTO, 2026-10-02): an investor's
 * interest reaches the company's people, a founder's connection request
 * reaches the investor's, as a "Needs you" notice (and so a push). Whoever
 * expressed it -- in person or Q on their behalf -- is named. Once per
 * interest (dedupe), so redelivery tells nobody twice.
 *
 * Once it is answered (accepted, or declined), that notice is resolved --
 * marked read, never deleted (QA run 8a1d57b9: "New: Savanna is
 * interested... Open" stayed after the founder accepted). Idempotent.
 */

const ANSWERED: ReadonlySet<string> = new Set([
  RelationshipMatchedEvent.name,
  RelationshipInterestDeclinedEvent.name,
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InterestNoticeOptions = {
  readonly registry: EventRegistry;
  readonly sql: DatabaseExecutor;
  readonly notices: Pick<CounterpartNotices, "notify">;
  readonly logger: RunnerLogger;
};

export function withInterestNotices(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: InterestNoticeOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (parsed.ok && ANSWERED.has(parsed.message.type)) {
      const answered = parsed.message.data as { readonly interestId?: unknown };
      if (
        typeof answered.interestId === "string" &&
        UUID.test(answered.interestId)
      ) {
        try {
          await options.sql`
            update communication.notifications
               set read_at = clock_timestamp()
             where read_at is null
               and dedupe_key in (${`interest_received:${answered.interestId}`},
                                  ${`connection_requested:${answered.interestId}`})`;
        } catch (error: unknown) {
          options.logger.warn(
            { msgId: message.msgId, err: error },
            "answered interest notice not resolved; retrying",
          );
          return { kind: "RETRY", errorCode: "INTEREST_NOTICE_FAILED" };
        }
      }
      return inner(message);
    }
    if (
      !parsed.ok ||
      parsed.message.type !== RelationshipInterestExpressedEvent.name
    ) {
      return inner(message);
    }
    const data = parsed.message.data as {
      readonly relationshipId?: unknown;
      readonly interestId?: unknown;
    };
    if (
      typeof data.relationshipId !== "string" ||
      typeof data.interestId !== "string" ||
      !UUID.test(data.relationshipId) ||
      !UUID.test(data.interestId)
    ) {
      return inner(message);
    }
    try {
      const rows = await options.sql<
        { party: "INVESTOR" | "COMPANY"; company: string; investor: string }[]
      >`
        select n.expressed_by_party as party, c.canonical_name as company,
               i.display_name as investor
          from network.interests n
          join network.relationships r on r.id = n.relationship_id
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
         where n.id = ${data.interestId} and r.id = ${data.relationshipId}`;
      const row = rows[0];
      if (row !== undefined) {
        const investorActed = row.party === "INVESTOR";
        await options.notices.notify({
          relationshipId: data.relationshipId,
          actingSide: row.party,
          kind: investorActed ? "INTEREST_RECEIVED" : "CONNECTION_REQUESTED",
          title: investorActed
            ? `${row.investor} is interested in ${row.company}`
            : `${row.company} asked to connect with you`,
          body: investorActed
            ? "Interest is not a commitment to invest. Accept to start talking, or decline."
            : "Accept to start talking, or decline.",
          target: "INBOX",
          key: data.interestId,
          priority: "NEEDS_YOU",
        });
      }
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "interest notice not written; retrying",
      );
      return { kind: "RETRY", errorCode: "INTEREST_NOTICE_FAILED" };
    }
    return inner(message);
  };
}
