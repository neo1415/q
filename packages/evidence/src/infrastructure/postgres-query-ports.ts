import type { DatabaseExecutor } from "@capital-q/database";

import type {
  ClaimQueryPort,
  DocumentQueryPort,
  EvidenceItemQueryPort,
  EvidenceSourceQueryPort,
} from "../application/ports.js";
import {
  createPostgresClaimEvidenceRepository,
  createPostgresClaimRepository,
  createPostgresDocumentRepository,
  createPostgresEvidenceItemRepository,
  createPostgresEvidenceSourceRepository,
} from "./postgres-repositories.js";

/**
 * Read ports for other bounded contexts. Permission-neutral canonical
 * facts: callers (Q retrieval, Data Room, disclosure) authorise before
 * they read, and never see storage keys through here.
 */

export function createPostgresEvidenceSourceQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): EvidenceSourceQueryPort {
  const sources = createPostgresEvidenceSourceRepository();
  return {
    findCanonicalSource: (tenantId, sourceId) =>
      sources.findById(options.sql, tenantId, sourceId),
  };
}

export function createPostgresDocumentQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): DocumentQueryPort {
  const documents = createPostgresDocumentRepository();
  return {
    findCanonicalDocument: async (tenantId, documentId) => {
      const document = await documents.findInTenant(
        options.sql,
        tenantId,
        documentId,
      );
      return document === null
        ? null
        : {
            id: document.id,
            tenantId: document.tenantId,
            ownerOrganisationId: document.ownerOrganisationId,
            companyId: document.companyId,
            visibilityScope: document.visibilityScope,
            sensitivityClass: document.sensitivityClass,
            currentVersionId: document.currentVersionId,
            status: document.status,
          };
    },
  };
}

export function createPostgresClaimQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): ClaimQueryPort {
  const claims = createPostgresClaimRepository();
  return {
    findCanonicalClaim: (tenantId, claimId) =>
      claims.findById(options.sql, tenantId, claimId),
    listCurrentClaims: async (tenantId, subject, filter) =>
      (
        await claims.listBySubject(options.sql, tenantId, subject, filter)
      ).filter((claim) => claim.lifecycleStatus === "CURRENT"),
  };
}

export function createPostgresEvidenceItemQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): EvidenceItemQueryPort {
  const items = createPostgresEvidenceItemRepository();
  const links = createPostgresClaimEvidenceRepository();
  return {
    findCanonicalEvidenceItem: (tenantId, evidenceItemId) =>
      items.findById(options.sql, tenantId, evidenceItemId),
    listEvidenceForClaim: (tenantId, claimId) =>
      links.listByClaim(options.sql, tenantId, claimId),
  };
}
