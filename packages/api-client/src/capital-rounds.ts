import {
  CapitalLedgerDtoSchema,
  CapitalRoundDtoSchema,
  CapitalRoundHistoryDtoSchema,
  companyCapitalLedgerPath,
  companyCapitalRoundClosePath,
  companyCapitalRoundHistoryPath,
  companyCapitalRoundPath,
  companyCapitalRoundsPath,
  companyCapitalRoundStepsPath,
  IDEMPOTENCY_KEY_HEADER,
  MyCommitmentsDtoSchema,
  NETWORK_MY_COMMITMENTS_PATH,
  networkCommitmentAmountConfirmationPath,
  networkCommitmentReceiptPath,
  networkCommitmentTransferPath,
  RelationshipCommitmentsDtoSchema,
  type ConfirmCommitmentAmountRequest,
  type MarkTransferSentRequest,
  type OpenCapitalRoundRequest,
  type RecordCapitalRoundStepRequest,
  type ReviseCapitalRoundRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The founder's Capital book: rounds with derived sums, totals, commitments. */
export function getCapitalLedger(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    companyCapitalLedgerPath(companyId),
    CapitalLedgerDtoSchema,
  );
}

/** An investor's own commitments and what they invested. */
export function getMyCommitments(session: ApiSession) {
  return call(
    session,
    "GET",
    NETWORK_MY_COMMITMENTS_PATH,
    MyCommitmentsDtoSchema,
  );
}

/** Open (or plan) a round; one key per press. */
export function openCapitalRound(
  session: ApiSession,
  companyId: string,
  request: OpenCapitalRoundRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    companyCapitalRoundsPath(companyId),
    CapitalRoundDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** Correct a round; carries the revision it read. Its history keeps the old values. */
export function reviseCapitalRound(
  session: ApiSession,
  companyId: string,
  roundId: string,
  request: ReviseCapitalRoundRequest,
) {
  return call(
    session,
    "PATCH",
    companyCapitalRoundPath(companyId, roundId),
    CapitalRoundDtoSchema,
    { body: request },
  );
}

/** A close, tranche, final close, reopen, cancel or start; one key per press. */
export function recordCapitalRoundStep(
  session: ApiSession,
  companyId: string,
  roundId: string,
  request: RecordCapitalRoundStepRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    companyCapitalRoundStepsPath(companyId, roundId),
    CapitalRoundDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** A round's history: every change with its previous values. */
export function getCapitalRoundHistory(
  session: ApiSession,
  companyId: string,
  roundId: string,
) {
  return call(
    session,
    "GET",
    companyCapitalRoundHistoryPath(companyId, roundId),
    CapitalRoundHistoryDtoSchema,
  );
}

export function closeCapitalRound(
  session: ApiSession,
  companyId: string,
  roundId: string,
) {
  return call(
    session,
    "POST",
    companyCapitalRoundClosePath(companyId, roundId),
    CapitalRoundDtoSchema,
    { body: {} },
  );
}

/** Confirm an amount (Q's detection or the other side's); one key per press. */
export function confirmCommitmentAmount(
  session: ApiSession,
  commitmentId: string,
  request: ConfirmCommitmentAmountRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkCommitmentAmountConfirmationPath(commitmentId),
    RelationshipCommitmentsDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

export function markCommitmentSent(
  session: ApiSession,
  commitmentId: string,
  request: MarkTransferSentRequest,
) {
  return call(
    session,
    "POST",
    networkCommitmentTransferPath(commitmentId),
    RelationshipCommitmentsDtoSchema,
    { body: request },
  );
}

export function confirmCommitmentReceived(
  session: ApiSession,
  commitmentId: string,
  request: ConfirmCommitmentAmountRequest,
) {
  return call(
    session,
    "POST",
    networkCommitmentReceiptPath(commitmentId),
    RelationshipCommitmentsDtoSchema,
    { body: request },
  );
}
