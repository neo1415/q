import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId } from "@capital-q/security";

import type {
  DocumentExtraction,
  NewDocumentExtraction,
} from "../contracts/extraction.js";
import type { DocumentVersionId } from "../contracts/index.js";

/**
 * Persistence for structured extraction metadata. The blocks themselves live
 * in private storage; this table records only what was produced, by which
 * parser, from which run, and where the artifact is.
 */
export type DocumentExtractionRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewDocumentExtraction,
  ) => Promise<DocumentExtraction>;
  /**
   * The extraction for one version under one pipeline, if it exists. One
   * pipeline version yields one artifact; a different pipeline yields
   * another, and neither overwrites the other.
   */
  readonly findByVersionAndPipeline: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentVersionId: DocumentVersionId,
    pipelineVersion: string,
  ) => Promise<DocumentExtraction | null>;
  readonly listByVersion: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentVersionId: DocumentVersionId,
  ) => Promise<readonly DocumentExtraction[]>;
};
