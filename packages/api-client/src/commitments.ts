import {
  FundraisingDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  networkCommitmentConfirmPath,
  networkCommitmentWithdrawPath,
  networkCompanyFundraisingPath,
  networkRelationshipCommitmentsPath,
  RelationshipCommitmentsDtoSchema,
  type StateCommitmentRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** A relationship's commitments, as the caller's side sees them. */
export function getRelationshipCommitments(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "GET",
    networkRelationshipCommitmentsPath(relationshipId),
    RelationshipCommitmentsDtoSchema,
  );
}

/** One side states money; the other side confirms it. One key per press. */
export function stateCommitment(
  session: ApiSession,
  relationshipId: string,
  request: StateCommitmentRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipCommitmentsPath(relationshipId),
    RelationshipCommitmentsDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

export function confirmCommitment(session: ApiSession, commitmentId: string) {
  return call(
    session,
    "POST",
    networkCommitmentConfirmPath(commitmentId),
    RelationshipCommitmentsDtoSchema,
  );
}

export function withdrawCommitment(session: ApiSession, commitmentId: string) {
  return call(
    session,
    "POST",
    networkCommitmentWithdrawPath(commitmentId),
    RelationshipCommitmentsDtoSchema,
  );
}

/** The company's raise: confirmed, soft, pipeline and what remains. */
export function getCompanyFundraising(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    networkCompanyFundraisingPath(companyId),
    FundraisingDtoSchema,
  );
}
