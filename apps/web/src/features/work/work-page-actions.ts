"use server";

import { z } from "zod";

import {
  ApiProblemError,
  dismissQWorkSuggestion,
  getQRun,
  listPendingQApprovals,
  listQWorkDone,
  listQWorkSuggestions,
  setQWorkPaused,
  type ApiSession,
} from "@capital-q/api-client";
import {
  isTerminalQRunStatus,
  QWorkSuggestionKeySchema,
  type QWorkDonePageDto,
  type QWorkSuggestionDto,
} from "@capital-q/contracts";

import { apiSession, qApiSession } from "@/features/q/context";

/**
 * Q's work page (WORK-58), server side. The session token never reaches
 * the browser; ids and keys are input, exactly as they are to the APIs,
 * which answer only for the person's own rows.
 */

export type PageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const NOT_FOUND = { ok: false, message: "That isn't available." } as const;

async function run<T>(
  session: ApiSession | null,
  work: (session: ApiSession) => Promise<T>,
  failed: string,
): Promise<PageResult<T>> {
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : failed,
    };
  }
}

/** What Q suggests, read by code from their own account; no model runs. */
export async function listSuggestionsAction(): Promise<
  PageResult<readonly QWorkSuggestionDto[]>
> {
  return run(
    await qApiSession(),
    async (session) => (await listQWorkSuggestions(session)).items,
    "Suggestions couldn't load.",
  );
}

/** "Not now": the card does not come back. */
export async function dismissSuggestionAction(
  key: string,
): Promise<PageResult<null>> {
  const parsed = QWorkSuggestionKeySchema.safeParse(key);
  if (!parsed.success) return NOT_FOUND;
  return run(
    await apiSession(),
    async (session) => {
      await dismissQWorkSuggestion(session, parsed.data);
      return null;
    },
    "That didn't save. Try again.",
  );
}

/** Pause, or resume one they paused themselves. */
export async function setPausedAction(
  delegationId: string,
  paused: boolean,
): Promise<PageResult<null>> {
  const id = Id.safeParse(delegationId);
  if (!id.success) return NOT_FOUND;
  return run(
    await apiSession(),
    async (session) => {
      await setQWorkPaused(session, id.data, paused === true);
      return null;
    },
    paused ? "Q couldn't pause that. Try again." : "Q couldn't resume that.",
  );
}

/** What Q finished, a page at a time. */
export async function listDoneAction(
  cursor?: string,
): Promise<PageResult<QWorkDonePageDto>> {
  const parsed =
    cursor === undefined ? undefined : z.string().max(200).safeParse(cursor);
  if (parsed !== undefined && !parsed.success) return NOT_FOUND;
  return run(
    await qApiSession(),
    (session) =>
      listQWorkDone(session, {
        cursor: parsed?.data,
        limit: 10,
      }),
    "This couldn't load.",
  );
}

/**
 * Where a task or a tapped suggestion stands once Q was asked to prepare
 * it: still working, a card waiting for their yes (the normal approval),
 * an answer without a card, or failed. Read from the run and the
 * person's own pending approvals; nothing is decided here.
 */
export type Prepared =
  | { readonly state: "WORKING" }
  | { readonly state: "APPROVAL"; readonly approvalId: string }
  | {
      readonly state: "ANSWER";
      readonly text: string;
      readonly conversationId: string | null;
    }
  | { readonly state: "FAILED" };

export async function preparedAction(
  runId: string,
): Promise<PageResult<Prepared>> {
  const id = Id.safeParse(runId);
  if (!id.success) return NOT_FOUND;
  return run(
    await qApiSession(),
    async (session): Promise<Prepared> => {
      const summary = await getQRun(session, id.data);
      if (
        summary.status === "AWAITING_APPROVAL" ||
        isTerminalQRunStatus(summary.status)
      ) {
        const pending = await listPendingQApprovals(session);
        const card = pending.items.find((item) => item.runId === id.data);
        if (card !== undefined) {
          return { state: "APPROVAL", approvalId: card.approvalId };
        }
      }
      if (summary.status === "FAILED" || summary.status === "EXPIRED") {
        return { state: "FAILED" };
      }
      if (
        summary.status === "AWAITING_INPUT" ||
        isTerminalQRunStatus(summary.status)
      ) {
        const said = [...(summary.messages ?? [])]
          .reverse()
          .find((message) => message.role === "Q" && message.text);
        return {
          state: "ANSWER",
          text:
            said?.role === "Q" && said.text !== undefined
              ? said.text.slice(0, 600)
              : "Q answered on the Q page.",
          conversationId: summary.conversationId ?? null,
        };
      }
      return { state: "WORKING" };
    },
    "Q couldn't prepare that just now.",
  );
}
