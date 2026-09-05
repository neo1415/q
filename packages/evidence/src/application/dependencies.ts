import type {
  MaterialActionAuditWriter,
  SecurityEventWriter,
} from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type { EvidenceSubjectResolverRegistry } from "../domain/subjects.js";
import type { EvidenceRepositories } from "./ports.js";
import type { PrivateDocumentStorageProvider } from "./storage-port.js";

/** Server-configured upload limits (CQ-EVD-002). */
export type DocumentUploadLimits = {
  /** The private bucket. Server-owned; never public. */
  readonly bucket: string;
  /** Adjustable implementation limit, not a locked product decision. */
  readonly maxBytes: number;
  readonly sessionTtlSeconds: number;
  /** Ceiling on outstanding scoped writes to storage per organisation. */
  readonly maxOpenSessions: number;
};

/**
 * Everything a use case needs, injected. No model provider, no parser and
 * no queue: those belong to CQ-EVD-003 and arrive behind their own
 * adapters. Storage is present but narrow — a port that mints a scoped
 * upload authorization, stats, streams and deletes one object, nothing
 * more. When it is absent the upload boundary is closed rather than open.
 */
export type EvidenceServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly subjects: EvidenceSubjectResolverRegistry;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories: EvidenceRepositories;
  readonly storage?: PrivateDocumentStorageProvider | undefined;
  readonly uploads?: DocumentUploadLimits | undefined;
  /** Rejected uploads whose content disagreed with its claim. */
  readonly securityEvents?: SecurityEventWriter | undefined;
};
