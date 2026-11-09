import {
  CorrelationIdSchema,
  QConversationIdSchema,
  QScreenRouteSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { CreateQRunCommand } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * D82 (owner live 2026-11-09; approved): a turn about a file that was
 * still being read was answered "I'm reading it now". When that file
 * finishes reading (the workers announce `evidence.document.ready` with its
 * id), Q answers that turn properly, as a new Q message in the same
 * conversation.
 *
 * - Which turns: a completed run of the last hour whose own read of that
 *   document (q_runtime.conversation_tool_results, the run's kept read)
 *   came back READING, and whose person has not asked anything since.
 * - As whom: the run's own person, resolved afresh (a suspended or removed
 *   person is not acted for), in their own conversation; the answer runs
 *   through the same engine and Context Firewall as any turn. No new
 *   authority: the run is Q-opened and quiet (no line of its own), so the
 *   question it answers is the person's own last turn.
 * - Once: the run's idempotency key is (turn, document), so a redelivered
 *   or repeated wake starts nothing new.
 *
 * Known limit (accepted by integration, 2026-11-09): a wake that lands
 * while the READING turn's run is still finishing (not yet COMPLETED)
 * finds no waiting turn, and that turn gets no follow-up. There is no
 * sweep (no polling, by decision); the person can ask again.
 */

/** How long after a turn its file finishing still answers it. */
export const FOLLOW_UP_WINDOW_MINUTES = 60;

export type DocumentReadyFollowUpDependencies = {
  readonly sql: DatabaseExecutor;
  /** The person, resolved afresh from their user and organisation ids. */
  readonly actorFor: (
    userId: string,
    organisationId: string | null,
  ) => Promise<ActorContext | null>;
  /** The runtime's createRun (idempotent per person and key). */
  readonly createRun: (
    command: CreateQRunCommand & { readonly quiet: true },
  ) => Promise<{
    readonly created: boolean;
    readonly run: {
      readonly id: string;
      readonly conversationId?: string | null | undefined;
    };
  }>;
  /** Starts the engine on a created run (as q-runs.ts does). */
  readonly start: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    readonly conversationId: string | null;
    readonly correlationId: CorrelationId;
  }) => void;
  readonly logger?: Logger | undefined;
  readonly newCorrelationId?: (() => CorrelationId) | undefined;
};

type Waiting = {
  readonly run_id: string;
  readonly user_id: string;
  readonly conversation_id: string;
  readonly actor_organisation_id: string | null;
  readonly screen: unknown;
};

export function createDocumentReadyFollowUp(
  dependencies: DocumentReadyFollowUpDependencies,
) {
  const { sql, logger } = dependencies;
  const correlation =
    dependencies.newCorrelationId ??
    (() => CorrelationIdSchema.parse(`cor_${crypto.randomUUID()}`));
  return {
    /** Answers every turn waiting on this document; how many were started. */
    onDocumentReady: async (documentId: string): Promise<number> => {
      const waiting = await sql<Waiting[]>`
        select distinct on (t.run_id)
               t.run_id, t.user_id, t.conversation_id,
               r.actor_organisation_id, r.screen
          from q_runtime.conversation_tool_results t
          join q_runtime.runs r
            on r.id = t.run_id and r.tenant_id = t.tenant_id
           and r.actor_user_id = t.user_id
         where t.tool_name = 'documents.attached.read'
           and t.result ->> 'status' = 'READING'
           and lower(t.result ->> 'documentId') = lower(${documentId})
           and t.created_at > now() - make_interval(mins => ${FOLLOW_UP_WINDOW_MINUTES})
           and r.status = 'COMPLETED'
           and not exists (
             select 1
               from q_runtime.conversation_messages later
              where later.tenant_id = t.tenant_id
                and later.conversation_id = t.conversation_id
                and later.role = 'USER'
                and later.run_id <> t.run_id
                and later.created_at > t.created_at)
         order by t.run_id, t.created_at`;
      let started = 0;
      for (const turn of waiting) {
        try {
          const actor = await dependencies.actorFor(
            turn.user_id,
            turn.actor_organisation_id,
          );
          if (actor === null) continue;
          // The page they were on, only: the rest of the old screen is not
          // re-asserted for a later turn.
          const route = QScreenRouteSchema.safeParse(
            typeof turn.screen === "object" && turn.screen !== null
              ? Reflect.get(turn.screen, "route")
              : undefined,
          );
          const correlationId = correlation();
          const result = await dependencies.createRun({
            actor,
            input: {
              capability: "ANSWER",
              // Quiet: never stored or shown. The engine answers the
              // person's own last turn in this conversation.
              message: { text: "The document they attached is now read." },
              modality: "TEXT",
              conversationId: QConversationIdSchema.parse(turn.conversation_id),
              screen: {
                route: route.success ? route.data : "HOME",
                attachedDocumentIds: [documentId.toLowerCase()],
              },
            },
            idempotencyKey: `doc-ready:${turn.run_id}:${documentId.toLowerCase()}`,
            correlationId,
            openedBy: "Q",
            quiet: true,
          });
          if (!result.created) continue;
          dependencies.start({
            actor,
            runId: result.run.id,
            conversationId: result.run.conversationId ?? null,
            correlationId,
          });
          started += 1;
          logger?.info(
            { qRunId: result.run.id, answeredRun: turn.run_id },
            "q answered a turn once its document was read",
          );
        } catch (error: unknown) {
          logger?.warn(
            { err: error, answeredRun: turn.run_id },
            "a document-ready follow-up was not started",
          );
        }
      }
      return started;
    },
  };
}
