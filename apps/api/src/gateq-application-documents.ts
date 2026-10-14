import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  ADMISSIBLE_MIME_TYPES,
  createGateQApplicationEvidenceService,
  type DocumentUploadLimits,
  type GateQApplicationEvidenceScope,
  type PrivateDocumentStorageProvider,
} from "@capital-q/evidence";
import {
  IntakeRefusedError,
  type GuestThrottle,
  type IntakeService,
} from "@capital-q/gateq-intake";

import type { GateQApplyDocumentsRoutesDependencies } from "./http/gateq-apply-documents.js";

/**
 * ADR 0067 composition: application-owned GateQ document custody.
 *
 * The scope a guest upload runs under is derived from the verified session
 * credential only (`intake.authorise`), then re-read from the session and
 * contact rows: tenant, application and session are never request input.
 * No membership, organisation, relationship or capability is created; the
 * Evidence service writes `owner_kind = GATEQ_APPLICATION` rows only.
 */

/** Per-application ceilings (ADR 0067 §6), enforced in the Evidence service. */
export const GATEQ_APPLICATION_MAX_DOCUMENTS = 10;
export const GATEQ_APPLICATION_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** The row is untrusted input until checked; the api carries no zod. */
function sessionRow(
  row: unknown,
): { readonly expiresAt: string; readonly confirmed: boolean } | null {
  if (typeof row !== "object" || row === null) return null;
  const expires: unknown = Reflect.get(row, "expires_at");
  const confirmed: unknown = Reflect.get(row, "confirmed");
  const at =
    expires instanceof Date
      ? expires
      : typeof expires === "string"
        ? new Date(expires)
        : null;
  if (
    at === null ||
    Number.isNaN(at.getTime()) ||
    typeof confirmed !== "boolean"
  )
    return null;
  return { expiresAt: at.toISOString(), confirmed };
}

export function createGateQApplicationDocumentsModule(deps: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly storage: PrivateDocumentStorageProvider;
  readonly outbox: OutboxWriter;
  readonly uploads: DocumentUploadLimits;
  readonly intake: Pick<IntakeService, "authorise">;
  readonly throttle?: GuestThrottle | undefined;
}): GateQApplyDocumentsRoutesDependencies {
  const scopeFor = async (
    token: string,
  ): Promise<GateQApplicationEvidenceScope> => {
    // Throws IntakeRefusedError("SESSION_INVALID") for every bad credential.
    const guest = await deps.intake.authorise(token);
    const rows = await deps.sql`
      select s.expires_at,
        exists(select 1 from gateq.application_contacts c where c.application_id=s.application_id
          and c.tenant_id=s.tenant_id and c.email_confirmed_at is not null) as confirmed
      from gateq.application_sessions s
      where s.id=${guest.sessionId} and s.application_id=${guest.application.id}
        and s.tenant_id=${guest.application.tenantId} and s.revoked_at is null`;
    const session = rows.length === 1 ? sessionRow(rows[0]) : null;
    if (session === null) throw new IntakeRefusedError("SESSION_INVALID");
    // Who the investor may contact must be reachable before anything is
    // uploaded for them to see: the same rule Submit applies.
    if (!session.confirmed)
      throw new IntakeRefusedError("CONTACT_NOT_CONFIRMED");
    return {
      tenantId: guest.application.tenantId,
      applicationId: guest.application.id,
      sessionId: guest.sessionId,
      expiresAt: session.expiresAt,
      open: ["IN_PROGRESS", "READY_TO_SUBMIT"].includes(
        guest.application.status,
      ),
      contactConfirmed: true,
    };
  };
  const documents = createGateQApplicationEvidenceService({
    sql: deps.sql,
    transactions: deps.transactions,
    storage: deps.storage,
    outbox: deps.outbox,
    uploads: deps.uploads,
    maxDocuments: GATEQ_APPLICATION_MAX_DOCUMENTS,
    maxTotalBytes: GATEQ_APPLICATION_MAX_TOTAL_BYTES,
    authorise: scopeFor,
  });
  return {
    documents,
    authoriseGuest: async (token) => {
      const guest = await deps.intake.authorise(token);
      return { sessionId: guest.sessionId };
    },
    throttle: deps.throttle,
    limits: {
      maxDocuments: GATEQ_APPLICATION_MAX_DOCUMENTS,
      maxTotalBytes: GATEQ_APPLICATION_MAX_TOTAL_BYTES,
      maxFileBytes: deps.uploads.maxBytes,
      allowedMimeTypes: ADMISSIBLE_MIME_TYPES,
    },
  };
}
