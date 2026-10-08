"use server";

import { z } from "zod";

import { getQWorkSince } from "@capital-q/api-client";
import type {
  ChatThreadDto,
  QApprovalView,
  QWorkSinceDto,
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
import { qApiSession } from "@/features/q/context";
import { decisionGroups, decisionTitle } from "@/features/work/decisions";
import { retryHeldAction } from "@/features/work/held-actions";
import { readPlan } from "@/features/work/plan-words";
import { listDoneAction } from "@/features/work/work-page-actions";
import { loadWorkforceAction } from "@/features/work/workforce-actions";

import type { ArrivalCard, ArrivalData } from "./arrival";

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

/**
 * Everything the briefing needs, read in parallel. A read that fails is
 * absent (null activity, fewer cards), never an error that stops Q.
 */
export async function arrivalBriefingAction(
  rawSince: string | null,
): Promise<ArrivalData | null> {
  const parsed = SinceInput.safeParse(rawSince);
  if (!parsed.success) return null;
  const session = await qApiSession();
  if (session === null) return null;
  const now = Date.now();
  const since = parsed.data ?? new Date(now - 24 * 3_600_000).toISOString();
  const [account, sinceRead, approvals, workforce, done] = await Promise.all([
    accountDetails().catch(() => null),
    getQWorkSince(session, since).catch(() => null),
    pendingQApprovalsAction().catch(() => null),
    loadWorkforceAction().catch(() => null),
    listDoneAction().catch(() => null),
  ]);
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
