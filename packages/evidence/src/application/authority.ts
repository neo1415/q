import { capability, type ActorContext } from "@capital-q/security";

import type { EvidenceSubjectRef } from "../contracts/index.js";
import { EvidenceSubjectNotFoundError } from "../domain/errors.js";
import type { ResolvedEvidenceSubject } from "../domain/subjects.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";

/**
 * Capabilities guarded here. `document.*` are what CQ-EVD-002 upload and
 * download operations will require; `evidence.*` cover recording and
 * reading sources, claims and evidence items about a subject the actor's
 * organisation owns.
 */
export const DOCUMENT_CREATE = capability("document.create");
export const DOCUMENT_VIEW = capability("document.view");
export const DOCUMENT_DOWNLOAD = capability("document.download");
export const DOCUMENT_MANAGE = capability("document.manage");
export const EVIDENCE_VIEW = capability("evidence.view");
export const EVIDENCE_RECORD = capability("evidence.record");

export type ActiveOrganisationId = NonNullable<ActorContext["organisationId"]>;

export function documentScope(
  actor: ActorContext,
  organisationId: ActiveOrganisationId,
  documentId: string,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId,
    resourceType: "document",
    resourceId: documentId,
  };
}

export function subjectScope(
  actor: ActorContext,
  subject: ResolvedEvidenceSubject,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId: subject.ownerOrganisationId,
    resourceType: subject.subjectType.toLowerCase(),
    resourceId: subject.subjectId,
  };
}

/**
 * The subject as the actor may know it: it must resolve in the actor's
 * tenant and belong to the actor's active organisation. Anything else is
 * "not found", before any authorization detail could differ. Evidence
 * about a subject another organisation owns arrives only through later
 * disclosure workflows, never through a guessed id.
 */
export async function ownedSubject(
  dependencies: EvidenceServiceDependencies,
  actor: ActorContext,
  ref: EvidenceSubjectRef,
): Promise<ResolvedEvidenceSubject> {
  if (actor.organisationId === undefined) {
    throw new EvidenceSubjectNotFoundError();
  }
  const subject = await dependencies.subjects.resolve(actor, ref);
  if (
    subject === null ||
    subject.tenantId !== actor.tenantId ||
    subject.ownerOrganisationId !== actor.organisationId
  ) {
    throw new EvidenceSubjectNotFoundError();
  }
  return subject;
}

export function activeOrganisation(actor: ActorContext): ActiveOrganisationId {
  if (actor.organisationId === undefined) {
    throw new EvidenceSubjectNotFoundError();
  }
  return actor.organisationId;
}
