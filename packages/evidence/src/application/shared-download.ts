import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema } from "@capital-q/security";

import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
  type DocumentType,
} from "../contracts/index.js";
import { DocumentNotFoundError } from "../domain/errors.js";
import {
  createPostgresDocumentRepository,
  createPostgresDocumentVersionRepository,
  findInvestorAudienceDeck,
} from "../infrastructure/postgres-repositories.js";
import type { PrivateDocumentDownloadAuthorizer } from "./storage-port.js";

/**
 * A short-lived read of one document version that its owner SHARED (R34).
 *
 * Evidence does not decide who a share reaches: the sharing context (the
 * relationship chat) has already authorised the reader as a party to the
 * thread the version was sent on. What Evidence still owns, and checks
 * here, is the object: the exact version belongs to the document in its
 * tenant, the document is active, and a real scanner found the bytes clean.
 * Anything else is one answer (not found), and no key, bucket or scanner
 * detail leaves this function.
 */

export const SHARED_DOWNLOAD_TTL_SECONDS = 60;

export type SharedDocumentDownloads = {
  readonly authorizeSharedVersion: (share: {
    readonly documentTenantId: string;
    readonly documentId: string;
    readonly documentVersionId: string;
    /** Inline (a voice note played in place) or saved under its own name. */
    readonly disposition: "INLINE" | "ATTACHMENT";
  }) => Promise<{
    readonly url: string;
    readonly expiresAt: string;
    readonly mimeType: string;
  }>;
  /**
   * What kind of document a SHARED one is (a pitch deck, say), so a
   * reader's surface can name it. The same precondition as above: the
   * caller's sharing context has already authorised the reader. Only an
   * active document answers; anything else is null, and nothing but the
   * classification leaves.
   */
  readonly sharedDocumentType: (share: {
    readonly documentTenantId: string;
    readonly documentId: string;
  }) => Promise<DocumentType | null>;
  /**
   * The deck a company opened to investors (ADR 0041), or null. The caller
   * has ALREADY decided the reader is an investor the company is viewable
   * to (the pitch rule); this answers only which deck, and the download is
   * `authorizeSharedVersion` on exactly that version.
   */
  /**
   * One active document by id, permission-neutral, for a caller whose own
   * disclosure layer decides who may see it (diligence shares): its tenant,
   * company, title, type and current version. Nothing of its content.
   */
  readonly canonicalDocument: (documentId: string) => Promise<{
    readonly id: string;
    readonly tenantId: string;
    readonly companyId: string | null;
    readonly title: string;
    readonly documentType: string;
    readonly currentVersionId: string | null;
  } | null>;
  readonly investorAudienceDeck: (company: {
    readonly companyTenantId: string;
    readonly companyId: string;
  }) => Promise<{
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly title: string;
    readonly updatedAt: string;
  } | null>;
};

export function createSharedDocumentDownloads(options: {
  readonly sql: DatabaseExecutor;
  readonly storage: PrivateDocumentDownloadAuthorizer;
}): SharedDocumentDownloads {
  const documents = createPostgresDocumentRepository();
  const versions = createPostgresDocumentVersionRepository();
  return {
    authorizeSharedVersion: async (share) => {
      const tenantId = TenantIdSchema.safeParse(share.documentTenantId);
      const documentId = DocumentIdSchema.safeParse(share.documentId);
      const versionId = DocumentVersionIdSchema.safeParse(
        share.documentVersionId,
      );
      if (!tenantId.success || !documentId.success || !versionId.success) {
        throw new DocumentNotFoundError();
      }
      const [document, version] = await Promise.all([
        documents.findInTenant(options.sql, tenantId.data, documentId.data),
        versions.findById(options.sql, tenantId.data, versionId.data),
      ]);
      if (
        document === null ||
        version === null ||
        document.status !== "ACTIVE" ||
        version.documentId !== document.id ||
        // Unscanned is not clean; nothing unscanned is ever handed out.
        version.malwareScanStatus !== "CLEAN"
      ) {
        throw new DocumentNotFoundError();
      }
      const authorization = await options.storage.createDownloadAuthorization({
        object: { bucket: version.storageBucket, key: version.storageKey },
        expiresInSeconds: SHARED_DOWNLOAD_TTL_SECONDS,
        downloadFilename:
          share.disposition === "ATTACHMENT"
            ? version.originalFilename
            : undefined,
      });
      return {
        url: authorization.url,
        expiresAt: authorization.providerExpiresAt,
        mimeType: version.mimeType,
      };
    },
    sharedDocumentType: async (share) => {
      const tenantId = TenantIdSchema.safeParse(share.documentTenantId);
      const documentId = DocumentIdSchema.safeParse(share.documentId);
      if (!tenantId.success || !documentId.success) return null;
      const document = await documents.findInTenant(
        options.sql,
        tenantId.data,
        documentId.data,
      );
      return document === null || document.status !== "ACTIVE"
        ? null
        : document.documentType;
    },
    canonicalDocument: (documentId) =>
      findActiveDocumentById(options.sql, documentId),
    investorAudienceDeck: async (company) => {
      const tenantId = TenantIdSchema.safeParse(company.companyTenantId);
      if (!tenantId.success) return null;
      return findInvestorAudienceDeck(
        options.sql,
        tenantId.data,
        company.companyId,
      );
    },
  };
}

/**
 * One active document by id, permission-neutral: tenant, company, title,
 * type and current version, nothing of its content. For a caller whose own
 * disclosure layer decides who may see it (diligence shares).
 */
export async function findActiveDocumentById(
  sql: DatabaseExecutor,
  documentId: string,
): Promise<{
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string | null;
  readonly title: string;
  readonly documentType: string;
  readonly currentVersionId: string | null;
} | null> {
  const id = DocumentIdSchema.safeParse(documentId);
  if (!id.success) return null;
  const rows = await sql<
    {
      id: string;
      tenant_id: string;
      company_id: string | null;
      title: string;
      document_type: string;
      current_version_id: string | null;
    }[]
  >`
    select id, tenant_id, company_id, title, document_type, current_version_id
      from evidence.documents
     where id = ${id.data} and status = 'ACTIVE'`;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        tenantId: row.tenant_id,
        companyId: row.company_id,
        title: row.title,
        documentType: row.document_type,
        currentVersionId: row.current_version_id,
      };
}
