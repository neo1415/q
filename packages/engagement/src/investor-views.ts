import { z } from "zod";

import {
  ENGAGEMENT_VERSION,
  InvestorViewingDtoSchema,
  type InvestorViewingDto,
  type RecordInvestorViewRequest,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { AppendOutcome } from "./postgres-engagement-repository.js";
import { viewerFrom } from "./service.js";

/**
 * Who viewed an investor (owner live test 7 Nov 2026; design and root
 * cause: docs/specs/q-workspace/ANALYTICS_INVESTOR_VIEWERS.md).
 *
 * Recording: a founder's view of an investor's profile is kept only after
 * the founder's own authorised investor read says they may see that
 * investor (`mayViewInvestor`, ADR 0023); the insert itself refuses the
 * investor's own team. The caller learns nothing: a refusal and a duplicate
 * look the same.
 *
 * Reading: the signed-in person's OWN investor firm only, resolved here
 * from their active membership (never a parameter), as aggregates decided
 * in SQL (analytics.investor_viewing_*: completed batches, the floors,
 * complementary suppression). No identity leaves the database.
 */

export type InvestorViews = {
  readonly record: (
    actor: ActorContext,
    view: RecordInvestorViewRequest,
  ) => Promise<AppendOutcome>;
  /** Null when the person is not an active member of an investor firm. */
  readonly mine: (query: {
    readonly actorUserId: string;
    readonly organisationId: string | null;
    readonly since: string | null;
  }) => Promise<InvestorViewingDto | null>;
};

const num = z.coerce.number().int();
const day = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  throw new TypeError("expected a date");
};

export function createInvestorViews(dependencies: {
  readonly sql: DatabaseExecutor;
  /** The founder's own authorised read of the investor (discovery). */
  readonly mayViewInvestor: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<boolean>;
}): InvestorViews {
  const { sql } = dependencies;
  return {
    record: async (actor, view) => {
      const viewer = viewerFrom(actor);
      if (viewer === null) return "DROPPED";
      const visible = await dependencies
        .mayViewInvestor(actor, view.investorOrganisationId)
        .catch(() => false);
      if (!visible) return "DROPPED";
      const rows = await sql<{ id: string }[]>`
        insert into analytics.investor_profile_views
          (tenant_id, viewer_user_id, viewer_organisation_id, investor_organisation_id,
           investor_tenant_id, view_type, engagement_version, visibility_at_view,
           client_event_id, session_id, occurred_at)
        select ${viewer.tenantId}::uuid, ${viewer.userId}::uuid, ${viewer.organisationId}::uuid,
               io.id, io.tenant_id, 'INVESTOR_PROFILE_VIEW', ${ENGAGEMENT_VERSION},
               -- Replaced by the stamp trigger; never the caller's.
               'ANONYMOUS',
               ${view.clientEventId}, ${view.sessionId ?? null},
               least(${view.occurredAt}::timestamptz, now())
          from core.investor_organisations io
         where io.id = ${view.investorOrganisationId}::uuid
           and io.organisation_id <> ${viewer.organisationId}::uuid
        on conflict (tenant_id, viewer_user_id, client_event_id) do nothing
        returning id`;
      if (rows.length === 1) return "ACCEPTED";
      const existing = await sql<{ id: string }[]>`
        select id from analytics.investor_profile_views
         where tenant_id = ${viewer.tenantId}::uuid
           and viewer_user_id = ${viewer.userId}::uuid
           and client_event_id = ${view.clientEventId}`;
      return existing.length === 1 ? "DEDUPLICATED" : "DROPPED";
    },

    mine: async ({ actorUserId, organisationId, since }) => {
      if (organisationId === null) return null;
      const [firm] = await sql<
        {
          id: string;
          floor: number;
          slice_floor: number;
          batch: string;
        }[]
      >`
        select io.id, analytics.engagement_floor() as floor,
               analytics.slice_floor() as slice_floor,
               (analytics.settings()).passive_batch as batch
          from core.investor_organisations io
         where io.organisation_id = ${organisationId}::uuid
           and analytics.may_read_investor_views(${actorUserId}::uuid, io.id)`;
      if (firm === undefined) return null;
      const [periods, slices] = await Promise.all([
        sql`select * from analytics.investor_viewing_periods(${actorUserId}::uuid, ${firm.id}::uuid, ${since}::timestamptz)`,
        sql`select * from analytics.investor_viewing_slices(${actorUserId}::uuid, ${firm.id}::uuid, ${since}::timestamptz)`,
      ]);
      return InvestorViewingDtoSchema.parse({
        investorOrganisationId: firm.id,
        since,
        floorMet: periods.length > 0,
        floor: num.parse(firm.floor),
        sliceFloor: num.parse(firm.slice_floor),
        passiveBatch: firm.batch,
        periods: periods.map((r) => ({
          periodStart: day(r["period_start"]),
          organisations: num.parse(r["organisations"]),
          viewers: num.parse(r["viewers"]),
          profileViews: num.parse(r["profile_views"]),
        })),
        slices: slices.map((r) => ({
          dimension: z.string().parse(r["dimension"]),
          slice: z.string().parse(r["slice"]),
          organisations: z.coerce
            .number()
            .int()
            .nullable()
            .parse(r["organisations"]),
          suppressed: z.boolean().parse(r["suppressed"]),
        })),
      });
    },
  };
}
