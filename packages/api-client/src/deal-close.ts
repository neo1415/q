import {
  DealActionResultDtoSchema,
  DealViewDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  networkRelationshipDealChecklistPath,
  networkRelationshipDealClosePath,
  networkRelationshipDealPath,
  networkRelationshipDealSignedPath,
  networkRelationshipDealTermsPath,
  networkRelationshipReportsPath,
  RelationshipReportSummaryDtoSchema,
  type CloseDealRequest,
  type MarkDealSignedRequest,
  type RecordDealTermsRequest,
  type RelationshipReportKind,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Deal close (2026-10-08): the stage strip, the terms, signing and close,
 * and the reports on the ONE relationship. Each consequential step carries
 * a key made once per press, so a retry records once.
 */

export function getRelationshipDeal(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "GET",
    networkRelationshipDealPath(relationshipId),
    DealViewDtoSchema,
  );
}

export function recordDealTerms(
  session: ApiSession,
  relationshipId: string,
  request: RecordDealTermsRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipDealTermsPath(relationshipId),
    DealActionResultDtoSchema,
    {
      body: request,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

export function markDealSigned(
  session: ApiSession,
  relationshipId: string,
  request: MarkDealSignedRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipDealSignedPath(relationshipId),
    DealActionResultDtoSchema,
    {
      body: request,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

export function closeDeal(
  session: ApiSession,
  relationshipId: string,
  request: CloseDealRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipDealClosePath(relationshipId),
    DealActionResultDtoSchema,
    {
      body: request,
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

export function tickDealChecklist(
  session: ApiSession,
  relationshipId: string,
  item: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipDealChecklistPath(relationshipId),
    DealActionResultDtoSchema,
    {
      body: { item },
    },
  );
}

export function generateRelationshipReport(
  session: ApiSession,
  relationshipId: string,
  kind: RelationshipReportKind,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipReportsPath(relationshipId),
    RelationshipReportSummaryDtoSchema,
    {
      body: { kind },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}
