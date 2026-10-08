# Excerpt: packages/eventing/src/publisher/outbox-publisher.ts lines 1-230

- Original path: `packages/eventing/src/publisher/outbox-publisher.ts`
- Line range: 1-230
- Why included: Outbox publisher: rows whose payload fails registry.parse are retried and then left stuck with EVENT_SCHEMA_INVALID.

```
    1  import { z } from "zod";
    2  
    3  import type { EventRegistry } from "@capital-q/contracts";
    4  import type {
    5    TransactionContext,
    6    TransactionManager,
    7  } from "@capital-q/database";
    8  
    9  import type { EventDispatcher } from "./dispatcher.js";
   10  import {
   11    createOutboxRetryPolicy,
   12    type OutboxRetryPolicy,
   13  } from "./retry-policy.js";
   14  
   15  /**
   16   * Moves pending outbox rows onto the queue.
   17   *
   18   * One short transaction per batch:
   19   *
   20   *   claim   SELECT ... WHERE published_at IS NULL AND available_at <= now()
   21   *           AND attempt_count < max ORDER BY id FOR UPDATE SKIP LOCKED LIMIT n
   22   *   each    validate payload through the canonical registry
   23   *           → dispatcher.publish inside a savepoint
   24   *           → published_at, or attempt_count + backoff + bounded last_error
   25   *   commit
   26   *
   27   * SKIP LOCKED lets several publisher instances run against one table without
   28   * ever claiming the same row, and because pgmq lives in the same database the
   29   * send and the published_at mark are one atomic step: there is no window in
   30   * which the queue has the message but the row still looks pending. None of
   31   * this makes consumers exactly-once; a consumer still dedupes by EventId.
   32   *
   33   * No external call happens while the claim transaction is open. If the
   34   * dispatcher ever targets a broker outside this database, this publisher
   35   * needs leases and a different commit order -- do not paper over that.
   36   */
   37  
   38  export const OUTBOX_DEFAULT_BATCH_SIZE = 25;
   39  export const OUTBOX_MAX_BATCH_SIZE = 100;
   40  
   41  export type OutboxPublishOutcome = "PUBLISHED" | "FAILED" | "INVALID";
   42  
   43  /** Safe to log: identifiers and counters, never payload. */
   44  export type OutboxPublishRecord = {
   45    readonly eventId: string;
   46    readonly eventType: string;
   47    readonly eventVersion: number;
   48    readonly tenantId: string | null;
   49    readonly attempt: number;
   50    readonly outcome: OutboxPublishOutcome;
   51    readonly exhausted: boolean;
   52    readonly error: string | undefined;
   53    readonly durationMs: number;
   54  };
   55  
   56  export type PublishBatchResult = {
   57    readonly claimed: number;
   58    readonly published: number;
   59    readonly failed: number;
   60    readonly exhausted: number;
   61    readonly records: readonly OutboxPublishRecord[];
   62  };
   63  
   64  export type OutboxPublisher = {
   65    readonly publishAvailable: (options?: {
   66      readonly limit?: number | undefined;
   67    }) => Promise<PublishBatchResult>;
   68  };
   69  
   70  export type OutboxPublisherOptions = {
   71    readonly transactions: TransactionManager;
   72    readonly registry: EventRegistry;
   73    readonly dispatcher: EventDispatcher;
   74    readonly retryPolicy?: OutboxRetryPolicy | undefined;
   75  };
   76  
   77  const ClaimedRowSchema = z.object({
   78    id: z.coerce.number().int(),
   79    event_id: z.string(),
   80    tenant_id: z.string().nullable(),
   81    event_type: z.string(),
   82    event_version: z.number().int(),
   83    attempt_count: z.number().int(),
   84    payload: z.unknown(),
   85  });
   86  type ClaimedRow = z.infer<typeof ClaimedRowSchema>;
   87  
   88  const LAST_ERROR_MAX = 500;
   89  
   90  /**
   91   * A bounded failure description. Codes are fixed; the detail is a short
   92   * classification, never a driver message (which can embed SQL or values).
   93   */
   94  function safeError(code: string, detail: string | undefined): string {
   95    const text = detail === undefined ? code : `${code}: ${detail}`;
   96    return text.length > LAST_ERROR_MAX ? text.slice(0, LAST_ERROR_MAX) : text;
   97  }
   98  
   99  function classifyDispatchFailure(error: unknown): string {
  100    if (typeof error === "object" && error !== null && "code" in error) {
  101      const { code } = error;
  102      if (typeof code === "string") {
  103        return `sqlstate ${code}`;
  104      }
  105    }
  106    return error instanceof Error ? error.name : "unknown";
  107  }
  108  
  109  export function createOutboxPublisher(
  110    options: OutboxPublisherOptions,
  111  ): OutboxPublisher {
  112    const { transactions, registry, dispatcher } = options;
  113    const policy = options.retryPolicy ?? createOutboxRetryPolicy();
  114  
  115    async function markPublished(tx: TransactionContext, row: ClaimedRow) {
  116      await tx.sql`
  117        update events.outbox
  118           set published_at = now(),
  119               attempt_count = attempt_count + 1,
  120               last_error = null
  121         where id = ${row.id}`;
  122    }
  123  
  124    async function recordFailure(
  125      tx: TransactionContext,
  126      row: ClaimedRow,
  127      error: string,
  128    ): Promise<{ attempt: number; exhausted: boolean }> {
  129      const attempt = row.attempt_count + 1;
  130      const backoff = policy.backoffSeconds(attempt);
  131      await tx.sql`
  132        update events.outbox
  133           set attempt_count = ${attempt},
  134               last_error = ${error},
  135               available_at = now() + make_interval(secs => ${backoff})
  136         where id = ${row.id}`;
  137      return { attempt, exhausted: attempt >= policy.maxAttempts };
  138    }
  139  
  140    return {
  141      publishAvailable: async (publishOptions = {}) => {
  142        const limit = Math.min(
  143          Math.max(1, publishOptions.limit ?? OUTBOX_DEFAULT_BATCH_SIZE),
  144          OUTBOX_MAX_BATCH_SIZE,
  145        );
  146  
  147        return transactions.run(async (tx) => {
  148          const rawRows = await tx.sql`
  149            select o.id, o.event_id, o.tenant_id, o.event_type, o.event_version,
  150                   o.attempt_count, o.payload
  151              from events.outbox o
  152             where o.published_at is null
  153               and o.available_at <= now()
  154               and o.attempt_count < ${policy.maxAttempts}
  155             order by o.id
  156             for update skip locked
  157             limit ${limit}`;
  158  
  159          const records: OutboxPublishRecord[] = [];
  160  
  161          for (const raw of rawRows) {
  162            const started = Date.now();
  163            const row = ClaimedRowSchema.parse(raw);
  164            const base = {
  165              eventId: row.event_id,
  166              eventType: row.event_type,
  167              eventVersion: row.event_version,
  168              tenantId: row.tenant_id,
  169            };
  170  
  171            // A row that no longer validates against the supported registry is
  172            // a contract defect, not something to guess at. It follows the
  173            // same bounded retry path and then stays visible as stuck work.
  174            const parsed = registry.parse(row.payload);
  175            if (!parsed.ok) {
  176              const failure = await recordFailure(
  177                tx,
  178                row,
  179                safeError("EVENT_SCHEMA_INVALID", parsed.rejection),
  180              );
  181              records.push({
  182                ...base,
  183                ...failure,
  184                outcome: "INVALID",
  185                error: parsed.rejection,
  186                durationMs: Date.now() - started,
  187              });
  188              continue;
  189            }
  190  
  191            // The savepoint confines a failed send to its own row: the batch
  192            // transaction stays usable to record the failure and go on.
  193            try {
  194              await tx.sql.savepoint((inner) =>
  195                dispatcher.publish({ sql: inner }, parsed.message),
  196              );
  197            } catch (error) {
  198              const detail = classifyDispatchFailure(error);
  199              const failure = await recordFailure(
  200                tx,
  201                row,
  202                safeError("QUEUE_PUBLISH_FAILED", detail),
  203              );
  204              records.push({
  205                ...base,
  206                ...failure,
  207                outcome: "FAILED",
  208                error: detail,
  209                durationMs: Date.now() - started,
  210              });
  211              continue;
  212            }
  213  
  214            await markPublished(tx, row);
  215            records.push({
  216              ...base,
  217              attempt: row.attempt_count + 1,
  218              exhausted: false,
  219              outcome: "PUBLISHED",
  220              error: undefined,
  221              durationMs: Date.now() - started,
  222            });
  223          }
  224  
  225          return {
  226            claimed: records.length,
  227            published: records.filter((r) => r.outcome === "PUBLISHED").length,
  228            failed: records.filter((r) => r.outcome !== "PUBLISHED").length,
  229            exhausted: records.filter((r) => r.exhausted).length,
  230            records,
```

# Excerpt: apps/workers/src/event-registry.ts lines 1-60

- Original path: `apps/workers/src/event-registry.ts`
- Line range: 1-60
- Why included: The workers' event registry. It does not include the q-actions event set, so every q.action.* outbox row fails validation.

```
    1  import { createEventRegistry, type EventRegistry } from "@capital-q/contracts";
    2  import { CAPITAL_EVENTS } from "@capital-q/capital/events";
    3  import { COMPANY_EVENTS } from "@capital-q/companies/events";
    4  import { EVIDENCE_EVENTS } from "@capital-q/evidence/events";
    5  import { INTEGRATIONS_EVENTS } from "@capital-q/integrations/events";
    6  import { INVESTOR_EVENTS } from "@capital-q/investors/events";
    7  import { MEDIA_EVENTS } from "@capital-q/media/events";
    8  import { NETWORK_EVENTS } from "@capital-q/network/events";
    9  import { ONBOARDING_EVENTS } from "@capital-q/onboarding/events";
   10  import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";
   11  import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
   12  import { TAXONOMY_EVENTS } from "@capital-q/taxonomy/events";
   13  import { VERIFICATION_EVENTS } from "@capital-q/verification/events";
   14  
   15  /**
   16   * The production event registry the worker validates outbox rows against.
   17   *
   18   * Each domain packet adds its definitions here as they land; the API keeps
   19   * an identical list for its OutboxWriter (apps/api/src/event-registry.ts).
   20   * Test-only definitions (test.fixture.*) never appear in this list.
   21   */
   22  export function createProductionEventRegistry(): EventRegistry {
   23    return createEventRegistry([
   24      ...ORGANISATION_EVENTS,
   25      ...COMPANY_EVENTS,
   26      ...INVESTOR_EVENTS,
   27      ...EVIDENCE_EVENTS,
   28      ...CAPITAL_EVENTS,
   29      ...NETWORK_EVENTS,
   30      ...PERMISSIONS_EVENTS,
   31      ...TAXONOMY_EVENTS,
   32      ...ONBOARDING_EVENTS,
   33      ...MEDIA_EVENTS,
   34      ...VERIFICATION_EVENTS,
   35      ...INTEGRATIONS_EVENTS,
   36    ]);
   37  }
```

# Excerpt: packages/q-actions/src/events/index.ts lines 1-75

- Original path: `packages/q-actions/src/events/index.ts`
- Line range: 1-75
- Why included: The q.action.* event definitions written to the outbox by q-api (never registered in the workers' publisher).

```
    1  import { randomUUID } from "node:crypto";
    2  
    3  import { z } from "zod";
    4  
    5  import {
    6    defineEvent,
    7    EventIdSchema,
    8    QActionClassSchema,
    9    QActionStatusSchema,
   10    QActionTypeSchema,
   11    QActionVersionSchema,
   12    UtcTimestampSchema,
   13    UuidSchema,
   14    type CapitalQEvent,
   15    type CorrelationId,
   16    type EventDefinition,
   17  } from "@capital-q/contracts";
   18  
   19  /**
   20   * Canonical Q action integration events (doc 22 §94-§95 naming; CQ-Q-008
   21   * §80-§81). Owner: the Approval Engine. CONFIDENTIAL: the existence of a
   22   * prepared consequential action is company- or investor-private.
   23   * REPLAY_SAFE: consumers re-read the action under their own authority.
   24   *
   25   * Payloads carry identifiers, type, version, class and status only —
   26   * never the proposed payload, the targets' content, the approver's
   27   * reasoning or the fingerprint. These are domain events: distinct from the
   28   * run's `q.approval.required` stream event and from the material-action
   29   * audit record, which serve different purposes and are never collapsed.
   30   */
   31  
   32  export const Q_ACTION_EVENT_OWNER = "@capital-q/q-actions" as const;
   33  export const Q_ACTION_EVENT_PRODUCER = "capitalq://q-api/q/actions" as const;
   34  
   35  const CONSUMERS = ["@capital-q/q", "@capital-q/intelligence"];
   36  
   37  const base = {
   38    actionId: UuidSchema,
   39    runId: UuidSchema,
   40    actionType: QActionTypeSchema,
   41    actionVersion: QActionVersionSchema,
   42    riskClass: QActionClassSchema,
   43    actionStatus: QActionStatusSchema,
   44  };
   45  
   46  export const QActionPreparedEvent = defineEvent({
   47    name: "q.action.prepared",
   48    version: 1,
   49    owner: Q_ACTION_EVENT_OWNER,
   50    producer: Q_ACTION_EVENT_PRODUCER,
   51    consumers: CONSUMERS,
   52    sensitivity: "CONFIDENTIAL",
   53    replaySafety: "REPLAY_SAFE",
   54    dataSchema: z.object({ ...base, approvalId: UuidSchema }).strict(),
   55    description:
   56      "Q proposed a consequential action and an approval was requested from a person. Nothing has executed.",
   57  });
   58  
   59  export const QActionApprovedEvent = defineEvent({
   60    name: "q.action.approved",
   61    version: 1,
   62    owner: Q_ACTION_EVENT_OWNER,
   63    producer: Q_ACTION_EVENT_PRODUCER,
   64    consumers: CONSUMERS,
   65    sensitivity: "CONFIDENTIAL",
   66    replaySafety: "REPLAY_SAFE",
   67    dataSchema: z.object({ ...base, approvalId: UuidSchema }).strict(),
   68    description:
   69      "A person approved the exact proposed action. Approval is not execution; nothing has executed yet.",
   70  });
   71  
   72  export const QActionRejectedEvent = defineEvent({
   73    name: "q.action.rejected",
   74    version: 1,
   75    owner: Q_ACTION_EVENT_OWNER,
```

