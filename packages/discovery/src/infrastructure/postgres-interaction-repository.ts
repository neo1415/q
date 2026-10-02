import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  INTERACTION_VERSION,
  InteractionEventSchema,
  InteractionStateSchema,
  type InteractionEvent,
  type InteractionState,
} from "../interactions/contracts.js";
import { strengthClassFor } from "../interactions/policy.js";
import type {
  InteractionRepository,
  NewInteractionEvent,
} from "../interactions/ports.js";

/**
 * `recommendation.interaction_events` and `interaction_state` behind the
 * interaction ports.
 *
 * Appending is one statement that either inserts or returns the row an
 * earlier identical report already created — the uniqueness is the database's
 * job, because a read-then-write would race two retries against each other.
 * Projection is one upsert whose guards live in SQL, so a save and an unsave
 * arriving together settle by sequence rather than by commit order.
 *
 * Nothing here joins a company, a mandate or a slate. Resolving what an
 * interaction was about happens before this is called, against the owning
 * contexts' ports.
 */

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp column");
};

const EventRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  investor_organisation_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_tenant_id: z.string().uuid(),
  interaction_type: z.string(),
  strength_class: z.string(),
  interaction_version: z.string(),
  surface: z.string(),
  slate_id: z.string().uuid().nullable(),
  slate_item_id: z.string().uuid().nullable(),
  position: z.number().int().nullable(),
  ranker_version: z.string().nullable(),
  ranking_config_version: z.string().nullable(),
  media_asset_id: z.string().uuid().nullable(),
  watch_milestone: z.string().nullable(),
  pass_reason: z.string().nullable(),
  client_event_id: z.string(),
  session_id: z.string().nullable(),
  occurred_at: z.unknown(),
  recorded_at: z.unknown(),
});

function toEvent(row: unknown): InteractionEvent {
  const parsed = EventRow.parse(row);
  return InteractionEventSchema.parse({
    id: parsed.id,
    tenantId: parsed.tenant_id,
    actorUserId: parsed.actor_user_id,
    investorOrganisationId: parsed.investor_organisation_id,
    companyId: parsed.company_id,
    companyTenantId: parsed.company_tenant_id,
    interactionType: parsed.interaction_type,
    strengthClass: parsed.strength_class,
    interactionVersion: parsed.interaction_version,
    surface: parsed.surface,
    exposure:
      parsed.slate_id === null ||
      parsed.slate_item_id === null ||
      parsed.position === null ||
      parsed.ranker_version === null ||
      parsed.ranking_config_version === null
        ? null
        : {
            slateId: parsed.slate_id,
            slateItemId: parsed.slate_item_id,
            position: parsed.position,
            rankerVersion: parsed.ranker_version,
            rankingConfigVersion: parsed.ranking_config_version,
          },
    mediaAssetId: parsed.media_asset_id,
    watchMilestone: parsed.watch_milestone,
    passReason: parsed.pass_reason,
    clientEventId: parsed.client_event_id,
    sessionId: parsed.session_id,
    occurredAt: iso(parsed.occurred_at),
    recordedAt: iso(parsed.recorded_at),
  });
}

const StateRow = z.object({
  company_id: z.string().uuid(),
  saved: z.boolean(),
  saved_at: z.unknown(),
  passed: z.boolean(),
  passed_at: z.unknown(),
  last_pass_reason: z.string().nullable(),
  impression_count: z.number().int(),
  last_impression_at: z.unknown(),
  last_interaction_at: z.unknown(),
});

function toState(row: unknown): InteractionState {
  const parsed = StateRow.parse(row);
  return InteractionStateSchema.parse({
    companyId: parsed.company_id,
    saved: parsed.saved,
    savedAt: iso(parsed.saved_at),
    passed: parsed.passed,
    passedAt: iso(parsed.passed_at),
    lastPassReason: parsed.last_pass_reason,
    impressionCount: parsed.impression_count,
    lastImpressionAt: iso(parsed.last_impression_at),
    lastInteractionAt: iso(parsed.last_interaction_at),
  });
}

/**
 * The row a retry-with-a-new-id collided with.
 *
 * Only impressions and milestones have a logical identity beyond the
 * client's id, and it is the same one the partial unique indexes use: one
 * impression per person, per slate, per company, per session; one milestone
 * per playback. A decision — save, pass — has no such key, because pressing
 * save twice in two sessions is two real decisions about the same state.
 */
async function logicalMatch(
  sql: DatabaseExecutor,
  event: NewInteractionEvent,
): Promise<readonly unknown[]> {
  if (event.sessionId === null) return [];
  if (event.interactionType === "IMPRESSION") {
    if (event.exposure === null) return [];
    return sql`
      select * from recommendation.interaction_events
       where interaction_type = 'IMPRESSION'
         and actor_user_id = ${event.actorUserId}
         and slate_id = ${event.exposure.slateId}
         and company_id = ${event.companyId}
         and session_id = ${event.sessionId}
       limit 1`;
  }
  if (event.interactionType === "WATCH_MILESTONE") {
    return sql`
      select * from recommendation.interaction_events
       where interaction_type = 'WATCH_MILESTONE'
         and actor_user_id = ${event.actorUserId}
         and media_asset_id = ${event.mediaAssetId}
         and watch_milestone = ${event.watchMilestone}
         and session_id = ${event.sessionId}
       limit 1`;
  }
  return [];
}

export function createPostgresInteractionRepository(options: {
  readonly sql: DatabaseExecutor;
}): InteractionRepository {
  const { sql } = options;

  return {
    append: async (event: NewInteractionEvent) => {
      const strengthClass = strengthClassFor(event.interactionType);
      const exposure = event.exposure;
      // `do nothing` with no conflict target, because there are two ways the
      // same logical interaction can arrive twice and both must be harmless:
      // the same client event id, and a retry that invented a fresh id for a
      // milestone or impression it already reported. `do update` would have
      // been one statement, and it touches the row, which the append-only
      // trigger correctly refuses.
      const inserted = await sql`
        insert into recommendation.interaction_events (
          tenant_id, actor_user_id, investor_organisation_id,
          company_id, company_tenant_id, interaction_type, strength_class,
          interaction_version, surface, slate_id, slate_item_id, position,
          ranker_version, ranking_config_version, media_asset_id,
          watch_milestone, pass_reason, client_event_id, session_id, occurred_at
        ) values (
          ${event.tenantId}, ${event.actorUserId}, ${event.investorOrganisationId},
          ${event.companyId}, ${event.companyTenantId}, ${event.interactionType},
          ${strengthClass}, ${INTERACTION_VERSION}, ${event.surface},
          ${exposure?.slateId ?? null}, ${exposure?.slateItemId ?? null},
          ${exposure?.position ?? null}, ${exposure?.rankerVersion ?? null},
          ${exposure?.rankingConfigVersion ?? null}, ${event.mediaAssetId},
          ${event.watchMilestone}, ${event.passReason}, ${event.clientEventId},
          ${event.sessionId}, ${event.occurredAt}
        )
        on conflict do nothing
        returning *`;
      const fresh = inserted[0];
      if (fresh !== undefined) {
        return { event: toEvent(fresh), deduplicated: false };
      }

      // Something already holds this interaction. The client's own id is the
      // usual reason; the logical keys are the other. A blocked insert waits
      // for the concurrent transaction to finish, so by here the winner is
      // committed and visible.
      const byClientId = await sql`
        select * from recommendation.interaction_events
         where tenant_id = ${event.tenantId}
           and actor_user_id = ${event.actorUserId}
           and client_event_id = ${event.clientEventId}
         limit 1`;
      const existing = byClientId[0] ?? (await logicalMatch(sql, event))[0];
      if (existing === undefined) {
        throw new Error("interaction insert did nothing and matched nothing");
      }
      return { event: toEvent(existing), deduplicated: true };
    },

    project: async (event: InteractionEvent) => {
      // Every guard is in SQL so two concurrent decisions settle by sequence
      // rather than by whichever transaction committed last. An older event
      // arriving late updates nothing it should not.
      const isImpression = event.interactionType === "IMPRESSION";
      const rows = await sql`
        insert into recommendation.interaction_state (
          tenant_id, investor_organisation_id, company_id, company_tenant_id,
          saved, saved_at, passed, passed_at, last_pass_reason,
          impression_count, last_impression_at, last_interaction_at,
          applied_sequence, updated_at
        ) values (
          ${event.tenantId}, ${event.investorOrganisationId}, ${event.companyId},
          ${event.companyTenantId},
          ${event.interactionType === "SAVE"},
          ${event.interactionType === "SAVE" ? event.occurredAt : null},
          ${event.interactionType === "PASS"},
          ${event.interactionType === "PASS" ? event.occurredAt : null},
          ${event.passReason},
          ${isImpression ? 1 : 0},
          ${isImpression ? event.occurredAt : null},
          ${event.occurredAt}, 1, now()
        )
        on conflict (tenant_id, investor_organisation_id, company_id) do update set
          saved = case
            when excluded.saved then true
            when ${event.interactionType === "UNSAVE"} then false
            else recommendation.interaction_state.saved end,
          saved_at = case
            when excluded.saved then excluded.saved_at
            when ${event.interactionType === "UNSAVE"} then null
            else recommendation.interaction_state.saved_at end,
          passed = case
            when excluded.passed then true
            when ${event.interactionType === "UNPASS"} then false
            else recommendation.interaction_state.passed end,
          passed_at = case
            when excluded.passed then excluded.passed_at
            when ${event.interactionType === "UNPASS"} then null
            else recommendation.interaction_state.passed_at end,
          last_pass_reason = case
            when excluded.passed then excluded.last_pass_reason
            when ${event.interactionType === "UNPASS"} then null
            else recommendation.interaction_state.last_pass_reason end,
          impression_count =
            recommendation.interaction_state.impression_count + excluded.impression_count,
          last_impression_at = greatest(
            recommendation.interaction_state.last_impression_at,
            excluded.last_impression_at),
          last_interaction_at = greatest(
            recommendation.interaction_state.last_interaction_at,
            excluded.last_interaction_at),
          applied_sequence = recommendation.interaction_state.applied_sequence + 1,
          updated_at = now()
        returning *`;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("interaction projection returned no row");
      }
      return toState(row);
    },

    stateForCompanies: async (query) => {
      if (query.companyIds.length === 0) return new Map();
      const rows = await sql`
        select *
          from recommendation.interaction_state
         where tenant_id = ${query.tenantId}
           and investor_organisation_id = ${query.investorOrganisationId}
           and company_id = any(${query.companyIds as string[]}::uuid[])`;
      const byCompany = new Map<string, InteractionState>();
      for (const row of rows) {
        const state = toState(row);
        byCompany.set(state.companyId, state);
      }
      return byCompany;
    },

    savedCompanyIds: async (query) => {
      const rows = await sql`
        select company_id
          from recommendation.interaction_state
         where tenant_id = ${query.tenantId}
           and investor_organisation_id = ${query.investorOrganisationId}
           and saved
         order by saved_at desc nulls last, company_id
         limit ${query.limit}`;
      return rows.map(
        (row) =>
          z.object({ company_id: z.string().uuid() }).parse(row).company_id,
      );
    },

    passedCompanyIds: async (query) => {
      const rows = await sql`
        select company_id
          from recommendation.interaction_state
         where tenant_id = ${query.tenantId}
           and investor_organisation_id = ${query.investorOrganisationId}
           and passed
         order by passed_at desc nulls last, company_id
         limit ${query.limit}`;
      return rows.map(
        (row) =>
          z.object({ company_id: z.string().uuid() }).parse(row).company_id,
      );
    },

    historyForCompany: async (query) => {
      const rows = await sql`
        select *
          from recommendation.interaction_events
         where tenant_id = ${query.tenantId}
           and investor_organisation_id = ${query.investorOrganisationId}
           and company_id = ${query.companyId}
         order by occurred_at desc, recorded_at desc
         limit ${query.limit}`;
      return rows.map(toEvent);
    },
  };
}

/** An investor's standing decision on one company, from the derived state. */
export type InvestorCompanyDecision = {
  readonly companyId: string;
  readonly decision: "SAVED" | "PASSED";
};

/**
 * What an investor organisation has saved and passed, by company identity,
 * newest first (CQ-QACT-001). Read from the same derived interaction state
 * the feed's pass suppression reads, so Q and the feed agree on what was
 * dismissed. A company both saved and later passed counts as passed.
 */
export function createPostgresInvestorDecisionReader(options: {
  readonly sql: DatabaseExecutor;
}): {
  readonly decided: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly limit: number;
  }) => Promise<readonly InvestorCompanyDecision[]>;
} {
  const { sql } = options;
  return {
    decided: async (query) => {
      const rows = await sql`
        select company_id, passed
          from recommendation.interaction_state
         where tenant_id = ${query.tenantId}
           and investor_organisation_id = ${query.investorOrganisationId}
           and (saved or passed)
         order by greatest(passed_at, saved_at) desc nulls last, company_id
         limit ${query.limit}`;
      return rows.map((row) => {
        const parsed = z
          .object({ company_id: z.string().uuid(), passed: z.boolean() })
          .parse(row);
        return {
          companyId: parsed.company_id,
          decision: parsed.passed ? ("PASSED" as const) : ("SAVED" as const),
        };
      });
    },
  };
}
