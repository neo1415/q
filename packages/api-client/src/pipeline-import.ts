import {
  ApplyPipelineImportRequestSchema,
  COMPANY_PIPELINE_IMPORT_APPLY_PATH,
  COMPANY_PIPELINE_IMPORTS_PATH,
  COMPANY_PIPELINE_PROSPECTS_PATH,
  IDEMPOTENCY_KEY_HEADER,
  NETWORK_COMPANY_RELATIONSHIP_SIDE_DETAILS_PATH,
  NETWORK_RELATIONSHIP_SIDE_DETAILS_PATH,
  PIPELINE_IMPORT_APPLY_PATH,
  PIPELINE_IMPORTS_PATH,
  PIPELINE_PROSPECTS_PATH,
  PipelineImportAppliedSchema,
  PipelineImportPreviewSchema,
  PipelineProspectListSchema,
  PreparePipelineImportRequestSchema,
  RelationshipSideDetailsReadSchema,
  RelationshipSideDetailsSchema,
  UpdateRelationshipSideDetailsRequestSchema,
  type ApplyPipelineImportRequest,
  type PreparePipelineImportRequest,
  type UpdateRelationshipSideDetailsRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * CRM import (decision 106) and each side's own pipeline fields. A
 * founder's are their company's (the company id names their side; the
 * server checks it is theirs); an investor's are their organisation's.
 */
const at = (
  template: string,
  values: Readonly<Record<string, string | undefined>>,
): string =>
  template.replace(/:([A-Za-z]+)/g, (_, name: string) =>
    encodeURIComponent(values[name] ?? ""),
  );

/** Reads an uploaded file and stages a proposal; nothing else changes. */
export function preparePipelineImport(
  session: ApiSession,
  input: PreparePipelineImportRequest,
  companyId?: string,
) {
  return call(
    session,
    "POST",
    companyId === undefined
      ? PIPELINE_IMPORTS_PATH
      : at(COMPANY_PIPELINE_IMPORTS_PATH, { companyId }),
    PipelineImportPreviewSchema,
    { body: PreparePipelineImportRequestSchema.parse(input) },
  );
}

/** Applies the exact proposal the person approved, under one key. */
export function applyPipelineImport(
  session: ApiSession,
  importId: string,
  input: ApplyPipelineImportRequest & {
    readonly documentId: string;
    readonly fileName?: string | undefined;
  },
  idempotencyKey: string,
  companyId?: string,
) {
  const { documentId, fileName, ...request } = input;
  return call(
    session,
    "POST",
    at(
      companyId === undefined
        ? PIPELINE_IMPORT_APPLY_PATH
        : COMPANY_PIPELINE_IMPORT_APPLY_PATH,
      { companyId, importId },
    ),
    PipelineImportAppliedSchema,
    {
      body: {
        ...ApplyPipelineImportRequestSchema.parse(request),
        documentId,
        ...(fileName === undefined ? {} : { fileName }),
      },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** The organisation's private prospects from its imports. */
export function listPipelineProspects(session: ApiSession, companyId?: string) {
  return call(
    session,
    "GET",
    companyId === undefined
      ? PIPELINE_PROSPECTS_PATH
      : at(COMPANY_PIPELINE_PROSPECTS_PATH, { companyId }),
    PipelineProspectListSchema,
  );
}

const sidePath = (relationshipId: string, companyId: string | undefined) =>
  at(
    companyId === undefined
      ? NETWORK_RELATIONSHIP_SIDE_DETAILS_PATH
      : NETWORK_COMPANY_RELATIONSHIP_SIDE_DETAILS_PATH,
    { companyId, relationshipId },
  );

/** The side's own pipeline fields on one relationship, and its members. */
export function getRelationshipSideDetails(
  session: ApiSession,
  relationshipId: string,
  companyId?: string,
) {
  return call(
    session,
    "GET",
    sidePath(relationshipId, companyId),
    RelationshipSideDetailsReadSchema,
  );
}

/** Saves the side's own fields over the revision the person saw. */
export function updateRelationshipSideDetails(
  session: ApiSession,
  relationshipId: string,
  input: UpdateRelationshipSideDetailsRequest,
  companyId?: string,
) {
  return call(
    session,
    "PUT",
    sidePath(relationshipId, companyId),
    RelationshipSideDetailsSchema,
    { body: UpdateRelationshipSideDetailsRequestSchema.parse(input) },
  );
}
