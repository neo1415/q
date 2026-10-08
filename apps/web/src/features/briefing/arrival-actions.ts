"use server";

import { z } from "zod";

import {
  discoverCompanies,
  getQWorkSince,
  listInvestorRelationships,
  readBriefingCommand,
} from "@capital-q/api-client";
import {
  BriefingCommandRequestSchema,
  type BriefingCommandRequest,
  type BriefingCommandResultDto,
  type ChatThreadDto,
  type QApprovalView,
  type QWorkSinceDto,
} from "@capital-q/contracts";
import {
  sameShownMessage,
  type ArrivalActivity,
} from "@capital-q/q-core/speech";

import { accountDetails } from "@/auth/account-details";
import {
  chatThreadAction,
  sendChatMessageAction,
} from "@/features/chat/chat-actions";
import {
  approveQApprovalAction,
  pendingQApprovalsAction,
  readQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";
import { fitProfilesAction } from "@/features/fit/fit-actions";
import { ownReadiness } from "@/features/readiness/readiness-data";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import { decisionGroups, decisionTitle } from "@/features/work/decisions";
import { retryHeldAction } from "@/features/work/held-actions";
import { readPlan } from "@/features/work/plan-words";
import { groupNotices } from "@/features/work/notice-groups";
import { listNoticesAction } from "@/features/work/work-actions";
import { listDoneAction } from "@/features/work/work-page-actions";
import {
  loadWorkforceAction,
  type WorkforceView,
} from "@/features/work/workforce-actions";

import type { ArrivalCard, ArrivalData } from "./arrival";
import {
  attentionFromReads,
  createQApiAttentionReader,
  sourceOfNotice,
} from "./attention";
import {
  ARRIVAL_MATCHES_MAX,
  matchOpinion,
  newMatchesFor,
  type ArrivalMatches,
} from "./matches";

/**
 * The arrival briefing's reads and its one decision path (Zino,
 * 2026-10-08), on the server under the person's own session. The cards
 * are the Work page's decision queue, read the same way (decisions.ts),
 * so the two never disagree about what needs them. Every decision goes
 * through the actions the Work page uses: the Approval Engine's approve
 * and reject (which bind to the payload the server holds), and the
 * person's own message for an edit.
 */

/** Cards read in full (exact message and their latest words). */
const CARDS_MAX = 6;

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
function shownOf(view: QApprovalView | null): {
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

const SinceInput = z.string().datetime({ offset: true }).nullable();
const BrowserInput = z
  .object({
    /** Held drafts this browser dismissed on Work (audit D-E6). */
    dismissedHeld: z.array(z.string().max(80)).max(200).optional(),
    /** Companies earlier arrivals showed here; null: none remembered. */
    seenMatches: z.array(z.string().uuid()).max(200).nullable().optional(),
  })
  .strict()
  .optional();
export type ArrivalBrowserInput = z.input<typeof BrowserInput>;

/** How far into the slate the arrival looks for new matches. */
const SLATE_LOOK = 20;
/** Q.01: the questions put beside Q at once. */
const QUESTIONS_MAX = 5;

/**
 * Investors: the new companies in their own slate that fit their mandate,
 * each with Q's take from its fit profile (one batched read). Null when
 * the slate could not be read; an empty list when nothing is new.
 */
async function readMatches(
  seen: ReadonlySet<string> | null,
): Promise<ArrivalMatches | null> {
  const session = await apiSession();
  if (session === null) return null;
  const [slate, relationships] = await Promise.all([
    discoverCompanies(session, { limit: SLATE_LOOK }).catch(() => null),
    listInvestorRelationships(session).catch(() => null),
  ]);
  if (slate === null) return null;
  const touched = new Set(
    (relationships?.items ?? []).map((item) => item.counterpart.id),
  );
  // Without the relationships read, "not acted on" cannot be claimed.
  if (relationships === null) return null;
  const fresh = newMatchesFor({ items: slate.items, touched, seen });
  const shown = fresh.slice(0, ARRIVAL_MATCHES_MAX);
  const fits =
    shown.length === 0
      ? null
      : await fitProfilesAction(shown.map((item) => item.companyId));
  const profiles = new Map(
    (fits ?? []).map((fit) => [fit.companyId, fit.profile] as const),
  );
  return {
    label: seen === null ? "NOT_LOOKED_AT" : "SINCE_LAST_VISIT",
    total: fresh.length,
    items: shown.map((item) => {
      const profile = profiles.get(item.companyId) ?? null;
      return {
        companyId: item.companyId,
        name: item.canonicalName,
        line: item.shortDescription,
        stage: item.currentStageCode,
        country: item.headquartersCountry,
        band: profile?.band ?? null,
        take: matchOpinion({ profile, reasons: item.reasons }),
      };
    }),
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
 * Everything the briefing needs, read in parallel. A read that fails is
 * absent (null activity, fewer cards) and, for what needs them, named as
 * unread; never an error that stops Q.
 */
export async function arrivalBriefingAction(
  rawSince: string | null,
  rawBrowser?: ArrivalBrowserInput,
): Promise<ArrivalData | null> {
  const parsed = SinceInput.safeParse(rawSince);
  const browser = BrowserInput.safeParse(rawBrowser);
  if (!parsed.success || !browser.success) return null;
  const session = await qApiSession();
  if (session === null) return null;
  const now = Date.now();
  const since = parsed.data ?? new Date(now - 24 * 3_600_000).toISOString();
  const seenMatches = browser.data?.seenMatches;
  // RECOVERY B1: the Q API's attention report (every source, the same read
  // as Q's own answer), beside the arrival's other reads.
  const attentionRead = createQApiAttentionReader(session)(since);
  const [account, sinceRead, approvals, workforce, done, notices, context] =
    await Promise.all([
      accountDetails().catch(() => null),
      getQWorkSince(session, since).catch(() => null),
      pendingQApprovalsAction().catch(() => null),
      loadWorkforceAction().catch(() => null),
      listDoneAction().catch(() => null),
      listNoticesAction().catch(() => null),
      resolveOwnContext().catch(() => null),
    ]);
  // Investors only, and after the context is known: the slate is theirs.
  const matches =
    context?.kind === "INVESTOR"
      ? await readMatches(
          seenMatches === null || seenMatches === undefined
            ? null
            : new Set(seenMatches),
        ).catch(() => null)
      : undefined;
  // Founders (Q.01): the questions Q still has for them, answerable here.
  const questions =
    context?.kind === "FOUNDER"
      ? await ownReadiness()
          .then((readiness) =>
            readiness === null
              ? null
              : readiness.followUps
                  .filter((item) => item.answerable)
                  .slice(0, QUESTIONS_MAX),
          )
          .catch(() => null)
      : undefined;
  const needsYouNotices =
    notices?.ok === true
      ? groupNotices(notices.value.items).needsYou.map((group) => group.notice)
      : null;
  const waitingNotices = (needsYouNotices ?? []).map((notice) => notice.title);
  const waiting = approvals?.ok === true ? approvals.value : [];
  const read = await Promise.all(
    waiting
      .slice(0, CARDS_MAX)
      .map((approval) =>
        readQApprovalAction(approval.approvalId).catch(() => null),
      ),
  );
  const views = new Map<string, QApprovalView>();
  for (const result of read) {
    if (result?.ok === true) views.set(result.value.approvalId, result.value);
  }
  const groups = decisionGroups({
    approvals: waiting,
    views,
    jobs: workforce?.jobs ?? [],
    now,
    known: done?.ok === true ? done.value.items : undefined,
    // Dropped on Work stays dropped here (audit D-E6).
    dismissedHeld: new Set(browser.data?.dismissedHeld ?? []),
  });
  // One card per decision, in the queue's order, bounded.
  const flat = groups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .slice(0, CARDS_MAX);
  const threads = new Map<string, Promise<ChatThreadDto | null>>();
  const threadOf = (relationshipId: string) => {
    let read = threads.get(relationshipId);
    if (read === undefined) {
      read = chatThreadAction(relationshipId)
        .then((result) => (result.ok ? result.value : null))
        .catch(() => null);
      threads.set(relationshipId, read);
    }
    return read;
  };
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
  return {
    firstName: firstNameOf(account?.displayName),
    timeZone: sinceRead?.timeZone ?? null,
    activity: activityOf(sinceRead),
    hoursAway:
      parsed.data === null
        ? null
        : Math.max(0, (now - Date.parse(parsed.data)) / 3_600_000),
    cards,
    waiting: waitingNotices,
    // E2: one report of what needs them, unread sources named: workstream
    // B's read when it answered, else the bridge from this page's reads.
    attention:
      (await attentionRead) ??
      attentionFromReads({
        cards: approvals?.ok === true ? cards : null,
        notices: needsYouNotices,
        jobs: workforce?.jobs ?? null,
        newMatches:
          matches === undefined ? undefined : (matches?.total ?? null),
        since,
        now: new Date(now),
      }),
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
  };
}

const Id = z.string().uuid();
const DecideInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("APPROVE"),
    approvalId: Id,
    /** What the person was shown; the decision is refused if it differs. */
    shown: z.string().max(8_000).nullable(),
  }),
  z.object({
    kind: z.literal("SEND_EDITED"),
    relationshipId: Id,
    body: z.string().trim().min(1).max(4_000),
    idempotencyKey: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/u),
    replacesApprovalId: Id.nullable(),
  }),
  z.object({ kind: z.literal("DISMISS_APPROVAL"), approvalId: Id }),
  z.object({
    kind: z.literal("RETRY_HELD"),
    draftId: Id,
    relationshipId: Id.nullable(),
    idempotencyKey: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/u),
  }),
]);

export type ArrivalDecision = z.input<typeof DecideInput>;

export type ArrivalDecisionResult =
  | {
      readonly ok: true;
      /** What came of it, when more than "done" (a retry's outcome). */
      readonly message?: string | undefined;
      /** New cards may be waiting: read the briefing again. */
      readonly reload?: true | undefined;
    }
  | {
      readonly ok: false;
      readonly message: string;
      /** The card changed since it was shown: read it again. */
      readonly changed?: true;
    };

/**
 * One decision on one card, as the person made it (a button, or their own
 * words read by code). Input from the browser, validated here; the server
 * resolves who they are and verifies its own payload hash on approve.
 */
export async function decideArrivalCardAction(
  raw: ArrivalDecision,
): Promise<ArrivalDecisionResult> {
  const parsed = DecideInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "That didn't go through. Nothing was sent." };
  }
  const input = parsed.data;
  switch (input.kind) {
    case "APPROVE": {
      // Approval binds to exactly what was seen: read it again first.
      const view = await readQApprovalAction(input.approvalId).catch(
        () => null,
      );
      if (view?.ok !== true || !view.value.canDecide) {
        return {
          ok: false,
          message: "Already decided or expired. Nothing more is sent from it.",
          changed: true,
        };
      }
      const now = shownOf(view.value);
      if (!sameShownMessage(input.shown, now.message ?? now.preview)) {
        return {
          ok: false,
          message: "It changed since you saw it. Here's the current version.",
          changed: true,
        };
      }
      const result = await approveQApprovalAction(input.approvalId).catch(
        () => null,
      );
      return result?.ok === true
        ? { ok: true }
        : {
            ok: false,
            message:
              result?.message ?? "That didn't go through. Nothing was sent.",
          };
    }
    case "SEND_EDITED": {
      const sent = await sendChatMessageAction(
        input.relationshipId,
        { kind: "TEXT", body: input.body },
        input.idempotencyKey,
      ).catch(() => null);
      if (sent?.ok !== true) {
        return {
          ok: false,
          message: sent?.message ?? "That didn't send. Try again.",
        };
      }
      // Their own message went; the card Q drafted is declined.
      if (input.replacesApprovalId !== null) {
        await rejectQApprovalAction(input.replacesApprovalId).catch(() => null);
      }
      return { ok: true };
    }
    case "RETRY_HELD": {
      const result = await retryHeldAction({
        draftId: input.draftId,
        relationshipId: input.relationshipId,
        idempotencyKey: input.idempotencyKey,
      });
      return result.ok
        ? { ok: true, message: result.message, reload: true }
        : { ok: false, message: result.message };
    }
    case "DISMISS_APPROVAL": {
      const result = await rejectQApprovalAction(input.approvalId).catch(
        () => null,
      );
      return result?.ok === true
        ? { ok: true }
        : { ok: false, message: "That didn't go through. Try again." };
    }
  }
}

/**
 * The person's own words about the cards on their screen, read into card
 * verbs (Zino, 2026-10-08). Changes nothing: the card sequence in the
 * browser runs each verb and checks it against the same words. A failed
 * read is "unclear", never a guess.
 */
export async function readArrivalWordsAction(
  raw: BriefingCommandRequest,
): Promise<BriefingCommandResultDto> {
  const unclear: BriefingCommandResultDto = { actions: [], unclear: true };
  const parsed = BriefingCommandRequestSchema.safeParse(raw);
  if (!parsed.success) return unclear;
  const session = await qApiSession();
  if (session === null) return unclear;
  return readBriefingCommand(session, parsed.data).catch(() => unclear);
}
