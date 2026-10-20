import { createHash } from "node:crypto";

import {
  ARRIVAL_SNAPSHOT_ITEMS_MAX,
  ARRIVAL_SNAPSHOT_VERSION,
  ArrivalSnapshotSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  isMatchedRelationshipState,
  relationshipMessagesPath,
  relationshipPagePath,
  type ArrivalDailyStory,
  type ArrivalSnapshot,
  type ArrivalSnapshotFacts,
  type ArrivalSnapshotItem,
  type ArrivalSnapshotMessage,
  type QAttentionItem,
  type QAttentionReport,
  type QDailyEdition,
  type RelationshipBrief,
  type RelationshipBriefMessage,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import {
  createContextCache,
  type ContextCache,
  type ContextCacheScope,
} from "@capital-q/security/context-cache";

import { dailyStoriesOf } from "./arrival-daily.js";

/**
 * W1: the Arrival Snapshot, built once per actor and shared by the welcome,
 * Q's turns, the live voice session and the Work list.
 *
 * The builder (`buildArrivalSnapshot`) is pure: attention report +
 * relationship briefs in, snapshot out. Both inputs are already the
 * person's own, authorised reads (the same ones their pages use), so the
 * snapshot carries nothing they could not see, and a bounded preview of
 * only the latest messages -- never a whole thread.
 *
 * `createArrivalSnapshots` adds freshness. The entry lives under F's
 * context-cache scope (tenant, user, organisation, membership, the actor's
 * authorisation epoch, kind, sensitivity, firewall policy version). It is
 * reused while a probe of the source versions (relationship history,
 * messages, meetings, approvals) is unchanged. To make a follow-up on
 * unchanged data cost no database round trip at all, a probe is trusted
 * for `trustMs`; writes in this process (and any revocation seen by the
 * probe) end the trust at once through `invalidateActor`, and nothing is
 * ever served past `trustMs` without the probe. The documented tradeoff:
 * a change made by another process is seen within `trustMs`.
 */

const PREVIEW_MAX = 240;
const clip = (text: string, max: number): string => {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

function messageOf(
  message: RelationshipBriefMessage | null,
): ArrivalSnapshotMessage | null {
  if (message === null) return null;
  return {
    from: message.from,
    senderName: clip(message.senderName, 200),
    text: message.preview === null ? null : clip(message.preview, PREVIEW_MAX),
    kind: message.kind,
    status: "SENT",
    viaQ: message.viaQ,
    sentAt: message.sentAt,
  };
}

const DECISION_LABELS: Record<string, string> = {
  ANSWER_INTEREST: "Answer their request to connect",
  AWAIT_ANSWER: "Waiting on their answer",
  EXPRESS_INTEREST: "Express interest",
  REPLY_TO_MESSAGE: "Reply to their message",
  SCHEDULE_MEETING: "Book a call",
  ATTEND_MEETING: "Attend the call",
  DECIDE_NEXT_STEP: "Decide the next step",
  FOLLOW_UP: "Follow up after the call",
  RESUME: "Resume the conversation",
};

const REQUEST_KIND: Record<
  QAttentionItem["source"],
  NonNullable<ArrivalSnapshotFacts["request"]>["kind"]
> = {
  UNANSWERED_MESSAGE: "REPLY",
  APPROVAL: "APPROVAL",
  HELD_DRAFT: "OTHER",
  AGENT_BLOCKED: "OTHER",
  DOCUMENT_REQUEST: "DOCUMENTS",
  INTEREST_REQUEST: "CONNECTION_OR_INTEREST",
  MEETING: "MEETING",
  REMINDER: "OTHER",
  NEW_MATCHES: "OTHER",
  NOTICE: "OTHER",
};

const NO_FACTS: ArrivalSnapshotFacts = {
  request: null,
  messageCount: null,
  latestMessage: null,
  theirLatestMessage: null,
  meeting: null,
  decisions: [],
  documents: [],
  openRequests: [],
  relationshipState: null,
  suggestedNextAction: null,
  note: null,
};

const NO_IDS = {
  relationshipId: null,
  companyId: null,
  investorOrganisationId: null,
  meetingId: null,
  approvalId: null,
  jobId: null,
  documentId: null,
  messageId: null,
} as const;

function idsOf(item: QAttentionItem): ArrivalSnapshotItem["ids"] {
  const entity = item.entity;
  if (entity === undefined) return NO_IDS;
  switch (entity.kind) {
    case "RELATIONSHIP":
      return { ...NO_IDS, relationshipId: entity.id };
    case "COMPANY":
      return { ...NO_IDS, companyId: entity.id };
    case "INVESTOR_ORGANISATION":
      return { ...NO_IDS, investorOrganisationId: entity.id };
    case "MEETING":
      return { ...NO_IDS, meetingId: entity.id };
    case "APPROVAL":
      return { ...NO_IDS, approvalId: entity.id };
    case "JOB":
      return { ...NO_IDS, jobId: entity.id };
    case "DOCUMENT":
      return { ...NO_IDS, documentId: entity.id };
  }
}

function itemFor(
  item: QAttentionItem,
  brief: RelationshipBrief | undefined,
  briefsRead: boolean,
  asOf: string,
): ArrivalSnapshotItem {
  const base = {
    key: item.key,
    kind: item.source,
    headline: item.title,
    decidable: item.decidable,
    since: item.since,
    asOf,
  };
  const attentionEvidence = {
    source: "ATTENTION" as const,
    ref: item.key.slice(0, 80),
    asOf,
  };
  const ids = idsOf(item);
  const requestFrom = item.counterpart ?? null;
  const request = {
    kind: REQUEST_KIND[item.source],
    from: requestFrom,
    since: item.since,
    summary: clip(item.title, 400),
  };

  // No relationship behind it (a notice, a match, an approval, a job): the
  // attention source is its own fact base.
  if (item.entity?.kind !== "RELATIONSHIP") {
    return {
      ...base,
      availability: "OK",
      counterpart: null,
      ids,
      facts: {
        ...NO_FACTS,
        request,
        note: item.note === undefined ? null : clip(item.note, 600),
      },
      hasConversation: false,
      openPath: null,
      evidence: [attentionEvidence],
      sourceVersions: { historySequence: null, brief: null },
    };
  }

  // A relationship headline must be resolvable to its brief; if the brief
  // could not be read the headline stands, marked UNAVAILABLE.
  if (!briefsRead || brief === undefined) {
    return {
      ...base,
      availability: "UNAVAILABLE",
      counterpart: null,
      ids,
      facts: {
        ...NO_FACTS,
        request,
        note: item.note === undefined ? null : clip(item.note, 600),
      },
      hasConversation: false,
      openPath: null,
      evidence: [attentionEvidence],
      sourceVersions: { historySequence: null, brief: null },
    };
  }

  const counterpart = brief.counterparty;
  const latestOk = brief.messages.latest.status === "OK";
  const latest =
    brief.messages.latest.status === "OK"
      ? messageOf(brief.messages.latest.message)
      : null;
  const theirs =
    brief.messages.latest.status === "OK"
      ? messageOf(brief.messages.latest.fromThem)
      : null;
  const meetingsOk = brief.meetings.status === "OK";
  const meetingRow =
    brief.meetings.status === "OK"
      ? (brief.meetings.nextScheduled ??
        [...brief.meetings.items].sort((a, b) =>
          b.startsAt.localeCompare(a.startsAt),
        )[0] ??
        null)
      : null;
  const decisions = brief.pendingDecisions.items.map((decision) => ({
    kind: decision.kind,
    owner: decision.owner,
    since: decision.since,
    label: DECISION_LABELS[decision.kind] ?? decision.kind,
  }));
  const primary = decisions[0];
  const documents =
    brief.documents.status === "OK"
      ? brief.documents.items.slice(0, 10).map((d) => ({
          id: d.id,
          title: clip(d.title, 300),
        }))
      : [];
  const openRequests =
    brief.obligations.status === "OK"
      ? brief.obligations.openRequests.slice(0, 10).map((r) => ({
          id: r.id,
          title: clip(r.title, 200),
        }))
      : [];
  const evidence: ArrivalSnapshotItem["evidence"] = [
    attentionEvidence,
    {
      source: "RELATIONSHIP_BRIEF",
      ref: brief.relationshipId,
      asOf: brief.generatedAt,
    },
    {
      source: "RELATIONSHIP_HISTORY",
      ref: String(brief.sourceVersions.historySequence),
      asOf: brief.generatedAt,
    },
    ...(latestOk
      ? [
          {
            source: "THREAD" as const,
            ref: brief.relationshipId,
            asOf: brief.generatedAt,
          },
        ]
      : []),
    ...(meetingsOk
      ? [
          {
            source: "SCHEDULE" as const,
            ref: brief.relationshipId,
            asOf: brief.generatedAt,
          },
        ]
      : []),
    ...(brief.obligations.status === "OK"
      ? [
          {
            source: "DILIGENCE" as const,
            ref: brief.relationshipId,
            asOf: brief.generatedAt,
          },
        ]
      : []),
  ];
  return {
    ...base,
    availability: latestOk && meetingsOk ? "OK" : "UNAVAILABLE",
    counterpart: {
      kind: counterpart.kind,
      id: counterpart.id,
      name: counterpart.name,
    },
    ids: {
      ...ids,
      companyId: counterpart.kind === "COMPANY" ? counterpart.id : null,
      investorOrganisationId:
        counterpart.kind === "INVESTOR_ORGANISATION" ? counterpart.id : null,
      meetingId: meetingRow?.id ?? null,
      documentId: documents[0]?.id ?? null,
    },
    facts: {
      // The request is first-class: who made it, when, and what it says.
      request: {
        ...request,
        from: counterpart.name ?? requestFrom,
        summary:
          item.source === "UNANSWERED_MESSAGE" && theirs?.text != null
            ? clip(`${counterpart.name ?? "They"} wrote: "${theirs.text}"`, 400)
            : request.summary,
      },
      messageCount: brief.messages.count,
      latestMessage: latest,
      theirLatestMessage: theirs,
      meeting:
        meetingRow === null
          ? null
          : {
              id: meetingRow.id,
              status: meetingRow.status,
              startsAt: meetingRow.startsAt,
              endsAt: meetingRow.endsAt,
              timing: meetingRow.timing,
              organisedByYou: meetingRow.organisedByYou,
              booked: meetingRow.status === "SCHEDULED",
            },
      decisions,
      documents,
      openRequests,
      relationshipState: brief.state?.state ?? null,
      suggestedNextAction:
        primary === undefined
          ? null
          : { kind: primary.kind, owner: primary.owner, label: primary.label },
      note: item.note === undefined ? null : clip(item.note, 600),
    },
    // The messages page redirects to the overview until both sides have
    // connected, so a pending relationship has no conversation to open:
    // its path is the relationship page, and Q says so.
    hasConversation:
      brief.state !== null && isMatchedRelationshipState(brief.state.state),
    openPath:
      brief.state !== null && isMatchedRelationshipState(brief.state.state)
        ? relationshipMessagesPath(counterpart.kind, counterpart.id)
        : relationshipPagePath(counterpart.kind, counterpart.id),
    evidence: evidence.slice(0, 8),
    sourceVersions: {
      historySequence: brief.sourceVersions.historySequence,
      brief: brief.sourceVersions.brief,
    },
  };
}

/** Pure: the snapshot for one actor's report and briefs. */
export function buildArrivalSnapshot(input: {
  readonly report: QAttentionReport;
  /** Null: the briefs could not be read (relationship items go UNAVAILABLE). */
  readonly briefs: readonly RelationshipBrief[] | null;
  readonly now: Date;
}): ArrivalSnapshot {
  const asOf = input.now.toISOString();
  const byRelationship = new Map(
    (input.briefs ?? []).map((brief) => [brief.relationshipId, brief]),
  );
  const items = input.report.items
    .slice(0, ARRIVAL_SNAPSHOT_ITEMS_MAX)
    .map((item) =>
      itemFor(
        item,
        item.entity?.kind === "RELATIONSHIP"
          ? byRelationship.get(item.entity.id)
          : undefined,
        input.briefs !== null,
        asOf,
      ),
    );
  // The version moves when any fact does; the read time alone never moves it.
  const version = createHash("sha256")
    .update(
      JSON.stringify(
        items.map((item) => [
          item.key,
          item.headline,
          item.availability,
          item.facts,
          item.sourceVersions,
        ]),
      ),
    )
    .digest("hex")
    .slice(0, 32);
  return ArrivalSnapshotSchema.parse({
    daily: [],
    contractVersion: ARRIVAL_SNAPSHOT_VERSION,
    version,
    asOf,
    items,
    unread: input.report.unread,
    briefsRead: input.briefs !== null,
    activity: input.report.activity,
  });
}

// --- freshness -------------------------------------------------------------

/** How long a probe is trusted without asking the database again. */
export const DEFAULT_TRUST_MS = 30_000;

export const ARRIVAL_SNAPSHOT_CACHE_KIND = "tierB.arrivalSnapshot";

/**
 * One cheap read that answers both "is this still the same access"
 * (authorisation epoch) and "is this still the same data" (a stamp over
 * the actor's relationship history, messages, meetings and approvals).
 * It returns no content, only two opaque strings.
 */
export type ArrivalProbe = (
  actor: ActorContext,
) => Promise<{ readonly epoch: string; readonly stamp: string }>;

export function createPostgresArrivalProbe(dependencies: {
  readonly sql: DatabaseExecutor;
}): ArrivalProbe {
  const { sql } = dependencies;
  return async (actor) => {
    const rows = await sql<{ epoch: string; stamp: string }[]>`
      with mine as (
        select r.id
          from network.relationships r
          left join core.companies c on c.id = r.company_id
          left join core.investor_organisations io
            on io.id = r.investor_organisation_id
         where ${actor.organisationId ?? null}::uuid is not null
           and (c.organisation_id = ${actor.organisationId ?? null}::uuid
             or io.organisation_id = ${actor.organisationId ?? null}::uuid))
      select private.actor_authz_epoch(
               ${actor.userId}::uuid, ${actor.tenantId}::uuid,
               ${actor.membershipId ?? null}::uuid) as epoch,
             concat_ws('|',
               (select count(*) || ':' || coalesce(max(e.sequence), 0)
                       || ':' || coalesce(max(e.occurred_at)::text, '')
                  from network.relationship_events e
                  join mine on mine.id = e.relationship_id),
               (select count(*) || ':' || coalesce(max(m.created_at)::text, '')
                  from communication.messages m
                  join communication.conversations cv on cv.id = m.conversation_id
                  join mine on mine.id = cv.relationship_id),
               (select count(*) || ':' || coalesce(max(mt.updated_at)::text, '')
                  from communication.meetings mt
                  join mine on mine.id = mt.relationship_id),
               (select count(*) || ':' || coalesce(max(a.requested_at)::text, '')
                       || ':' || coalesce(max(a.approved_at)::text, '')
                       || ':' || coalesce(max(a.rejected_at)::text, '')
                       || ':' || coalesce(max(a.revoked_at)::text, '')
                  from q_runtime.approvals a
                 where a.requested_from_user_id = ${actor.userId}::uuid
                   and a.tenant_id = ${actor.tenantId}::uuid
                   and a.status = 'PENDING')
             ) as stamp`;
    const row = rows[0];
    if (row === undefined) throw new Error("arrival probe unavailable");
    return { epoch: row.epoch, stamp: row.stamp };
  };
}

type Held = {
  readonly snapshot: ArrivalSnapshot;
  readonly stamp: string;
  /** When a probe last proved this entry current (built or re-validated). */
  readonly validatedAt: number;
};

export type ArrivalSnapshots = {
  /** The actor's snapshot; null when they have none or it cannot be read. */
  readonly forActor: (
    actor: ActorContext,
    options?: { readonly since?: Date | null },
  ) => Promise<ArrivalSnapshot | null>;
  /** Ends trust for this actor at once (a write in this process). */
  readonly invalidateActor: (userId: string) => number;
  /**
   * S5 refresh-ahead: ends trust, then rebuilds in the background for this
   * live actor (deduplicated per actor), so the next read is warm. The
   * rebuilt entry lives under the actor's current authorisation epoch:
   * a changed membership or role never reads it.
   */
  readonly refreshAfterWrite: (actor: ActorContext) => void;
  /** Settles once no background rebuild is running (tests, shutdown). */
  readonly settled: () => Promise<void>;
  readonly invalidateOrganisation: (organisationId: string) => number;
};

const DAY_MS = 24 * 3_600_000;

export function createArrivalSnapshots(dependencies: {
  readonly attention: (
    actor: ActorContext,
    options: { readonly now: Date; readonly since: Date },
  ) => Promise<QAttentionReport>;
  readonly briefs: (
    actor: ActorContext,
  ) => Promise<readonly RelationshipBrief[] | null>;
  readonly probe: ArrivalProbe;
  /** P4: the person's latest Q Daily edition; absent or null: no stories. */
  readonly daily?:
    ((actor: ActorContext) => Promise<QDailyEdition | null>) | undefined;
  readonly cache?: ContextCache<Held> | undefined;
  readonly now?: (() => Date) | undefined;
  /** How long a probe is trusted without asking again. */
  readonly trustMs?: number | undefined;
  /** How long an entry lives without a matching probe (default 10 min). */
  readonly cacheTtlMs?: number | undefined;
}): ArrivalSnapshots {
  const now = dependencies.now ?? (() => new Date());
  // 30 s: a Q turn takes longer than the old 15 s, so the snapshot read
  // right after one cost a probe round trip (V2: 4 against 3). The actor
  // is resolved live on every request (session and membership), so a
  // revoked person never reaches this cache; only another party's new
  // data waits up to this long, and the person's own writes end trust now.
  const trustMs = dependencies.trustMs ?? DEFAULT_TRUST_MS;
  const ttlMs = dependencies.cacheTtlMs ?? 10 * 60_000;
  const cache =
    dependencies.cache ??
    createContextCache<Held>({ ttlMs, now: () => now().getTime() });
  /**
   * S5 sliding lifetime: an entry a probe has just proved current is put
   * back once it is past half its lifetime, so a person who keeps using Q
   * never pays the cold build (live 2026-10-15: 1.4 s, 126 round trips)
   * just because ten minutes passed. Only a matching probe stamp renews.
   */
  const renewed = (scope: ContextCacheScope, held: Held): Held => {
    const at = now().getTime();
    if (at - held.validatedAt < ttlMs / 2) return held;
    const fresh: Held = { ...held, validatedAt: at };
    cache.invalidateActor(scope.actor.userId);
    void cache.getOrLoad(scope, () => Promise.resolve(fresh));
    return fresh;
  };
  /** The last probe per actor: its epoch and when it was taken. */
  const verified = new Map<string, { epoch: string; at: number }>();
  const keyOf = (actor: ActorContext): string =>
    [
      actor.tenantId,
      actor.userId,
      actor.organisationId ?? "-",
      actor.membershipId ?? "-",
    ].join("|");
  const scopeOf = (actor: ActorContext, epoch: string): ContextCacheScope => ({
    actor,
    authzEpoch: epoch,
    kind: ARRIVAL_SNAPSHOT_CACHE_KIND,
    sensitivity: "CONFIDENTIAL",
    policyVersion: String(Q_CONTEXT_FIREWALL_POLICY_VERSION),
  });

  async function build(
    actor: ActorContext,
    stamp: string,
  ): Promise<Held | null> {
    const at = now();
    const [report, briefs] = await Promise.all([
      dependencies.attention(actor, {
        now: at,
        since: new Date(at.getTime() - DAY_MS),
      }),
      dependencies.briefs(actor).catch(() => null),
    ]);
    return {
      snapshot: buildArrivalSnapshot({ report, briefs, now: at }),
      stamp,
      validatedAt: at.getTime(),
    };
  }

  /** The latest edition's stories per actor, kept briefly. */
  const dailyHeld = new Map<
    string,
    { at: number; stories: readonly ArrivalDailyStory[] }
  >();
  const DAILY_TRUST_MS = 60_000;
  /**
   * Read beside the snapshot, never after it (speed lane 2026-10-20: the
   * edition read waited for the probe and any build first). A failed read
   * is "none": the welcome says no news, never invents.
   */
  async function dailyStories(
    actor: ActorContext,
  ): Promise<readonly ArrivalDailyStory[]> {
    if (dependencies.daily === undefined || actor.actorType !== "HUMAN") {
      return [];
    }
    const key = keyOf(actor);
    const at = now().getTime();
    let held = dailyHeld.get(key);
    if (held === undefined || at - held.at >= DAILY_TRUST_MS) {
      const edition = await dependencies.daily(actor).catch(() => null);
      held = { at, stories: dailyStoriesOf(edition, now()) };
      dailyHeld.set(key, held);
      while (dailyHeld.size > 500) {
        const oldest = dailyHeld.keys().next().value;
        if (oldest === undefined) break;
        dailyHeld.delete(oldest);
      }
    }
    return held.stories;
  }
  function withDaily(
    snapshot: ArrivalSnapshot,
    stories: readonly ArrivalDailyStory[],
  ): ArrivalSnapshot {
    if (stories.length === 0) return snapshot;
    return {
      ...snapshot,
      contractVersion: ARRIVAL_SNAPSHOT_VERSION,
      version: createHash("sha256")
        .update(
          `${snapshot.version}|${stories.map((one) => one.storyId).join(",")}`,
        )
        .digest("hex")
        .slice(0, 32),
      daily: [...stories],
    };
  }
  const forActorCore = async (
    actor: ActorContext,
  ): Promise<ArrivalSnapshot | null> => {
    {
      if (actor.actorType !== "HUMAN") return null;
      const key = keyOf(actor);
      const known = verified.get(key);
      // Zero database round trips: a probe taken moments ago still holds.
      if (known !== undefined && now().getTime() - known.at < trustMs) {
        const held = cache.get(scopeOf(actor, known.epoch));
        if (held !== undefined) return held.snapshot;
      }
      const probed = await dependencies.probe(actor);
      const scope = scopeOf(actor, probed.epoch);
      const held = cache.get(scope);
      if (held !== undefined && held.stamp === probed.stamp) {
        verified.set(key, { epoch: probed.epoch, at: now().getTime() });
        return renewed(scope, held).snapshot;
      }
      // Changed data or access: nothing old is served.
      if (held !== undefined) cache.invalidateActor(actor.userId);
      verified.delete(key);
      const fresh = await cache.getOrLoad(scope, async () => {
        const built = await build(actor, probed.stamp);
        if (built === null) throw new Error("arrival snapshot unavailable");
        return built;
      });
      verified.set(key, { epoch: probed.epoch, at: now().getTime() });
      return fresh.snapshot;
    }
  };
  /** Bumped by every invalidation, so a rebuild begun before one is distrusted. */
  const generations = new Map<string, number>();
  const invalidateActor = (userId: string): number => {
    generations.set(userId, (generations.get(userId) ?? 0) + 1);
    for (const key of [...dailyHeld.keys()]) {
      if (key.split("|")[1] === userId) dailyHeld.delete(key);
    }
    for (const key of [...verified.keys()]) {
      if (key.split("|")[1] === userId) verified.delete(key);
    }
    return cache.invalidateActor(userId);
  };
  /** Background rebuilds in flight, one per actor. */
  const rebuilding = new Map<string, Promise<void>>();
  return {
    forActor: async (actor) => {
      const [base, stories] = await Promise.all([
        forActorCore(actor),
        dailyStories(actor),
      ]);
      return base === null ? null : withDaily(base, stories);
    },
    refreshAfterWrite: (actor) => {
      invalidateActor(actor.userId);
      const key = keyOf(actor);
      if (actor.actorType !== "HUMAN" || rebuilding.has(key)) return;
      const generation = generations.get(actor.userId) ?? 0;
      const work = forActorCore(actor)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          rebuilding.delete(key);
          // Another write landed while it was built: the entry may predate
          // it, so the next read must probe (its stamp decides) rather than
          // trust the window.
          if ((generations.get(actor.userId) ?? 0) !== generation) {
            verified.delete(key);
          }
        });
      rebuilding.set(key, work);
    },
    settled: async () => {
      await Promise.all([...rebuilding.values()]);
    },
    invalidateActor,
    invalidateOrganisation: (organisationId) => {
      for (const key of [...verified.keys()]) {
        if (key.split("|")[2] === organisationId) verified.delete(key);
      }
      return cache.invalidateOrganisation(organisationId);
    },
  };
}
