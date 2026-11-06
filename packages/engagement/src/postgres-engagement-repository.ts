import { z } from "zod";

import {
  ENGAGEMENT_VERSION,
  type EngagementEventInput,
  type ViewingVisibility,
  ViewingVisibilitySchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * `analytics.*` behind the engagement ports.
 *
 * The append is ONE statement that both authorises and inserts: the event
 * is written only when the company is one the viewer may see (network
 * visible, or a canonical relationship with the viewer's investor
 * organisation), the viewer is not on the company's own team, and the
 * document or video named is the company's own (a data-room document
 * only once the data room actually served it to this person). A read then
 * a write would race; a refusal is simply zero rows, indistinguishable
 * from a company that does not exist.
 *
 * The database stamps the viewer's privacy level and checks membership;
 * nothing here passes one.
 */

export type EngagementViewer = {
  readonly tenantId: string;
  readonly userId: string;
  readonly organisationId: string;
};

export type AppendOutcome = "ACCEPTED" | "DEDUPLICATED" | "DROPPED";

export type EngagementRepository = {
  readonly append: (
    viewer: EngagementViewer,
    event: EngagementEventInput,
  ) => Promise<AppendOutcome>;
  readonly privacyFor: (userId: string) => Promise<{
    readonly visibility: ViewingVisibility;
    readonly chosen: boolean;
    readonly defaultVisibility: ViewingVisibility;
    readonly allowedVisibilities: ViewingVisibility[];
  }>;
  /** NOT_ALLOWED when the platform does not offer that level. */
  readonly setPrivacy: (
    userId: string,
    visibility: ViewingVisibility,
  ) => Promise<"SAVED" | "NOT_ALLOWED">;
};

const PrivacyRow = z.object({
  visibility: ViewingVisibilitySchema.nullable(),
  default_visibility: ViewingVisibilitySchema,
  allowed_visibilities: z.array(ViewingVisibilitySchema),
});

export function createPostgresEngagementRepository(
  sql: DatabaseExecutor,
): EngagementRepository {
  return {
    append: async (viewer, event) => {
      const documentId = "documentId" in event ? event.documentId : null;
      const mediaAssetId = "mediaAssetId" in event ? event.mediaAssetId : null;
      const slideNumber =
        event.type === "DECK_SLIDE_DWELL" ? event.slideNumber : null;
      const durationMs =
        "durationMs" in event ? (event.durationMs ?? null) : null;
      const maxPositionMs =
        event.type === "VIDEO_WATCH" ? (event.maxPositionMs ?? null) : null;
      const mediaDurationMs =
        event.type === "VIDEO_WATCH" ? (event.mediaDurationMs ?? null) : null;

      const rows = await sql<{ id: string }[]>`
        insert into analytics.engagement_events
          (tenant_id, viewer_user_id, viewer_organisation_id, company_id, company_tenant_id,
           engagement_type, engagement_version, document_id, slide_number, media_asset_id,
           duration_ms, max_position_ms, media_duration_ms, visibility_at_view,
           client_event_id, session_id, occurred_at)
        select ${viewer.tenantId}::uuid, ${viewer.userId}::uuid, ${viewer.organisationId}::uuid,
               c.id, c.tenant_id, ${event.type}, ${ENGAGEMENT_VERSION},
               ${documentId}::uuid, ${slideNumber}::int, ${mediaAssetId}::uuid,
               ${durationMs}::int, ${maxPositionMs}::int, ${mediaDurationMs}::int,
               -- Replaced by the stamp trigger; never the caller's.
               'ANONYMOUS',
               ${event.clientEventId}, ${event.sessionId ?? null},
               least(${event.occurredAt}::timestamptz, now())
          from core.companies c
         where c.id = ${event.companyId}::uuid
           and c.company_status = 'active'
           and c.organisation_id <> ${viewer.organisationId}::uuid
           and (
             c.marketplace_visibility in ('network_visible', 'public_external')
             or exists (
               select 1
                 from network.relationships r
                 join core.investor_organisations io on io.id = r.investor_organisation_id
                where r.company_id = c.id
                  and io.organisation_id = ${viewer.organisationId}::uuid)
           )
           and (
             ${event.type} not in ('DECK_OPEN', 'DECK_SLIDE_DWELL')
             or exists (select 1 from evidence.documents d
                         where d.id = ${documentId}::uuid and d.company_id = c.id
                           and d.tenant_id = c.tenant_id)
           )
           and (
             ${event.type} <> 'DATA_ROOM_DOCUMENT_VIEW'
             or exists (select 1 from evidence.data_room_views v
                          join evidence.documents d on d.id = v.document_id
                         where v.document_id = ${documentId}::uuid
                           and d.company_id = c.id
                           and v.viewed_by_user_id = ${viewer.userId}::uuid)
           )
           and (
             ${event.type} <> 'VIDEO_WATCH'
             or exists (select 1 from media.media_assets m
                         where m.id = ${mediaAssetId}::uuid and m.owner_type = 'COMPANY'
                           and m.owner_id = c.id and m.tenant_id = c.tenant_id)
           )
        on conflict (tenant_id, viewer_user_id, client_event_id) do nothing
        returning id`;
      if (rows.length === 1) return "ACCEPTED";

      // Zero rows: either refused, or an earlier identical report.
      const existing = await sql<{ id: string }[]>`
        select id from analytics.engagement_events
         where tenant_id = ${viewer.tenantId}::uuid
           and viewer_user_id = ${viewer.userId}::uuid
           and client_event_id = ${event.clientEventId}`;
      return existing.length === 1 ? "DEDUPLICATED" : "DROPPED";
    },

    privacyFor: async (userId) => {
      const [row] = await sql`
        select s.visibility, analytics.default_viewing_visibility() as default_visibility,
               (analytics.settings()).allowed_visibilities as allowed_visibilities
          from (select 1) one
          left join analytics.viewing_privacy_settings s on s.user_id = ${userId}::uuid`;
      const parsed = PrivacyRow.parse(row);
      return {
        visibility: parsed.visibility ?? parsed.default_visibility,
        chosen: parsed.visibility !== null,
        defaultVisibility: parsed.default_visibility,
        allowedVisibilities: parsed.allowed_visibilities,
      };
    },

    setPrivacy: async (userId, visibility) => {
      // The allowed set is the admin setting, checked in the same statement.
      const rows = await sql`
        insert into analytics.viewing_privacy_settings (user_id, visibility, updated_at)
        select ${userId}::uuid, ${visibility}, now()
         where ${visibility} = any((analytics.settings()).allowed_visibilities)
        on conflict (user_id) do update
          set visibility = excluded.visibility, updated_at = excluded.updated_at
        returning user_id`;
      return rows.length === 1 ? "SAVED" : "NOT_ALLOWED";
    },
  };
}
