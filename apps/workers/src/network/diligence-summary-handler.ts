import type { EventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { DiligenceDocumentSummariser } from "@capital-q/model-gateway/q";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * Q reads what was shared in diligence (founder critique 2026-10-04: "Q is
 * even supposed to be able to read the content of whatever was uploaded so
 * it can easily tell the requester").
 *
 * Two happenings can complete the pair "shared in diligence" + "read by the
 * document pipeline", in either order:
 *   - `evidence.document.ready`: the version's text now exists (an upload
 *     shared at once is read a moment later);
 *   - `permissions.disclosure.granted` for a document: an already-read file
 *     was just shared.
 * Both carry identifiers only; everything else is re-read here, so a forged
 * or stale message can name a document but never reach one. Only a current,
 * processed, unblocked version with an unrevoked relationship share is read,
 * once per version (the summary table's key makes redelivery a no-op).
 *
 * The summariser sees that version's own passages and its title: nothing
 * else about the company, because the reader may open that file and no
 * more. A model failure is not retried here; the card simply shows the file
 * without Q's line.
 */

const READY_EVENT = "evidence.document.ready";
const GRANTED_EVENT = "permissions.disclosure.granted";
/** The version of the prompt family whose words are stored. */
const PROMPT_VERSION = 1;
/** Passages read: the top of a deck or a set of accounts. */
const PASSAGES_MAX = 40;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DiligenceSummaryChunks = {
  readonly listActiveByVersion: (
    executor: DatabaseExecutor,
    tenantId: string,
    documentVersionId: string,
  ) => Promise<
    readonly {
      readonly content: string;
      readonly chunkIndex: number;
      readonly locator: {
        readonly pageEnd?: number | undefined;
        readonly pageStart?: number | undefined;
        readonly slide?: number | undefined;
      };
    }[]
  >;
};

export type DiligenceSummaryOptions = {
  readonly registry: EventRegistry;
  readonly sql: DatabaseExecutor;
  readonly summariser: DiligenceDocumentSummariser;
  readonly chunks: DiligenceSummaryChunks;
  readonly logger: RunnerLogger;
};

/** Which document a message names, if it is one this handler reads. */
export function diligenceDocumentOf(
  type: string,
  data: unknown,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const fields = data as Record<string, unknown>;
  if (type === READY_EVENT) {
    const id = fields["documentId"];
    return typeof id === "string" && UUID.test(id) ? id : null;
  }
  if (
    type === GRANTED_EVENT &&
    fields["resourceType"] === "document" &&
    fields["scopeType"] === "relationship_shared"
  ) {
    const id = fields["resourceId"];
    return typeof id === "string" && UUID.test(id) ? id : null;
  }
  return null;
}

/** Pages or slides the passages reach, when the reader recorded them. */
export function pagesOf(
  chunks: readonly {
    readonly locator: {
      readonly pageEnd?: number | undefined;
      readonly pageStart?: number | undefined;
      readonly slide?: number | undefined;
    };
  }[],
): number | null {
  let most = 0;
  for (const { locator } of chunks) {
    most = Math.max(
      most,
      locator.slide ?? 0,
      locator.pageEnd ?? 0,
      locator.pageStart ?? 0,
    );
  }
  return most === 0 ? null : most;
}

export function withDiligenceSummaries(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: DiligenceSummaryOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (!parsed.ok) return inner(message);
    const documentId = diligenceDocumentOf(
      parsed.message.type,
      parsed.message.data,
    );
    if (documentId === null) return inner(message);
    try {
      const target = (
        await options.sql<
          {
            tenant_id: string;
            title: string;
            version_id: string;
          }[]
        >`
          select d.tenant_id, d.title, v.id as version_id
            from evidence.documents d
            join evidence.document_versions v
              on v.id = d.current_version_id and v.tenant_id = d.tenant_id
           where d.id = ${documentId}
             and v.processing_status = 'COMPLETED'
             and v.malware_scan_status <> 'BLOCKED'
             and exists (
               select 1 from permissions.disclosure_policies p
                where p.resource_type = 'document'
                  and p.resource_id = d.id
                  and p.scope_type = 'relationship_shared'
                  and p.recipient_type = 'RELATIONSHIP'
                  and p.revoked_at is null)
             and not exists (
               select 1 from network.diligence_document_summaries s
                where s.document_version_id = v.id)`
      )[0];
      if (target !== undefined) {
        const passages = (
          await options.chunks.listActiveByVersion(
            options.sql,
            target.tenant_id,
            target.version_id,
          )
        )
          .toSorted((a, b) => a.chunkIndex - b.chunkIndex)
          .slice(0, PASSAGES_MAX);
        const summary =
          passages.length === 0
            ? null
            : await options.summariser.summarise({
                title: target.title,
                pages: pagesOf(passages),
                passages: passages.map((passage) => passage.content),
                attribution: {
                  tenantId: target.tenant_id,
                  correlationId: `cor_diligence_${parsed.message.id}`.slice(
                    0,
                    128,
                  ),
                },
              });
        if (summary !== null) {
          await options.sql`
            insert into network.diligence_document_summaries
              (document_version_id, tenant_id, document_id, summary, prompt_version)
            values (${target.version_id}, ${target.tenant_id}, ${documentId},
                    ${summary}, ${PROMPT_VERSION})
            on conflict (document_version_id) do nothing`;
          options.logger.info(
            { msgId: message.msgId, documentVersionId: target.version_id },
            "Q summarised a document shared in diligence",
          );
        }
      }
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, err: error },
        "diligence summary not written; retrying",
      );
      return { kind: "RETRY", errorCode: "DILIGENCE_SUMMARY_FAILED" };
    }
    return inner(message);
  };
}
