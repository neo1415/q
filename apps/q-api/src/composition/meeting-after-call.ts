import {
  meetingFollowUpOf,
  type MeetingBotProvider,
  type MeetingDigest,
  type MeetingFollowUp,
  type MeetingOutcomes,
} from "@capital-q/communication";
import { decodeJsonbString, type DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

/**
 * After a held meeting (slices S5-S7 of the meetings design, owner
 * 2026-11-18). The post-call reading (`MeetingOutcomes`, written by the
 * meeting assistant) is turned into what each audience receives:
 *
 *   S5  money signals Q heard are filed as DETECTED commitments (only with
 *       an exact amount AND a currency someone said; never counted until
 *       both sides confirm), and the investor's requests as diligence
 *       requests naming the meeting (only in an open diligence);
 *   S6  Capital Q's admin gets the digest (never the transcript);
 *       a document the owner shares during a live call is announced in
 *       its chat, once;
 *   S7  the next time a person talks to Q, it opens with that meeting's
 *       follow-ups for them, once.
 *
 * Every read is scoped to the person or the meeting's own rows; nothing
 * here sends anything outward but the one chat line, which follows the
 * document owner's own share.
 */

// --- S6: the admin digest ----------------------------------------------------

export function createMeetingDigestWriter(
  sql: DatabaseExecutor,
): (digest: MeetingDigest) => Promise<void> {
  return async (digest) => {
    await sql`
      insert into platform_ops.meeting_digests
        (meeting_id, relationship_id, held_at, duration_seconds, soft_signals,
         hard_signals, amounts, requests, request_items, next_step)
      values (${digest.meetingId}, ${digest.relationshipId}, ${digest.heldAt},
              ${digest.durationSeconds}, ${digest.softSignals}, ${digest.hardSignals},
              ${sql.json(digest.amounts.map((a) => ({ ...a })))}, ${digest.requests},
              ${sql.json([...digest.requestItems])}, ${digest.nextStep})
      on conflict (meeting_id) do nothing`;
  };
}

// --- S5: filing what was read -----------------------------------------------

/**
 * The person's own actor context, resolved by the server from their user
 * id (never from anything said in the call), for their side's service to
 * authorise. Null: they cannot act now (suspended, no membership).
 */
export function createActorForUser(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly resolver: ActorContextResolver;
}): (userId: string) => Promise<ActorContext | null> {
  return async (userId) => {
    const rows = await dependencies.sql<{ auth_user_id: string | null }[]>`
      select auth_user_id from identity.user_profiles where id = ${userId}`;
    const auth = AuthUserIdSchema.safeParse(rows[0]?.auth_user_id);
    if (!auth.success) return null;
    const resolution = await resolveHumanActorContext(dependencies.resolver, {
      principal: { authUserId: auth.data },
      selection: {},
    });
    return resolution.status === "RESOLVED" &&
      resolution.context.userId === userId
      ? resolution.context
      : null;
  };
}

export type MeetingOutcomeFilerPorts = {
  readonly actorFor: (userId: string) => Promise<ActorContext | null>;
  readonly detect: (input: {
    readonly relationshipId: string;
    readonly meetingId: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly level: "SOFT" | "FIRM";
    readonly statedBySide: "COMPANY" | "INVESTOR" | null;
    readonly quote: string;
    readonly key: string;
    readonly condition: string | null;
  }) => Promise<boolean>;
  readonly recordRequest: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly title: string;
    readonly quote: string;
    readonly meetingId: string;
    readonly sourceEventId: string;
    readonly dueText: string | null;
  }) => Promise<{ readonly outcome: string }>;
  readonly logger?: Logger | undefined;
};

/** Files the reading; returns how many diligence requests it filed. */
export function createMeetingOutcomeFiler(ports: MeetingOutcomeFilerPorts) {
  return async (held: {
    readonly relationshipId: string;
    readonly meetingId: string;
    readonly outcomes: MeetingOutcomes;
  }): Promise<number> => {
    for (const signal of held.outcomes.commitments) {
      // Unknown stays unknown: no figure or no currency said, nothing to
      // file; the signal stays on the record for the person to confirm.
      if (signal.amount === null || signal.currencyCode === null) continue;
      await ports
        .detect({
          relationshipId: held.relationshipId,
          meetingId: held.meetingId,
          amount: signal.amount,
          currencyCode: signal.currencyCode,
          level: signal.level === "HARD" ? "FIRM" : "SOFT",
          statedBySide:
            signal.evidence.side === null
              ? null
              : signal.evidence.side === "FOUNDER"
                ? "COMPANY"
                : "INVESTOR",
          quote: signal.evidence.quote,
          key: `meeting:${held.meetingId}:${signal.id}`,
          condition: signal.condition,
        })
        .catch((error: unknown) => {
          ports.logger?.warn(
            { err: error, meetingId: held.meetingId },
            "a detected commitment was not filed",
          );
        });
    }
    let filed = 0;
    for (const request of held.outcomes.requests) {
      if (!request.diligence || request.askerUserId === null) continue;
      const actor = await ports.actorFor(request.askerUserId).catch(() => null);
      if (actor === null) continue;
      const result = await ports
        .recordRequest({
          actor,
          relationshipId: held.relationshipId,
          title: request.item,
          quote: request.evidence.quote,
          meetingId: held.meetingId,
          sourceEventId: request.id,
          dueText: request.dueText,
        })
        .catch(() => ({ outcome: "FAILED" }));
      if (result.outcome === "OK") filed += 1;
    }
    return filed;
  };
}

// --- S7: the next conversation's opener --------------------------------------

/** How long after a meeting Q still opens with it. */
const FOLLOW_UP_WINDOW_MS = 14 * 24 * 3_600_000;

export type MeetingFollowUps = {
  /** This person's follow-ups from their latest held meeting not yet opened with. */
  readonly next: (
    actor: ActorContext,
  ) => Promise<(MeetingFollowUp & { readonly meetingId: string }) | null>;
  /** Q opened with it: never again for this person and meeting. */
  readonly seen: (actor: ActorContext, meetingId: string) => Promise<void>;
};

function isOutcomes(value: unknown): value is MeetingOutcomes {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === "meeting-outcomes.v1" &&
    Array.isArray((value as { requests?: unknown }).requests) &&
    Array.isArray((value as { promises?: unknown }).promises) &&
    Array.isArray((value as { commitments?: unknown }).commitments)
  );
}

export function createMeetingFollowUps(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly now?: (() => Date) | undefined;
}): MeetingFollowUps {
  const { sql } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  return {
    next: async (actor) => {
      const since = new Date(now().getTime() - FOLLOW_UP_WINDOW_MS);
      // Only a meeting this person was in, whose record is written, and
      // that Q has not yet opened with for them.
      const rows = await sql<
        {
          meeting_id: string;
          outcomes: unknown;
          side: "FOUNDER" | "INVESTOR";
          counterpart: string | null;
          company_id: string;
        }[]
      >`
        select m.id as meeting_id, a.outcomes,
               case when exists (
                      select 1 from identity.organisation_memberships om
                       where om.user_id = ${actor.userId}
                         and om.organisation_id = c.organisation_id
                         and om.membership_status = 'active')
                    then 'FOUNDER' else 'INVESTOR' end as side,
               case when exists (
                      select 1 from identity.organisation_memberships om
                       where om.user_id = ${actor.userId}
                         and om.organisation_id = c.organisation_id
                         and om.membership_status = 'active')
                    then i.display_name else c.canonical_name end as counterpart,
               c.id as company_id
          from communication.meetings m
          join communication.meeting_participants p
            on p.meeting_id = m.id and p.user_id = ${actor.userId}
          join communication.meeting_assistants a on a.meeting_id = m.id
          join network.relationships r on r.id = m.relationship_id
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
         where a.status = 'DONE' and a.outcomes is not null
           and m.starts_at > ${since}
           and not exists (
             select 1 from communication.meeting_follow_up_seen s
              where s.meeting_id = m.id and s.user_id = ${actor.userId})
         order by m.starts_at desc
         limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const outcomes = decodeJsonbString(row.outcomes);
      if (!isOutcomes(outcomes)) return null;
      // A founder's own company documents: what Q could share now.
      const documents =
        row.side === "FOUNDER"
          ? await sql<{ id: string; title: string }[]>`
              select d.id, d.title from evidence.documents d
               where d.company_id = ${row.company_id} and d.status = 'ACTIVE'
               order by d.created_at desc
               limit 50`
          : [];
      const followUp = meetingFollowUpOf({
        userId: actor.userId,
        side: row.side,
        counterpart: row.counterpart,
        outcomes,
        documents,
      });
      return followUp === null
        ? null
        : { ...followUp, meetingId: row.meeting_id };
    },
    seen: async (actor, meetingId) => {
      await sql`
        insert into communication.meeting_follow_up_seen (meeting_id, user_id, tenant_id)
        select m.id, ${actor.userId}, ${actor.tenantId}
          from communication.meetings m
          join communication.meeting_participants p
            on p.meeting_id = m.id and p.user_id = ${actor.userId}
         where m.id = ${meetingId}
        on conflict (meeting_id, user_id) do nothing`;
    },
  };
}

// --- S6b: a share announced in the live call ---------------------------------

/** The one chat line, for everyone in the call. The link is not access: it opens Capital Q, which asks for sign-in and checks the grant. */
export function inCallShareLine(input: {
  readonly ownerName: string;
  readonly documentTitle: string;
  readonly counterpart: string;
  readonly link: string;
}): string {
  return `${input.ownerName} shared "${input.documentTitle.slice(0, 120)}" with ${input.counterpart} on Capital Q. Sign in to open it: ${input.link}`;
}

export function createInCallShareAnnouncer(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly bots: Pick<MeetingBotProvider, "sendChat"> | undefined;
  /** The web app's public origin, for the link; absent: nothing is posted. */
  readonly webUrl: string | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { sql } = dependencies;
  return async (share: {
    readonly relationshipId: string;
    readonly documentTitle: string;
    readonly sharedByUserId: string;
  }): Promise<boolean> => {
    const send = dependencies.bots?.sendChat;
    if (send === undefined || dependencies.webUrl === undefined) return false;
    // A call on this relationship that Q is in right now, which the
    // person who shared is part of.
    const rows = await sql<
      {
        meeting_id: string;
        tenant_id: string;
        bot_id: string;
        owner_name: string | null;
        counterpart: string;
        company_id: string;
      }[]
    >`
      select m.id as meeting_id, m.organiser_tenant_id as tenant_id,
             a.provider_bot_id as bot_id, u.display_name as owner_name,
             i.display_name as counterpart, c.id as company_id
        from communication.meetings m
        join communication.meeting_assistants a on a.meeting_id = m.id
        join communication.meeting_participants p
          on p.meeting_id = m.id and p.user_id = ${share.sharedByUserId}
        join identity.user_profiles u on u.id = p.user_id
        join network.relationships r on r.id = m.relationship_id
        join core.companies c on c.id = r.company_id
        join core.investor_organisations i on i.id = r.investor_organisation_id
       where m.relationship_id = ${share.relationshipId}
         and a.status = 'IN_CALL' and a.provider_bot_id is not null
       order by m.starts_at desc
       limit 1`;
    const live = rows[0];
    if (live === undefined) return false;
    const line = inCallShareLine({
      ownerName: live.owner_name ?? "The founder",
      documentTitle: share.documentTitle,
      counterpart: live.counterpart,
      link: `${dependencies.webUrl}/relationships/company/${encodeURIComponent(live.company_id)}`,
    });
    // Once per meeting and line, claimed before it is posted.
    const claimed = await sql<{ id: string }[]>`
      insert into communication.meeting_host_notes
        (meeting_id, tenant_id, kind, body, requested_by_name, requested_by_user_id)
      values (${live.meeting_id}, ${live.tenant_id}, 'SHARED_IN_CALL', ${line.slice(0, 500)},
              ${(live.owner_name ?? "").slice(0, 200) || null}, ${share.sharedByUserId})
      on conflict (meeting_id, body) where kind = 'SHARED_IN_CALL' do nothing
      returning id`;
    if (claimed.length === 0) return false;
    await send(live.bot_id, line).catch((error: unknown) => {
      dependencies.logger?.warn(
        { err: error, meetingId: live.meeting_id },
        "the in-call share line was not posted",
      );
    });
    return true;
  };
}
