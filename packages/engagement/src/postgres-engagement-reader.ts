import { z } from "zod";

import {
  CompanyEngagementDtoSchema,
  ENGAGEMENT_ORGANISATION_FLOOR,
  type CompanyEngagementDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * The founder-facing engagement read (Q Workspace §8 A3) over the
 * `analytics.company_*` projection functions.
 *
 * Every identity decision is already made in SQL: the functions check the
 * actor's active membership of the company's organisation, merge people the
 * viewer did not allow to be named, and withhold aggregates below the
 * floor. This reader only adds display names for the ids SQL chose to
 * return, so it cannot widen what a founder sees.
 */

export type CompanyEngagementReader = {
  readonly read: (query: {
    readonly actorUserId: string;
    readonly companyId: string;
    readonly since: string | null;
  }) => Promise<CompanyEngagementDto | null>;
};

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp");
};
const day = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  throw new TypeError("expected a date");
};
const num = z.coerce.number().int();

const ViewerRow = z.object({
  visibility: z.string(),
  viewer_user_id: z.string().nullable(),
  viewer_organisation_id: z.string().nullable(),
  viewer_name: z.string().nullable(),
  organisation_name: z.string().nullable(),
  people: num,
  events: num,
  profile_views: num,
  deck_opens: num,
  total_dwell_ms: num,
  video_watch_ms: num,
  q_card_views: num,
  data_room_document_views: num,
  last_viewed_at: z.unknown(),
});

export function createPostgresCompanyEngagementReader(
  sql: DatabaseExecutor,
): CompanyEngagementReader {
  return {
    read: async ({ actorUserId, companyId, since }) => {
      const [access] = await sql<{ allowed: boolean; floor_met: boolean }[]>`
        select analytics.may_read_company_engagement(${actorUserId}::uuid, ${companyId}::uuid) as allowed,
               analytics.window_meets_floor(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz) as floor_met`;
      // Not a member, or no such company: the same answer.
      if (access?.allowed !== true) return null;

      const [daily, funnel, videos, documents, viewers] = await Promise.all([
        sql`select * from analytics.company_engagement_daily(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
        sql`select * from analytics.company_deck_funnel(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
        sql`select * from analytics.company_video_completion(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
        sql`select * from analytics.company_document_views(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
        // Names only for ids the projection chose to show.
        sql`select v.*, p.display_name as viewer_name, o.display_name as organisation_name
              from analytics.company_engagement_viewers(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz) v
              left join identity.user_profiles p on p.id = v.viewer_user_id
              left join identity.organisations o on o.id = v.viewer_organisation_id`,
      ]);

      return CompanyEngagementDtoSchema.parse({
        companyId,
        since,
        floorMet: access.floor_met,
        floor: ENGAGEMENT_ORGANISATION_FLOOR,
        daily: daily.map((r) => ({
          day: day(r["day"]),
          viewers: num.parse(r["viewers"]),
          profileViews: num.parse(r["profile_views"]),
          deckOpens: num.parse(r["deck_opens"]),
          videoWatches: num.parse(r["video_watches"]),
          qCardViews: num.parse(r["q_card_views"]),
          dataRoomDocumentViews: num.parse(r["data_room_document_views"]),
        })),
        deckFunnel: funnel.map((r) => ({
          documentId: r["document_id"],
          slideNumber: num.parse(r["slide_number"]),
          viewersReached: num.parse(r["viewers_reached"]),
          totalDwellMs: num.parse(r["total_dwell_ms"]),
          medianDwellMs: num.parse(r["median_dwell_ms"]),
        })),
        videos: videos.map((r) => ({
          mediaAssetId: r["media_asset_id"],
          viewers: num.parse(r["viewers"]),
          totalWatchMs: num.parse(r["total_watch_ms"]),
          completedViewers: num.parse(r["completed_viewers"]),
        })),
        documents: documents.map((r) => ({
          documentId: r["document_id"],
          type: r["engagement_type"],
          views: num.parse(r["views"]),
          viewers: num.parse(r["viewers"]),
          totalMs: num.parse(r["total_ms"]),
        })),
        viewers: viewers.map((raw) => {
          const r = ViewerRow.parse(raw);
          return {
            visibility: r.visibility,
            viewerUserId: r.viewer_user_id,
            viewerOrganisationId: r.viewer_organisation_id,
            viewerName: r.viewer_user_id === null ? null : r.viewer_name,
            organisationName:
              r.viewer_organisation_id === null ? null : r.organisation_name,
            people: r.people,
            events: r.events,
            profileViews: r.profile_views,
            deckOpens: r.deck_opens,
            deckDwellMs: r.total_dwell_ms,
            videoWatchMs: r.video_watch_ms,
            qCardViews: r.q_card_views,
            dataRoomDocumentViews: r.data_room_document_views,
            lastViewedAt: iso(r.last_viewed_at),
          };
        }),
      });
    },
  };
}
