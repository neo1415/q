import { cachedInRun, type DatabaseExecutor } from "@capital-q/database";
import type { InterestService } from "@capital-q/network";
import type { DiligenceService } from "@capital-q/permissions";
import type { QRuntimeRepositories } from "@capital-q/q-runtime";

/**
 * R5: the run's own messages and latest stage, read once per run
 * (`cachedInRun`). The conversation history readers share one read in the
 * repository itself (`runCacheRoot`).
 *
 * Only reads on the request client itself are cached: a read inside a
 * transaction (where it may hold a lock or must see that transaction's own
 * writes) always goes to the database. Ownership and access reads — the
 * run and conversation lookups that decide whether the person may see
 * them — are not wrapped, so they stay fresh every time. A write this run
 * sends to any table an entry read drops that entry.
 */

const MESSAGE_TABLES = [
  "q_runtime.conversation_messages",
  "q_runtime.conversation_message_marks",
  // Superseded runs' lines are left out of the history read.
  "q_runtime.runs",
] as const;
const EVENT_TABLES = ["q_runtime.run_events"] as const;

export function withRunReadCache(
  repositories: QRuntimeRepositories,
  root: DatabaseExecutor,
): QRuntimeRepositories {
  const { messages, runEvents } = repositories;
  return {
    ...repositories,
    messages: {
      ...messages,
      listForRun: (executor, tenantId, runId, limit) => {
        const read = () =>
          messages.listForRun(executor, tenantId, runId, limit);
        return executor !== root
          ? read()
          : cachedInRun(
              {
                aggregate: "run-messages",
                tables: MESSAGE_TABLES,
                actor: tenantId,
                fingerprint: JSON.stringify([runId, limit]),
              },
              read,
            );
      },
    },
    runEvents: {
      ...runEvents,
      latestVisibleStage: (executor, tenantId, runId) => {
        const read = () =>
          runEvents.latestVisibleStage(executor, tenantId, runId);
        return executor !== root
          ? read()
          : cachedInRun(
              {
                aggregate: "run-stage",
                tables: EVENT_TABLES,
                actor: tenantId,
                fingerprint: runId,
              },
              read,
            );
      },
    },
  };
}

/**
 * S2: the actor's own relationship list, read once per run. One turn asks
 * for it from the standing tool, the brief, the diligence read, the
 * commitments read and the app-action reads (up to six times), each a
 * visibility check, a company read and a history read per relationship.
 * The key carries the full actor (tenant, user, organisation, membership),
 * so another person never reaches the entry; it lives and dies with the
 * run's counter; a write this run sends to any of the tables drops it.
 */
const RELATIONSHIP_LIST_TABLES = [
  "network.relationships",
  "network.relationship_events",
  "core.companies",
  "core.investor_organisations",
  "permissions.disclosure_policies",
] as const;

export function withRunCachedRelationshipLists(
  service: InterestService,
): InterestService {
  const who = (actor: {
    readonly tenantId: string;
    readonly userId: string;
    readonly organisationId?: string | undefined;
    readonly membershipId?: string | undefined;
  }) =>
    [
      actor.tenantId,
      actor.userId,
      actor.organisationId ?? "",
      actor.membershipId ?? "",
    ].join("/");
  const forInvestor: InterestService["listRelationshipsForInvestor"] = (
    query,
  ) =>
    cachedInRun(
      {
        aggregate: "relationships-investor",
        tables: RELATIONSHIP_LIST_TABLES,
        actor: who(query.actor),
        fingerprint: "",
      },
      () => service.listRelationshipsForInvestor(query),
    );
  const forCompany: InterestService["listRelationshipsForCompany"] = (query) =>
    cachedInRun(
      {
        aggregate: "relationships-company",
        tables: RELATIONSHIP_LIST_TABLES,
        actor: who(query.actor),
        fingerprint: query.companyId,
      },
      () => service.listRelationshipsForCompany(query),
    );
  const briefs = service.relationshipBriefs;
  return {
    ...service,
    // Speed lane 2026-10-20: the briefs read the same list (the same
    // service read, so the same authorisation) from this run's entry, not
    // a second time (a cold arrival snapshot listed twice: once for the
    // attention report, once for the briefs). A caller's own list wins.
    ...(briefs === undefined
      ? {}
      : {
          relationshipBriefs: (query: Parameters<typeof briefs>[0]) =>
            briefs({
              ...query,
              listings:
                query.listings ??
                (() =>
                  query.companyId === undefined
                    ? forInvestor({ actor: query.actor })
                    : forCompany({
                        actor: query.actor,
                        companyId: query.companyId,
                      })),
            }),
        }),
    listRelationshipsForInvestor: forInvestor,
    listRelationshipsForCompany: forCompany,
  };
}

/**
 * S5 (lane S, live 2026-10-15: one get_relationship took 55 round trips):
 * a relationship's diligence view, read once per run or request. The
 * relationship tool reads it for its own area and again through the
 * Relationship Brief, and the arrival snapshot reads it from the
 * attention report and the briefs. The key carries the full actor and
 * the relationship, so another person or relationship never reaches the
 * entry; a write this run sends to any of the tables drops it.
 */
const DILIGENCE_VIEW_TABLES = [
  "network.relationships",
  "network.diligence_requests",
  "network.diligence_fulfilments",
  "network.diligence_request_declines",
  "network.diligence_document_views",
  "network.diligence_document_summaries",
  "network.diligence_questions",
  "network.diligence_question_answers",
  "permissions.disclosure_policies",
  "evidence.documents",
  "evidence.document_versions",
] as const;

export function withRunCachedDiligenceViews(
  service: DiligenceService,
): DiligenceService {
  return {
    ...service,
    view: (query) =>
      cachedInRun(
        {
          aggregate: "diligence-view",
          tables: DILIGENCE_VIEW_TABLES,
          actor: [
            query.actor.tenantId,
            query.actor.userId,
            query.actor.organisationId ?? "",
            query.actor.membershipId ?? "",
          ].join("/"),
          fingerprint: query.relationshipId,
        },
        () => service.view(query),
      ),
  };
}
