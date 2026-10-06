"use server";

import { z } from "zod";

import {
  ApiProblemError,
  closeCapitalRound,
  confirmCommitmentAmount,
  confirmCommitmentReceived,
  disputeCommitment,
  markCommitmentSent,
  openCapitalRound,
  type ApiSession,
} from "@capital-q/api-client";
import {
  MarkTransferSentRequestSchema,
  OpenCapitalRoundRequestSchema,
  type OpenCapitalRoundRequest,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * The Capital page's steps, server side (2026-10-04). Server actions keep
 * the session token off the browser; ids are input and the API decides the
 * party, the side and the company. Every press that creates something
 * carries a key made once per press, so a retry cannot do it twice.
 */
export type CapitalResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

async function run(
  work: (session: ApiSession) => Promise<unknown>,
): Promise<CapitalResult> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    await work(session);
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : "Capital Q didn't answer. Try again.",
    };
  }
}

async function ownCompanyId(): Promise<string | null> {
  const context = await resolveOwnContext();
  return context.kind === "FOUNDER" ? context.companyId : null;
}

export async function openRoundAction(
  request: OpenCapitalRoundRequest,
  key: string,
): Promise<CapitalResult> {
  const parsed = OpenCapitalRoundRequestSchema.safeParse(request);
  if (!parsed.success || !Key.safeParse(key).success) {
    return { ok: false, message: "Add a name and a target above zero." };
  }
  const companyId = await ownCompanyId();
  if (companyId === null)
    return { ok: false, message: "Only founders open rounds." };
  return run((session) =>
    openCapitalRound(session, companyId, parsed.data, key),
  );
}

export async function closeRoundAction(
  roundId: string,
): Promise<CapitalResult> {
  if (!Id.safeParse(roundId).success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  const companyId = await ownCompanyId();
  if (companyId === null)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => closeCapitalRound(session, companyId, roundId));
}

export async function confirmAmountAction(
  commitmentId: string,
  roundId: string | null,
  key: string,
): Promise<CapitalResult> {
  if (
    !Id.safeParse(commitmentId).success ||
    (roundId !== null && !Id.safeParse(roundId).success) ||
    !Key.safeParse(key).success
  ) {
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  }
  return run((session) =>
    confirmCommitmentAmount(
      session,
      commitmentId,
      roundId === null ? {} : { roundId },
      key,
    ),
  );
}

export async function markSentAction(
  commitmentId: string,
  reference: string,
): Promise<CapitalResult> {
  const request = MarkTransferSentRequestSchema.safeParse(
    reference.trim() === "" ? {} : { reference: reference.trim() },
  );
  if (!Id.safeParse(commitmentId).success || !request.success) {
    return { ok: false, message: "Keep the reference under 120 characters." };
  }
  return run((session) =>
    markCommitmentSent(session, commitmentId, request.data),
  );
}

export async function confirmReceivedAction(
  commitmentId: string,
  roundId: string | null,
): Promise<CapitalResult> {
  if (
    !Id.safeParse(commitmentId).success ||
    (roundId !== null && !Id.safeParse(roundId).success)
  ) {
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  }
  return run((session) =>
    confirmCommitmentReceived(
      session,
      commitmentId,
      roundId === null ? {} : { roundId },
    ),
  );
}

/** Money Q heard that isn't right: kept on record as disputed. */
export async function notRightAction(
  commitmentId: string,
): Promise<CapitalResult> {
  if (!Id.safeParse(commitmentId).success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => disputeCommitment(session, commitmentId));
}
