import {
  IDEMPOTENCY_KEY_HEADER,
  NETWORK_PASS_REASONS_PATH,
  networkRelationshipOutcomePath,
  PassReasonListDtoSchema,
  RelationshipOutcomeResultDtoSchema,
  RelationshipPassResponseDtoSchema,
  type PassRelationshipRequest,
  type RecordMeetingOutcomeRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Post-meeting outcomes (2026-10-02). Pass is consequential: one key per
 * press, so a retry cannot record twice. The reason stays private unless
 * the request says shareWithFounder.
 */
export function passRelationship(
  session: ApiSession,
  relationshipId: string,
  request: PassRelationshipRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipOutcomePath(relationshipId, "pass"),
    RelationshipOutcomeResultDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

export function pauseRelationship(session: ApiSession, relationshipId: string) {
  return call(
    session,
    "POST",
    networkRelationshipOutcomePath(relationshipId, "pause"),
    RelationshipOutcomeResultDtoSchema,
  );
}

export function resumeRelationship(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "POST",
    networkRelationshipOutcomePath(relationshipId, "resume"),
    RelationshipOutcomeResultDtoSchema,
  );
}

export function recordMeetingOutcome(
  session: ApiSession,
  relationshipId: string,
  request: RecordMeetingOutcomeRequest,
) {
  return call(
    session,
    "POST",
    networkRelationshipOutcomePath(relationshipId, "meeting-outcome"),
    RelationshipOutcomeResultDtoSchema,
    { body: request },
  );
}

/** The current pass as this side may see it (a founder: only if shared). */
export function getRelationshipPass(
  session: ApiSession,
  relationshipId: string,
) {
  return call(
    session,
    "GET",
    networkRelationshipOutcomePath(relationshipId, "pass"),
    RelationshipPassResponseDtoSchema,
  );
}

export function listPassReasons(session: ApiSession) {
  return call(
    session,
    "GET",
    NETWORK_PASS_REASONS_PATH,
    PassReasonListDtoSchema,
  );
}
