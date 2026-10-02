"use server";

import { z } from "zod";

import {
  ApiProblemError,
  getRelationshipPass,
  listPassReasons,
  passRelationship,
  pauseRelationship,
  recordMeetingOutcome,
  resumeRelationship,
  type ApiSession,
} from "@capital-q/api-client";
import {
  PassRelationshipRequestSchema,
  RecordMeetingOutcomeRequestSchema,
  type PassReasonListDto,
  type PassRelationshipRequest,
  type RecordMeetingOutcomeRequest,
  type RelationshipOutcomeResultDto,
  type RelationshipPassResponseDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Post-meeting outcomes, server side (2026-10-02). Server actions so the
 * session token never reaches the browser; the relationship id is input,
 * and the API decides whether this person is a party and on which side.
 * A pass carries a key made once per press, so a retry cannot pass twice.
 */
export type OutcomeActionResult<T> =
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
): Promise<OutcomeActionResult<T>> {
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

export async function passReasonsAction(): Promise<
  OutcomeActionResult<PassReasonListDto>
> {
  return run((session) => listPassReasons(session));
}

export async function readPassAction(
  relationshipId: string,
): Promise<OutcomeActionResult<RelationshipPassResponseDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => getRelationshipPass(session, id.data));
}

export async function passAction(
  relationshipId: string,
  request: PassRelationshipRequest,
  idempotencyKey: string,
): Promise<OutcomeActionResult<RelationshipOutcomeResultDto>> {
  const id = Id.safeParse(relationshipId);
  const key = Key.safeParse(idempotencyKey);
  const body = PassRelationshipRequestSchema.safeParse(request);
  if (!id.success || !key.success) return { ok: false, message: "Not found." };
  if (!body.success)
    return { ok: false, message: "Check the reason and note." };
  return run((session) =>
    passRelationship(session, id.data, body.data, key.data),
  );
}

export async function pauseAction(
  relationshipId: string,
): Promise<OutcomeActionResult<RelationshipOutcomeResultDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => pauseRelationship(session, id.data));
}

export async function resumeAction(
  relationshipId: string,
): Promise<OutcomeActionResult<RelationshipOutcomeResultDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => resumeRelationship(session, id.data));
}

export async function meetingOutcomeAction(
  relationshipId: string,
  request: RecordMeetingOutcomeRequest,
): Promise<OutcomeActionResult<RelationshipOutcomeResultDto>> {
  const id = Id.safeParse(relationshipId);
  const body = RecordMeetingOutcomeRequestSchema.safeParse(request);
  if (!id.success || !body.success) return { ok: false, message: "Not found." };
  return run((session) => recordMeetingOutcome(session, id.data, body.data));
}
