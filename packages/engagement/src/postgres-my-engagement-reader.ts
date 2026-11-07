import { z } from "zod";

import {
  MyEngagementDtoSchema,
  type MyEngagementDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { EngagementRepository } from "./postgres-engagement-repository.js";

/**
 * An investor's own engagement (Q Workspace §8 A4): what they viewed (their
 * own events, with their own times) and how founders answered what they
 * asked (interest / connection requests and data-room requests on their
 * own organisation's relationships). Nothing here reads anyone else's
 * behaviour; the founder side's choices are only what the founder did in
 * answer to this investor.
 */

export type MyEngagementReader = {
  readonly read: (query: {
    readonly actorUserId: string;
    readonly organisationId: string | null;
  }) => Promise<MyEngagementDto>;
};

const num = z.coerce.number().int();
const text = z.string();
const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp");
};
const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

const VIEWED_MAX = 50;
const RESPONSES_MAX = 50;

export function createPostgresMyEngagementReader(
  sql: DatabaseExecutor,
  repository: Pick<EngagementRepository, "privacyFor">,
): MyEngagementReader {
  return {
    read: async ({ actorUserId, organisationId }) => {
      const [privacy, viewed, responses] = await Promise.all([
        repository.privacyFor(actorUserId),
        sql`
          select e.company_id, c.canonical_name as company_name, count(*)::int as views,
                 (coalesce(sum(e.duration_ms) filter (where e.engagement_type = 'DECK_SLIDE_DWELL'), 0) / 60000)::int as deck_minutes,
                 max(e.occurred_at) as last_viewed_at
            from analytics.engagement_events e
            join core.companies c on c.id = e.company_id and c.tenant_id = e.company_tenant_id
           where e.viewer_user_id = ${actorUserId}::uuid
           group by e.company_id, c.canonical_name
           order by max(e.occurred_at) desc
           limit ${VIEWED_MAX}`,
        organisationId === null
          ? Promise.resolve([])
          : sql`
          with mine as (
            select r.id, r.company_id, c.canonical_name as company_name
              from network.relationships r
              join core.investor_organisations io on io.id = r.investor_organisation_id
              join core.companies c on c.id = r.company_id and c.tenant_id = r.tenant_id
             where io.organisation_id = ${organisationId}::uuid
          ),
          interests as (
            select m.company_id, m.company_name, 'INTEREST'::text as kind, ev.occurred_at as asked_at,
                   (select a.event_type from network.relationship_events a
                     where a.relationship_id = m.id and a.sequence > ev.sequence
                       and a.event_type in ('connection_accepted', 'interest_declined')
                     order by a.sequence limit 1) as answer,
                   (select a.occurred_at from network.relationship_events a
                     where a.relationship_id = m.id and a.sequence > ev.sequence
                       and a.event_type in ('connection_accepted', 'interest_declined')
                     order by a.sequence limit 1) as answered_at
              from mine m
              join network.relationship_events ev on ev.relationship_id = m.id
             where ev.event_type = 'interest_expressed'
               and coalesce(ev.payload ->> 'expressedByParty', 'INVESTOR') = 'INVESTOR'
          ),
          requests as (
            select m.company_id, m.company_name, 'DATA_ROOM_REQUEST'::text as kind, q.created_at as asked_at,
                   d.decision as answer, d.created_at as answered_at
              from mine m
              join evidence.data_room_access_requests q on q.relationship_id = m.id
              left join evidence.data_room_request_decisions d on d.request_id = q.id
          )
          select * from interests
          union all
          select * from requests
          order by asked_at desc
          limit ${RESPONSES_MAX}`,
      ]);
      return MyEngagementDtoSchema.parse({
        privacy,
        viewed: viewed.map((r) => ({
          companyId: text.parse(r["company_id"]),
          companyName: text.parse(r["company_name"]),
          views: num.parse(r["views"]),
          deckMinutes: num.parse(r["deck_minutes"]),
          lastViewedAt: iso(r["last_viewed_at"]),
        })),
        responses: responses.map((r) => {
          const answer = z.string().nullable().parse(r["answer"]);
          return {
            companyId: text.parse(r["company_id"]),
            companyName: text.parse(r["company_name"]),
            kind: text.parse(r["kind"]),
            state:
              answer === "connection_accepted" || answer === "APPROVED"
                ? "ACCEPTED"
                : answer === "interest_declined" || answer === "DECLINED"
                  ? "DECLINED"
                  : "WAITING",
            askedAt: iso(r["asked_at"]),
            answeredAt: isoOrNull(r["answered_at"]),
          };
        }),
      });
    },
  };
}
