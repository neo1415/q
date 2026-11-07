import { z } from "zod";

import {
  CompanyEngagementDtoSchema,
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

const day = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  throw new TypeError("expected a date");
};
const num = z.coerce.number().int();
const text = z.string();

const nullableNum = z.coerce.number().int().nullable();
const ViewerRow = z.object({
  visibility: z.string(),
  basis: z.string(),
  viewer_user_id: z.string().nullable(),
  viewer_organisation_id: z.string().nullable(),
  viewer_name: z.string().nullable(),
  organisation_name: z.string().nullable(),
  organisations: num,
  people: num,
  events: num,
  profile_views: num,
  deck_opens: num,
  total_dwell_ms: nullableNum,
  video_watch_ms: nullableNum,
  q_card_views: num,
  data_room_document_views: num,
  last_period_start: z.unknown(),
});

export function createPostgresCompanyEngagementReader(
  sql: DatabaseExecutor,
): CompanyEngagementReader {
  return {
    read: async ({ actorUserId, companyId, since }) => {
      const [access] = await sql<
        {
          allowed: boolean;
          floor_met: boolean;
          per_viewer: boolean | null;
          entitled: boolean | null;
          floor: number;
          slice_floor: number;
          batch: string;
        }[]
      >`
        select analytics.may_read_company_engagement(${actorUserId}::uuid, ${companyId}::uuid) as allowed,
               analytics.window_meets_floor(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz) as floor_met,
               a.per_viewer, a.entitled,
               analytics.engagement_floor() as floor, analytics.slice_floor() as slice_floor,
               (analytics.settings()).passive_batch as batch
          from (select 1) one
          left join analytics.company_viewer_access(${actorUserId}::uuid, ${companyId}::uuid) a on true`;
      // Not a member, or no such company: the same answer.
      if (access?.allowed !== true) return null;

      const [periods, funnel, videos, documents, viewers, detail, slices] =
        await Promise.all([
          sql`select * from analytics.company_engagement_periods(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
          sql`select * from analytics.company_deck_funnel(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
          sql`select * from analytics.company_video_completion(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
          sql`select * from analytics.company_document_views(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
          // Names only for ids the projection chose to show.
          sql`select v.*, p.display_name as viewer_name, o.display_name as organisation_name
              from analytics.company_engagement_viewers(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz) v
              left join identity.user_profiles p on p.id = v.viewer_user_id
              left join identity.organisations o on o.id = v.viewer_organisation_id`,
          sql`select * from analytics.company_viewer_deck_detail(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
          sql`select * from analytics.company_engagement_slices(${actorUserId}::uuid, ${companyId}::uuid, ${since}::timestamptz)`,
        ]);

      return CompanyEngagementDtoSchema.parse({
        companyId,
        since,
        floorMet: access.floor_met,
        floor: num.parse(access.floor),
        sliceFloor: num.parse(access.slice_floor),
        passiveBatch: access.batch,
        perViewer: access.per_viewer === true,
        entitled: access.entitled === true,
        periods: periods.map((r) => ({
          periodStart: day(r["period_start"]),
          organisations: num.parse(r["organisations"]),
          viewers: num.parse(r["viewers"]),
          profileViews: num.parse(r["profile_views"]),
          deckOpens: num.parse(r["deck_opens"]),
          videoWatches: num.parse(r["video_watches"]),
          qCardViews: num.parse(r["q_card_views"]),
          dataRoomDocumentViews: num.parse(r["data_room_document_views"]),
        })),
        deckFunnel: funnel.map((r) => ({
          documentId: text.parse(r["document_id"]),
          slideNumber: num.parse(r["slide_number"]),
          viewersReached: num.parse(r["viewers_reached"]),
          totalDwellMs: num.parse(r["total_dwell_ms"]),
          medianDwellMs: num.parse(r["median_dwell_ms"]),
        })),
        videos: videos.map((r) => ({
          mediaAssetId: text.parse(r["media_asset_id"]),
          viewers: num.parse(r["viewers"]),
          totalWatchMs: num.parse(r["total_watch_ms"]),
          completedViewers: num.parse(r["completed_viewers"]),
        })),
        documents: documents.map((r) => ({
          documentId: text.parse(r["document_id"]),
          type: text.parse(r["engagement_type"]),
          views: num.parse(r["views"]),
          viewers: num.parse(r["viewers"]),
          totalMs: num.parse(r["total_ms"]),
        })),
        viewers: viewers.map((raw) => {
          const r = ViewerRow.parse(raw);
          return {
            visibility: r.visibility,
            basis: r.basis,
            viewerUserId: r.viewer_user_id,
            viewerOrganisationId: r.viewer_organisation_id,
            viewerName: r.viewer_user_id === null ? null : r.viewer_name,
            organisationName:
              r.viewer_organisation_id === null ? null : r.organisation_name,
            organisations: r.organisations,
            people: r.people,
            events: r.events,
            profileViews: r.profile_views,
            deckOpens: r.deck_opens,
            deckDwellMs: r.total_dwell_ms,
            videoWatchMs: r.video_watch_ms,
            qCardViews: r.q_card_views,
            dataRoomDocumentViews: r.data_room_document_views,
            lastPeriodStart:
              r.last_period_start === null ? null : day(r.last_period_start),
          };
        }),
        viewerDeckDetail: detail.map((r) => ({
          viewerUserId: text.parse(r["viewer_user_id"]),
          documentId: text.parse(r["document_id"]),
          slideNumber: num.parse(r["slide_number"]),
          dwellMs: num.parse(r["dwell_ms"]),
        })),
        slices: slices.map((r) => ({
          dimension: text.parse(r["dimension"]),
          slice: text.parse(r["slice"]),
          organisations: nullableNum.parse(r["organisations"]),
          suppressed: z.boolean().parse(r["suppressed"]),
        })),
      });
    },
  };
}
