import type {
  ArrivalSnapshot,
  ChatThreadDto,
  NotificationDto,
  QApprovalView,
  QAttentionReport,
  QPendingApproval,
  QWorkDoneItemDto,
  QWorkSinceDto,
  ReadinessDto,
  ReadinessFollowUp,
} from "@capital-q/contracts";
import type { ArrivalActivity } from "@capital-q/q-core/speech";

import type { OwnContext } from "@/features/q/context";
import {
  decisionGroups,
  decisionTitle,
  relationshipOf,
} from "@/features/work/decisions";
import { readPlan } from "@/features/work/plan-words";
import { groupNotices } from "@/features/work/notice-groups";
import type { WorkforceView } from "@/features/work/workforce-actions";

import type { ArrivalCard, ArrivalData } from "./arrival";
import {
  attentionFromReads,
  attentionFromSnapshot,
  sourceOfNotice,
} from "./attention";
import { founderStartOf } from "./founder-start";
import type { ArrivalMatches } from "./matches";

/**
 * The arrival briefing's reads, put together (arrival-actions.ts wires the
 * person's own session into them). Every read is injected, so the order
 * they run in is a test: a read that fails is null (absent, or named as
 * unread), never an error that stops Q.
 */

/** Cards read in full (exact message and their latest words). */
export const CARDS_MAX = 6;

export type ArrivalReads = {
  readonly account: () => Promise<{
    readonly displayName: string | null;
  } | null>;
  readonly workSince: (since: string) => Promise<QWorkSinceDto | null>;
  /** Null: the approvals could not be read. */
  readonly approvals: () => Promise<readonly QPendingApproval[] | null>;
  readonly approval: (approvalId: string) => Promise<QApprovalView | null>;
  readonly workforce: () => Promise<WorkforceView | null>;
  /** The done list's items; null: not read. */
  readonly done: () => Promise<readonly QWorkDoneItemDto[] | null>;
  /** Their notices; null: not read. */
  readonly notices: () => Promise<readonly NotificationDto[] | null>;
  readonly context: () => Promise<OwnContext | null>;
  /** Investors only. */
  readonly matches: (
    seen: ReadonlySet<string> | null,
  ) => Promise<ArrivalMatches | null>;
  /** Founders only (Q.01). */
  readonly questions: () => Promise<readonly ReadinessFollowUp[] | null>;
  /** Founders only: their stored readiness, for Q's first answer. */
  readonly readiness?: (() => Promise<ReadinessDto | null>) | undefined;
  /** Founders only (lead 2026-10-16). */
  readonly deckReview: () => Promise<{
    readonly pending: number;
    readonly href: string;
  } | null>;
  readonly thread: (relationshipId: string) => Promise<ChatThreadDto | null>;
  readonly snapshot: () => Promise<ArrivalSnapshot | null>;
  readonly attention: (since: string) => Promise<QAttentionReport | null>;
};

export type ArrivalReadInput = {
  readonly now: number;
  readonly since: string;
  readonly hoursAway: number | null;
  readonly seenMatches: readonly string[] | null | undefined;
  readonly dismissedHeld: readonly string[];
  /** When given: when each read settled, in ms from the start. */
  readonly timings?: Record<string, number> | undefined;
};

function firstNameOf(display: string | null | undefined): string | null {
  const first = display?.trim().split(/\s+/u)[0];
  return first === undefined || first.length === 0 ? null : first.slice(0, 40);
}

/** Their words since we last wrote, newest last; null when we wrote last. */
function theirLatest(thread: ChatThreadDto | null): string | null {
  if (thread === null) return null;
  const messages = [...thread.messages]
    .filter((message) => !message.unsent)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = messages.at(-1);
  if (last === undefined || last.mine) return null;
  return last.body;
}

/** The exact content an approval binds to, as the person is shown it. */
export function shownOf(view: QApprovalView | null): {
  readonly message: string | null;
  readonly preview: string | null;
} {
  if (view === null) return { message: null, preview: null };
  if (view.action.actionType === "chat.message.send") {
    return { message: readPlan(view.action.preview).quote, preview: null };
  }
  return { message: null, preview: view.action.preview ?? null };
}

function activityOf(since: QWorkSinceDto | null): ArrivalActivity | null {
  if (since === null) return null;
  return {
    sent: since.sent,
    booked: since.booked,
    interest: since.interest,
    held: since.held,
    replies: since.replies,
    matches: since.matches,
  };
}

/** What their agents finished in the window, from the jobs read. */
function jobsDoneOf(
  workforce: WorkforceView | null,
  since: string,
): { readonly n: number; readonly names: readonly string[] } | null {
  if (workforce === null) return null;
  const from = Date.parse(since);
  const done = workforce.jobs.filter(
    ({ job }) => job.status === "DONE" && Date.parse(job.updatedAt) >= from,
  );
  return {
    n: done.length,
    names: done.slice(0, 3).map(({ job }) => job.goal.slice(0, 120)),
  };
}

/**
 * Everything the briefing needs. A read that fails is absent (null
 * activity, fewer cards) and, for what needs them, named as unread.
 */
export async function readArrival(
  reads: ArrivalReads,
  input: ArrivalReadInput,
): Promise<ArrivalData> {
  const { now, since } = input;
  const started = Date.now();
  const safe = <T>(name: string, read: () => Promise<T>): Promise<T | null> =>
    Promise.resolve()
      .then(read)
      .catch(() => null)
      .finally(() => {
        if (input.timings !== undefined) {
          input.timings[name] = Date.now() - started;
        }
      });
  const seen =
    input.seenMatches === null || input.seenMatches === undefined
      ? null
      : new Set(input.seenMatches);
  // Speed lane 2026-10-20: each read starts the moment what it needs is
  // known, and nothing waits on a read it does not use. They used to run in
  // rounds (all seven, then matches, then readiness, then the deck, then
  // the approvals' content, then the threads): the slowest of each round
  // added up.
  const snapshotRead = safe("snapshot", () => reads.snapshot());
  // The snapshot carries the attention report; the separate report (a
  // second build of the same sources on the Q API) only when it did not.
  const attentionRead = snapshotRead.then((snapshot) =>
    snapshot === null ? safe("attention", () => reads.attention(since)) : null,
  );
  const accountRead = safe("account", () => reads.account());
  const workSinceRead = safe("workSince", () => reads.workSince(since));
  const workforceRead = safe("workforce", () => reads.workforce());
  const doneRead = safe("done", () => reads.done());
  const noticesRead = safe("notices", () => reads.notices());
  const contextRead = safe("context", () => reads.context());
  // Investors only, once the context is known: the slate is theirs.
  const matchesRead = contextRead.then((context) =>
    context?.kind === "INVESTOR"
      ? safe("matches", () => reads.matches(seen))
      : undefined,
  );
  // Founders (Q.01): the questions Q still has for them, answerable here;
  // and (lead 2026-10-16) deck sections Q read, not yet checked.
  const questionsRead = contextRead.then((context) =>
    context?.kind === "FOUNDER"
      ? safe("questions", () => reads.questions())
      : undefined,
  );
  // Founders: their readiness, for Q's first answer (founder-start.ts).
  const readinessOf = reads.readiness;
  const readinessRead = contextRead.then((context) =>
    context?.kind === "FOUNDER" && readinessOf !== undefined
      ? safe("readiness", readinessOf)
      : undefined,
  );
  const deckRead = contextRead.then((context) =>
    context?.kind === "FOUNDER"
      ? safe("deckReview", () => reads.deckReview())
      : undefined,
  );
  const threads = new Map<string, Promise<ChatThreadDto | null>>();
  const threadOf = (relationshipId: string) => {
    let thread = threads.get(relationshipId);
    if (thread === undefined) {
      thread = safe(`thread:${relationshipId}`, () =>
        reads.thread(relationshipId),
      );
      threads.set(relationshipId, thread);
    }
    return thread;
  };
  const approvalsRead = safe("approvals", () => reads.approvals());
  // An approval's content as soon as the list is in; its thread as soon as
  // the content names the relationship (the card's group takes the same
  // relationship, decisions.ts `relationshipOf`).
  const viewsRead = approvalsRead.then((approvals) =>
    Promise.all(
      (approvals ?? []).slice(0, CARDS_MAX).map((approval) =>
        safe(`approval:${approval.approvalId}`, () =>
          reads.approval(approval.approvalId),
        ).then((view) => {
          const relationshipId = relationshipOf(view);
          if (relationshipId !== null) void threadOf(relationshipId);
          return view;
        }),
      ),
    ),
  );
  const [approvals, read, workforce, done, notices] = await Promise.all([
    approvalsRead,
    viewsRead,
    workforceRead,
    doneRead,
    noticesRead,
  ]);
  const needsYouNotices =
    notices === null
      ? null
      : groupNotices(notices).needsYou.map((group) => group.notice);
  const waitingNotices = (needsYouNotices ?? []).map((notice) => notice.title);
  const waiting = approvals ?? [];
  const views = new Map<string, QApprovalView>();
  for (const view of read) {
    if (view !== null) views.set(view.approvalId, view);
  }
  const groups = decisionGroups({
    approvals: waiting,
    views,
    jobs: workforce?.jobs ?? [],
    now,
    known: done ?? undefined,
    // Dropped on Work stays dropped here (audit D-E6).
    dismissedHeld: new Set(input.dismissedHeld),
  });
  // One card per decision, in the queue's order, bounded.
  const flat = groups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .slice(0, CARDS_MAX);
  const cards = await Promise.all(
    flat.map(async ({ group, item }): Promise<ArrivalCard> => {
      const theySaid =
        group.relationshipId === null
          ? null
          : theirLatest(await threadOf(group.relationshipId));
      if (item.kind === "HELD") {
        return {
          key: item.draftId,
          kind: "HELD",
          approvalId: null,
          draftId: item.draftId,
          relationshipId: group.relationshipId,
          counterpart: group.name,
          named: group.named,
          title: decisionTitle(item),
          summary: item.reason,
          message: item.body,
          theySaid,
          reason: item.reason,
          canDecide: true,
          at: item.at,
        };
      }
      const shown = shownOf(item.view);
      return {
        key: item.approvalId,
        kind: "APPROVAL",
        approvalId: item.approvalId,
        draftId: null,
        relationshipId: group.relationshipId,
        counterpart: group.name,
        named: group.named,
        title: decisionTitle(item),
        summary: item.summary,
        message: shown.message,
        theySaid,
        reason: shown.preview,
        // Never decided unseen: a card whose content could not be read is
        // decided on Work, where it is read in full.
        canDecide: item.view?.canDecide === true,
        at: item.at,
      };
    }),
  );
  const [
    account,
    sinceRead,
    matches,
    questions,
    deckReview,
    snapshot,
    readiness,
  ] = await Promise.all([
    accountRead,
    workSinceRead,
    matchesRead,
    questionsRead,
    deckRead,
    snapshotRead,
    readinessRead,
  ]);
  const start =
    readiness === undefined || readiness === null
      ? null
      : founderStartOf(
          readiness,
          (workforce?.jobs ?? []).map(({ job }) => ({
            status: job.status,
            goal: job.goal,
          })),
        );
  return {
    firstName: firstNameOf(account?.displayName),
    timeZone: sinceRead?.timeZone ?? null,
    activity: activityOf(sinceRead),
    hoursAway: input.hoursAway,
    cards,
    waiting: waitingNotices,
    // E2: one report of what needs them, unread sources named: workstream
    // B's read when it answered, else the bridge from this page's reads.
    attention:
      (snapshot === null ? null : attentionFromSnapshot(snapshot)) ??
      (await attentionRead) ??
      attentionFromReads({
        cards: approvals === null ? null : cards,
        notices: needsYouNotices,
        jobs: workforce?.jobs ?? null,
        newMatches:
          matches === undefined ? undefined : (matches?.total ?? null),
        since,
        now: new Date(now),
      }),
    ...(snapshot === null ? {} : { snapshot }),
    attentionLinks: Object.fromEntries(
      (needsYouNotices ?? []).flatMap((notice) =>
        notice.linkPath === null
          ? []
          : [
              [
                `${sourceOfNotice(notice.kind)}:${notice.id}`.slice(0, 160),
                notice.linkPath,
              ],
            ],
      ),
    ),
    jobsDone: jobsDoneOf(workforce, since),
    ...(matches === undefined ? {} : { matches }),
    ...(questions === undefined ? {} : { questions }),
    ...(deckReview === undefined || deckReview === null
      ? {}
      : { deckReview: { pending: deckReview.pending, href: deckReview.href } }),
    ...(start === null ? {} : { start }),
  };
}
