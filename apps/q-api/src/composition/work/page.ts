import {
  Q_WORK_DONE_PAGE_MAX,
  Q_WORK_SUGGESTION_KINDS,
  Q_WORK_SUGGESTIONS_MAX,
  type QWorkDonePageDto,
  type QWorkSuggestionDto,
  type QWorkSuggestionKind,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { NUDGE_AFTER_DAYS } from "../waiting.js";

/**
 * Q's work page (WORK-58): what Q suggests and what Q finished.
 *
 * Suggestions are composed by code from the person's OWN account signals:
 * their side's relationships (the Network context's own fold), their feed
 * and saved list, calls they were on, their company's documents, their
 * organisation's mandate. No model runs here, and nothing about the other
 * side is read beyond the name the person already sees on their own
 * relationships page, so founder-private facts never reach an investor's
 * card (or the reverse). Ranking is deterministic: kinds in contract
 * order, the oldest wait first within a kind, one card per kind before a
 * second, at most five. What is already waiting for approval, already in
 * running work, or set aside ("Not now") is not suggested again.
 */

const DAY_MS = 24 * 3_600_000;
/** A call is recent enough to recap for three days after it ends. */
const RECAP_WITHIN_DAYS = 3;
/** A pending card older than this no longer hides a suggestion. */
const PENDING_WITHIN_DAYS = 30;

export type SuggestionRelationship = {
  readonly relationshipId: string;
  readonly counterpartKind: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly counterpartId: string;
  readonly name: string;
  readonly nextStep: string;
  readonly stateSince: string;
};

export type SuggestionFacts = {
  readonly relationships: readonly SuggestionRelationship[];
  /** Investor: companies in their feed with no relationship and no decision. */
  readonly feedUncontacted: number;
  /** Investor: saved, never contacted. */
  readonly savedNoInterest: readonly {
    readonly companyId: string;
    readonly name: string;
  }[];
  /**
   * Calls they were on that ended recently. `followedUp` is true once the
   * person wrote to that side after the call (the recap went) or Q already
   * proposed that call's own follow-up cards: either way, no recap card.
   */
  readonly callsEnded: readonly {
    readonly meetingId: string;
    readonly relationshipId: string;
    readonly endedAt: string;
    readonly followedUp: boolean;
  }[];
  /** Founder: their company has a deck and none is shared with investors. */
  readonly deckUnshared: boolean;
  /** Investor: the declared mandate fields left empty, in plain words. */
  readonly mandateGaps: readonly string[];
  /** Relationship and company ids already in a pending card or running work. */
  readonly busy: ReadonlySet<string>;
  /** An outreach of theirs is running: it already looks for founders. */
  readonly outreachRunning: boolean;
  readonly dismissed: ReadonlySet<string>;
};

const RANK: Readonly<Record<QWorkSuggestionKind, number>> = Object.fromEntries(
  Q_WORK_SUGGESTION_KINDS.map((kind, index) => [kind, index]),
) as Record<QWorkSuggestionKind, number>;

function days(from: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / DAY_MS));
}

function relationshipPath(item: SuggestionRelationship): string {
  return item.counterpartKind === "COMPANY"
    ? `/relationships/company/${item.counterpartId}`
    : `/relationships/investor/${item.counterpartId}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

type Candidate = QWorkSuggestionDto & { readonly age: number };

/** Pure: the cards for these facts, ranked and capped. */
export function composeSuggestions(
  facts: SuggestionFacts,
  now: Date,
): readonly QWorkSuggestionDto[] {
  const out: Candidate[] = [];
  const byId = new Map(
    facts.relationships.map((item) => [item.relationshipId, item]),
  );
  const free = (item: SuggestionRelationship) =>
    !facts.busy.has(item.relationshipId) && !facts.busy.has(item.counterpartId);

  for (const item of facts.relationships) {
    if (!free(item)) continue;
    const age = days(item.stateSince, now);
    if (item.nextStep === "ANSWER_INTEREST") {
      out.push({
        key: `connect_waiting:${item.relationshipId}`,
        kind: "CONNECT_WAITING",
        lead: age,
        unit: plural(age, "day", "days"),
        subject: `${item.name} wants to connect`.slice(0, 120),
        question: "Answer?",
        prompt:
          `${item.name} asked to connect ${String(age)} ${plural(age, "day", "days")} ago. Tell me what you know about them and prepare my answer for me to approve.`.slice(
            0,
            400,
          ),
        linkPath: relationshipPath(item),
        age,
      });
    } else if (item.nextStep === "AWAIT_ANSWER" && age >= NUDGE_AFTER_DAYS) {
      out.push({
        key: `stalled_reply:${item.relationshipId}`,
        kind: "STALLED_REPLY",
        lead: age,
        unit: "days",
        subject: `${item.name} hasn’t replied`.slice(0, 120),
        question: "Follow up?",
        prompt:
          `${item.name} hasn't replied in ${String(age)} days. Prepare a short, polite follow-up message to them for me to approve.`.slice(
            0,
            400,
          ),
        linkPath: relationshipPath(item),
        age,
      });
    }
  }

  // One card per counterpart, never one per row: a meeting read twice (a
  // person on it twice) is one call, and several calls with the same side
  // are one "Send recaps?" card. A dismissal covers every call with that
  // side that had ended by then; a newer call asks again.
  const calls = new Map<string, Map<string, number>>();
  const dismissedUntil = new Map<string, number>();
  const dismissedMeetings = new Set<string>();
  for (const key of facts.dismissed) {
    const parts = key.split(":");
    if (parts[0] !== "call_recap") continue;
    if (parts.length === 2 && parts[1] !== undefined) {
      dismissedMeetings.add(parts[1]);
    } else if (parts.length === 3 && parts[1] !== undefined) {
      const minute = Number(parts[2]);
      if (!Number.isFinite(minute)) continue;
      dismissedUntil.set(
        parts[1],
        Math.max(dismissedUntil.get(parts[1]) ?? 0, minute * 60_000),
      );
    }
  }
  for (const call of facts.callsEnded) {
    if (call.followedUp || dismissedMeetings.has(call.meetingId)) continue;
    const endedMs = Date.parse(call.endedAt);
    if (endedMs <= (dismissedUntil.get(call.relationshipId) ?? -1)) continue;
    const group = calls.get(call.relationshipId) ?? new Map<string, number>();
    group.set(
      call.meetingId,
      Math.max(group.get(call.meetingId) ?? 0, endedMs),
    );
    calls.set(call.relationshipId, group);
  }
  for (const [relationshipId, group] of calls) {
    const item = byId.get(relationshipId);
    if (item === undefined || !free(item)) continue;
    const latest = Math.max(...group.values());
    const count = group.size;
    const age = days(new Date(latest).toISOString(), now);
    const when =
      age === 0 ? "today" : age === 1 ? "yesterday" : `${String(age)} days ago`;
    out.push({
      key: `call_recap:${relationshipId}:${String(Math.floor(latest / 60_000))}`,
      kind: "CALL_RECAP",
      lead: count,
      unit: plural(count, "call", "calls"),
      subject: (count === 1
        ? `${item.name} call ended ${when}`
        : `${String(count)} calls with ${item.name}`
      ).slice(0, 120),
      question: count === 1 ? "Send the recap?" : "Send recaps?",
      prompt: (count === 1
        ? `Prepare a short recap of my call with ${item.name}, from the call's notes, as a message to them for me to approve.`
        : `Prepare one short recap of my last ${String(count)} calls with ${item.name}, from the calls' notes, as a message to them for me to approve.`
      ).slice(0, 400),
      linkPath: relationshipPath(item),
      age,
    });
  }

  if (!facts.outreachRunning && facts.feedUncontacted > 0) {
    out.push({
      key: "new_matches:feed",
      kind: "NEW_MATCHES",
      lead: facts.feedUncontacted,
      unit: "match",
      subject: `${plural(facts.feedUncontacted, "Founder", "Founders")} fit your mandate`,
      question: "Prepare intros?",
      prompt: `Find up to ${String(Math.min(3, facts.feedUncontacted))} founders in my Discover feed who fit my mandate, and prepare intros to them for me to approve.`,
      linkPath: "/discover",
      age: 0,
    });
  }

  const saved = facts.savedNoInterest.filter(
    (entry) => !facts.busy.has(entry.companyId),
  );
  if (!facts.outreachRunning && saved.length > 0) {
    out.push({
      key: "saved_no_interest:saved",
      kind: "SAVED_NO_INTEREST",
      lead: saved.length,
      unit: "saved",
      subject: "Saved, no interest sent",
      question: "Express interest?",
      prompt: `I saved ${saved
        .slice(0, 5)
        .map((entry) => entry.name)
        .join(
          ", ",
        )} but haven't contacted them. Prepare expressing interest in them for me to approve.`.slice(
        0,
        400,
      ),
      linkPath: "/discover/saved",
      age: 0,
    });
  }

  if (facts.deckUnshared) {
    out.push({
      key: "deck_unshared:deck",
      kind: "DECK_UNSHARED",
      lead: 0,
      unit: "shared",
      subject: "Your deck isn’t shared with investors",
      question: "Share it?",
      prompt:
        "My pitch deck isn't shared with investors. Prepare sharing it with the investors who can see my company, for me to approve.",
      linkPath: "/documents",
      age: 0,
    });
  }

  if (facts.mandateGaps.length > 0) {
    out.push({
      key: "mandate_gaps:mandate",
      kind: "MANDATE_GAPS",
      lead: facts.mandateGaps.length,
      unit: plural(facts.mandateGaps.length, "gap", "gaps"),
      subject: `Mandate: ${facts.mandateGaps.join(", ")}`.slice(0, 120),
      question: "Fill them in?",
      prompt: `My mandate is missing ${facts.mandateGaps.join(", ")}. Ask me for them, or read them from what you already have, and prepare the change for me to approve.`,
      linkPath: "/profile",
      age: 0,
    });
  }

  const ranked = out
    .filter((item) => !facts.dismissed.has(item.key))
    .sort(
      (a, b) =>
        RANK[a.kind] - RANK[b.kind] ||
        b.age - a.age ||
        a.key.localeCompare(b.key),
    );
  // One card per kind first, then the rest in the same order.
  const firsts: Candidate[] = [];
  const seconds: Candidate[] = [];
  const seen = new Set<QWorkSuggestionKind>();
  for (const item of ranked) {
    (seen.has(item.kind) ? seconds : firsts).push(item);
    seen.add(item.kind);
  }
  return [...firsts, ...seconds]
    .slice(0, Q_WORK_SUGGESTIONS_MAX)
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.age - a.age)
    .map(({ age: _age, ...item }) => item);
}

// ---------------------------------------------------------------------------
// The reads: the person's own rows, each predicate their own id
// ---------------------------------------------------------------------------

export type WorkPageReads = {
  /** The Network context's own fold of their side's relationships. */
  readonly relationships: (
    actor: ActorContext,
  ) => Promise<readonly SuggestionRelationship[]>;
  /** Investor: their feed (null when they are not on an investor's side). */
  readonly feed: (
    actor: ActorContext,
  ) => Promise<readonly { readonly companyId: string }[] | null>;
  readonly decisions: (actor: ActorContext) => Promise<
    readonly {
      readonly companyId: string;
      readonly name: string;
      readonly decision: "SAVED" | "PASSED";
    }[]
  >;
  readonly investorOrganisation: (
    actor: ActorContext,
  ) => Promise<string | null>;
  readonly ownCompany: (actor: ActorContext) => Promise<string | null>;
};

const quiet =
  <T>(fallback: T) =>
  (): T =>
    fallback;

export function createWorkPage(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly reads: WorkPageReads;
  readonly now?: (() => Date) | undefined;
}) {
  const { sql, reads } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const mandateGaps = async (organisationId: string | null) => {
    if (organisationId === null) return [];
    const rows = await sql<
      {
        has_cheque: boolean;
        has_stage: boolean;
        dimensions: string[] | null;
      }[]
    >`
      select (m.min_cheque is not null or m.max_cheque is not null) as has_cheque,
             (m.min_stage_code is not null or m.max_stage_code is not null) as has_stage,
             (select array_agg(distinct c.dimension) from core.investor_mandate_constraints c
               where c.mandate_id = m.id) as dimensions
        from core.investor_mandates m
       where m.investor_organisation_id = ${organisationId}
         and m.status in ('ACTIVE', 'DRAFT')
       order by (m.status = 'ACTIVE') desc, m.updated_at desc
       limit 1`;
    const row = rows[0];
    if (row === undefined) return [];
    const dims = new Set(row.dimensions ?? []);
    return [
      row.has_cheque || dims.has("cheque.typical") ? null : "cheque size",
      row.has_stage || dims.has("stage") ? null : "stage",
      dims.has("sector") ? null : "sectors",
      dims.has("geography.country") ? null : "countries",
    ].filter((gap): gap is string => gap !== null);
  };

  return {
    suggestions: async (
      actor: ActorContext,
    ): Promise<readonly QWorkSuggestionDto[]> => {
      const current = now();
      const [relationships, organisationId, companyId] = await Promise.all([
        reads.relationships(actor).catch(quiet([])),
        reads.investorOrganisation(actor).catch(quiet(null)),
        reads.ownCompany(actor).catch(quiet(null)),
      ]);
      const investor = organisationId !== null;
      const [feed, decisions, calls, deck, gaps, pending, running, dismissed] =
        await Promise.all([
          investor ? reads.feed(actor).catch(quiet(null)) : null,
          investor ? reads.decisions(actor).catch(quiet([])) : [],
          // Each meeting once (never one row per participant row), and
          // whether it is already followed up: the person wrote to that
          // side after it ended, or Q proposed its follow-up cards
          // (meeting-follow-up-cards keys them `meet:<meeting id>:...`).
          sql<
            {
              id: string;
              relationship_id: string;
              ends_at: Date;
              followed_up: boolean;
            }[]
          >`
            select m.id, m.relationship_id, m.ends_at,
                   (exists (
                      select 1 from communication.conversations c
                        join communication.messages x on x.conversation_id = c.id
                       where c.relationship_id = m.relationship_id
                         and x.sender_user_id = ${actor.userId}
                         and x.created_at >= m.ends_at)
                    or exists (
                      select 1 from q_runtime.actions a
                       where a.proposed_by_user_id = ${actor.userId}
                         and a.tenant_id = ${actor.tenantId}
                         and a.proposed_payload->>'idempotencyKey'
                             like 'meet:' || m.id::text || ':%')) as followed_up
              from communication.meetings m
             where exists (
                     select 1 from communication.meeting_participants p
                      where p.meeting_id = m.id and p.user_id = ${actor.userId})
               and m.status = 'SCHEDULED'
               and m.ends_at <= ${current}
               and m.ends_at > ${new Date(current.getTime() - RECAP_WITHIN_DAYS * DAY_MS)}
             order by m.ends_at desc
             limit 20`.catch(quiet([])),
          // Only a founder's own company's documents.
          investor || companyId === null
            ? []
            : sql<{ decks: number; shared: number }[]>`
                select count(*)::int as decks,
                       count(*) filter (where download_audience = 'INVESTORS')::int as shared
                  from evidence.documents
                 where company_id = ${companyId}
                   and document_type = 'PITCH_DECK' and status = 'ACTIVE'`.catch(
                quiet([]),
              ),
          investor ? mandateGaps(organisationId).catch(quiet([])) : [],
          sql<{ target_refs: unknown }[]>`
            select target_refs from q_runtime.actions
             where proposed_by_user_id = ${actor.userId}
               and tenant_id = ${actor.tenantId}
               and status in ('PROPOSED', 'AWAITING_APPROVAL')
               and created_at > ${new Date(current.getTime() - PENDING_WITHIN_DAYS * DAY_MS)}
             limit 100`.catch(quiet([])),
          sql<
            {
              kind: string;
              company_id: string | null;
              relationship_id: string | null;
            }[]
          >`
            select d.kind, l.company_id, l.relationship_id
              from q_runtime.delegations d
              left join q_runtime.delegation_lanes l on l.delegation_id = d.id
             where d.user_id = ${actor.userId} and d.status = 'ACTIVE'
             limit 200`.catch(quiet([])),
          sql<{ suggestion_key: string }[]>`
            select suggestion_key from q_runtime.work_suggestion_dismissals
             where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}`.catch(
            quiet([]),
          ),
        ]);
      const busy = new Set<string>();
      for (const row of pending) {
        if (!Array.isArray(row.target_refs)) continue;
        for (const ref of row.target_refs as unknown[]) {
          if (typeof ref !== "object" || ref === null) continue;
          for (const value of Object.values(ref)) {
            if (typeof value === "string") busy.add(value);
          }
        }
      }
      for (const row of running) {
        if (row.company_id !== null) busy.add(row.company_id);
        if (row.relationship_id !== null) busy.add(row.relationship_id);
      }
      const contacted = new Set(
        relationships
          .filter((item) => item.counterpartKind === "COMPANY")
          .map((item) => item.counterpartId),
      );
      const decided = new Set(decisions.map((entry) => entry.companyId));
      const deckRow = deck[0];
      return composeSuggestions(
        {
          relationships,
          feedUncontacted: (feed ?? []).filter(
            (item) =>
              !contacted.has(item.companyId) && !decided.has(item.companyId),
          ).length,
          savedNoInterest: decisions
            .filter(
              (entry) =>
                entry.decision === "SAVED" && !contacted.has(entry.companyId),
            )
            .map((entry) => ({ companyId: entry.companyId, name: entry.name })),
          callsEnded: calls.map((row) => ({
            meetingId: row.id,
            relationshipId: row.relationship_id,
            endedAt: new Date(row.ends_at).toISOString(),
            followedUp: row.followed_up,
          })),
          deckUnshared:
            deckRow !== undefined && deckRow.decks > 0 && deckRow.shared === 0,
          mandateGaps: gaps,
          busy,
          outreachRunning: running.some(
            (row) => row.kind === "INVESTOR_OUTREACH",
          ),
          dismissed: new Set(dismissed.map((row) => row.suggestion_key)),
        },
        current,
      );
    },

    /**
     * What Q finished for them, newest first, a page at a time (keyset on
     * time and id, never an offset). A line links to what it changed only
     * when that page exists: a relationship from the instruction owner's
     * own side, or the finished work's own page.
     */
    done: async (
      actor: ActorContext,
      query: { readonly cursor?: string | undefined; readonly limit?: number },
    ): Promise<QWorkDonePageDto> => {
      const limit = Math.min(query.limit ?? 10, Q_WORK_DONE_PAGE_MAX);
      const after = decodeCursor(query.cursor);
      const weekAgo = new Date(now().getTime() - 7 * DAY_MS);
      const rows = await sql<
        { id: string; words: string; at: Date; link_path: string | null }[]
      >`
        select * from (
          select s.id, s.words, s.created_at as at,
                 case
                   when r.id is null or i.organisation_id is null then null
                   when r.investor_organisation_id = i.organisation_id
                     then '/relationships/company/' || r.company_id::text
                   else '/relationships/investor/' || r.investor_organisation_id::text
                 end as link_path
            from q_runtime.instruction_steps s
            join q_runtime.standing_instructions i on i.id = s.instruction_id
            left join network.relationships r on r.id = s.relationship_id
           where s.user_id = ${actor.userId} and s.tenant_id = ${actor.tenantId}
             and s.status = 'DONE'
          union all
          select d.id,
                 coalesce(d.summary,
                   case d.kind when 'INVESTOR_OUTREACH' then 'Outreach finished'
                               else 'Stand-in finished' end) as words,
                 d.updated_at as at,
                 '/work/' || d.id::text as link_path
            from q_runtime.delegations d
           where d.user_id = ${actor.userId} and d.tenant_id = ${actor.tenantId}
             and d.status in ('DONE', 'STOPPED', 'EXPIRED', 'FAILED')
        ) done
        where ${after === null}
           or (done.at, done.id) < (${after?.at ?? new Date(0)}::timestamptz, ${after?.id ?? "00000000-0000-0000-0000-000000000000"}::uuid)
        order by done.at desc, done.id desc
        limit ${limit + 1}`;
      const week = await sql<{ n: number }[]>`
        select (
          (select count(*) from q_runtime.instruction_steps s
            where s.user_id = ${actor.userId} and s.tenant_id = ${actor.tenantId}
              and s.status = 'DONE' and s.created_at > ${weekAgo})
          + (select count(*) from q_runtime.delegations d
            where d.user_id = ${actor.userId} and d.tenant_id = ${actor.tenantId}
              and d.status = 'DONE' and d.updated_at > ${weekAgo}))::int as n`;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          id: row.id,
          words: row.words.slice(0, 500),
          at: new Date(row.at).toISOString(),
          linkPath: row.link_path,
        })),
        thisWeek: week[0]?.n ?? 0,
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor(new Date(last.at), last.id)
            : null,
      };
    },
  };
}

export type WorkPage = ReturnType<typeof createWorkPage>;

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

/** A cursor is input: anything malformed starts from the first page. */
export function decodeCursor(
  cursor: string | undefined,
): { readonly at: Date; readonly id: string } | null {
  if (cursor === undefined) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (at === undefined || id === undefined) return null;
  const time = Date.parse(at);
  if (
    Number.isNaN(time) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)
  ) {
    return null;
  }
  return { at: new Date(time), id };
}
