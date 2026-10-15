import {
  getFitProfiles,
  getRelationshipGateqApplications,
  listQWork,
  listRelationshipNotes,
  getRelationshipCommitments,
  getRelationshipPass,
} from "@capital-q/api-client";
import type {
  FitProfileDto,
  RelationshipGateqApplicationsDto,
  RelationshipNoteList,
  RelationshipStatusDto,
} from "@capital-q/contracts";

import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";

import { decided, decisionOf, type Decision } from "./decision";
import { recordWork, type Read, type RecordWorkRow } from "./record-workspace";

/**
 * The CRM record's extra reads, each under the person's own session and
 * each authorised by its own endpoint: Q's work (the person's own jobs)
 * and the investor's fit with one company. A failed read is UNAVAILABLE,
 * never an empty answer (R1).
 */

/** Q's jobs with a lane for this counterpart (canonical id join). */
export async function recordWorkRead(
  counterpartId: string,
): Promise<Read<readonly RecordWorkRow[]>> {
  const session = await qApiSession();
  if (session === null) return { kind: "UNAVAILABLE" };
  try {
    const { items } = await listQWork(session);
    return { kind: "READ", value: recordWork(items, counterpartId) };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

/** The investor's fit with one company; null when fit isn't set up. */
export async function recordFitRead(
  companyId: string,
): Promise<Read<FitProfileDto | null>> {
  const session = await qApiSession();
  if (session === null) return { kind: "UNAVAILABLE" };
  try {
    const { items } = await getFitProfiles(session, [companyId]);
    const own = items.find((item) => item.companyId === companyId);
    return { kind: "READ", value: own?.profile ?? null };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

/** The relationship's GateQ applications, for this side (lane G's read). */
export async function recordGateqRead(
  relationshipId: string,
): Promise<Read<RelationshipGateqApplicationsDto>> {
  const session = await apiSession();
  if (session === null) return { kind: "UNAVAILABLE" };
  try {
    return {
      kind: "READ",
      value: await getRelationshipGateqApplications(session, relationshipId),
    };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

/**
 * The side's own private notes on this relationship (CRM S3). The side is
 * the person's own active context (a founder's company, else their firm),
 * never the URL; the API answers only that side's notes.
 */
export async function recordNotesRead(
  relationshipId: string,
): Promise<Read<RelationshipNoteList>> {
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  if (session === null) return { kind: "UNAVAILABLE" };
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR")
    return { kind: "UNAVAILABLE" };
  try {
    return {
      kind: "READ",
      value: await listRelationshipNotes(
        session,
        relationshipId,
        context.kind === "FOUNDER" ? context.companyId : undefined,
      ),
    };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

/**
 * The record's decision (CRM S5), when its state is one: the pass as this
 * side may see it, or the current commitment, read beside the record's
 * other reads. Null when the state is no decision.
 */
export async function recordDecisionRead(
  relationship: RelationshipStatusDto | null,
  side: "INVESTOR" | "COMPANY",
): Promise<Decision | null> {
  if (relationship === null || !decided(relationship)) return null;
  const session = await apiSession();
  const id = relationship.relationshipId;
  const [pass, commitments] = await Promise.all([
    session === null || relationship.state !== "PASSED"
      ? undefined
      : getRelationshipPass(session, id).catch(() => undefined),
    session === null || relationship.state !== "INVESTED"
      ? undefined
      : getRelationshipCommitments(session, id).catch(() => undefined),
  ]);
  return decisionOf({ relationship, side, pass, commitments });
}
