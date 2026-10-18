"use server";

import { z } from "zod";

import {
  adoptCommitment,
  ApiProblemError,
  confirmCommitment,
  disputeCommitment,
  getCompanyFundraising,
  getRelationshipCommitments,
  stateCommitment,
  withdrawCommitment,
  type ApiSession,
} from "@capital-q/api-client";
import {
  StateCommitmentRequestSchema,
  type FundraisingDto,
  type RelationshipCommitmentsDto,
  type StateCommitmentRequest,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Commitments, server side (spec 6.6.14). Server actions so the session
 * token never reaches the browser; ids are input, and the API decides
 * whether this person is a party and for which side. Recording money
 * carries a key made once per press, so a retry cannot record twice.
 */
export type CommitmentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
): Promise<CommitmentResult<T>> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
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
          : "Couldn't reach Capital Q just now. Please try again.",
    };
  }
}

export async function readCommitmentsAction(
  relationshipId: string,
): Promise<CommitmentResult<RelationshipCommitmentsDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => getRelationshipCommitments(session, id.data));
}

export async function stateCommitmentAction(
  relationshipId: string,
  request: StateCommitmentRequest,
  idempotencyKey: string,
): Promise<CommitmentResult<RelationshipCommitmentsDto>> {
  const id = Id.safeParse(relationshipId);
  const body = StateCommitmentRequestSchema.safeParse(request);
  const key = Key.safeParse(idempotencyKey);
  if (!id.success || !key.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  if (!body.success) {
    return { ok: false, message: "Enter an amount, like 250000." };
  }
  return run((session) =>
    stateCommitment(session, id.data, body.data, key.data),
  );
}

export async function confirmCommitmentAction(
  commitmentId: string,
): Promise<CommitmentResult<RelationshipCommitmentsDto>> {
  const id = Id.safeParse(commitmentId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => confirmCommitment(session, id.data));
}

export async function adoptCommitmentAction(
  commitmentId: string,
  idempotencyKey: string,
): Promise<CommitmentResult<RelationshipCommitmentsDto>> {
  const id = Id.safeParse(commitmentId);
  const key = Key.safeParse(idempotencyKey);
  if (!id.success || !key.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => adoptCommitment(session, id.data, key.data));
}

export async function disputeCommitmentAction(
  commitmentId: string,
): Promise<CommitmentResult<RelationshipCommitmentsDto>> {
  const id = Id.safeParse(commitmentId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => disputeCommitment(session, id.data));
}

export async function withdrawCommitmentAction(
  commitmentId: string,
): Promise<CommitmentResult<RelationshipCommitmentsDto>> {
  const id = Id.safeParse(commitmentId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => withdrawCommitment(session, id.data));
}

export async function readFundraisingAction(
  companyId: string,
): Promise<CommitmentResult<FundraisingDto>> {
  const id = Id.safeParse(companyId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => getCompanyFundraising(session, id.data));
}
