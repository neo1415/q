"use server";

import { z } from "zod";

import {
  ApiProblemError,
  applyPipelineImport,
  getRelationshipSideDetails,
  preparePipelineImport,
  updateRelationshipSideDetails,
  type ApiSession,
} from "@capital-q/api-client";
import {
  PipelineImportCountsSchema,
  PipelineImportMappingSchema,
  PipelineImportResolutionSchema,
  UpdateRelationshipSideDetailsRequestSchema,
  type PipelineImportAppliedDto,
  type PipelineImportPreview,
  type RelationshipSideDetails,
  type RelationshipSideDetailsRead,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * The CRM import screen and the side's own pipeline fields, server side
 * (decision 106). Server actions, so the session token never reaches the
 * browser. The side is never taken from the browser: a founder's import
 * and fields are their own company's, resolved here from their active
 * context; the API authorises everything again.
 */

export type ImportActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly message: string;
      /** The file is still being checked for safety: ask again shortly. */
      readonly retry?: boolean | undefined;
      /** Someone on their side saved first: read again. */
      readonly conflict?: boolean | undefined;
    };

type Side = { readonly session: ApiSession; readonly companyId?: string };

async function side(): Promise<Side | string> {
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  if (session === null) return "Please sign in again to continue.";
  if (context.kind === "FOUNDER")
    return { session, companyId: context.companyId };
  if (context.kind === "INVESTOR") return { session };
  return "Your pipeline belongs to your company or firm. Finish your setup first.";
}

async function run<T>(
  work: (own: Side) => Promise<T>,
  fallback: string,
): Promise<ImportActionResult<T>> {
  const own = await side();
  if (typeof own === "string") return { ok: false, message: own };
  try {
    return { ok: true, value: await work(own) };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) {
      if (error.code === "UPLOAD_NOT_READY") {
        return {
          ok: false,
          retry: true,
          message: "Checking the file for safety…",
        };
      }
      if (error.status === 401 || error.status === 403) {
        return { ok: false, message: "Please sign in again to continue." };
      }
      if (error.status < 500 && error.problem?.detail !== undefined) {
        return {
          ok: false,
          message: error.problem.detail,
          ...(error.status === 409 ? { conflict: true } : {}),
        };
      }
    }
    return { ok: false, message: fallback };
  }
}

const Prepare = z
  .object({
    documentId: z.string().uuid(),
    mapping: PipelineImportMappingSchema.optional(),
  })
  .strict();

/** Q reads the uploaded file and stages a proposal; nothing else changes. */
export async function preparePipelineImportAction(
  raw: unknown,
): Promise<ImportActionResult<PipelineImportPreview>> {
  const input = Prepare.safeParse(raw);
  if (!input.success)
    return { ok: false, message: "That file can't be read here." };
  return run(
    ({ session, companyId }) =>
      preparePipelineImport(session, input.data, companyId),
    "Couldn't read the file just now. Nothing was imported; try again.",
  );
}

const Apply = z
  .object({
    importId: z.string().uuid(),
    documentId: z.string().uuid(),
    fileName: z.string().min(1).max(255),
    proposalHash: z.string().regex(/^[0-9a-f]{64}$/),
    counts: PipelineImportCountsSchema,
    resolutions: z.array(PipelineImportResolutionSchema).max(5000),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

/** Applies exactly the proposal the person approved, under one key. */
export async function applyPipelineImportAction(
  raw: unknown,
): Promise<ImportActionResult<PipelineImportAppliedDto>> {
  const input = Apply.safeParse(raw);
  if (!input.success)
    return { ok: false, message: "Review the import again before approving." };
  const { importId, idempotencyKey, ...rest } = input.data;
  return run(
    ({ session, companyId }) =>
      applyPipelineImport(session, importId, rest, idempotencyKey, companyId),
    "Couldn't finish the import just now. Approving again continues it without duplicates.",
  );
}

/** The side's own pipeline fields on one relationship, with its members. */
export async function readSideDetailsAction(
  relationshipId: string,
): Promise<ImportActionResult<RelationshipSideDetailsRead>> {
  const id = z.string().uuid().safeParse(relationshipId);
  if (!id.success)
    return { ok: false, message: "That relationship isn't yours." };
  return run(
    ({ session, companyId }) =>
      getRelationshipSideDetails(session, id.data, companyId),
    "Couldn't read your pipeline fields just now.",
  );
}

const Update = z
  .object({
    relationshipId: z.string().uuid(),
    request: UpdateRelationshipSideDetailsRequestSchema,
  })
  .strict();

/** Saves the side's own fields over the revision the person saw. */
export async function updateSideDetailsAction(
  raw: unknown,
): Promise<ImportActionResult<RelationshipSideDetails>> {
  const input = Update.safeParse(raw);
  if (!input.success)
    return {
      ok: false,
      message:
        "Check the fields: an amount is a number like 250000 with a currency, and an email looks like name@firm.com.",
    };
  return run(
    ({ session, companyId }) =>
      updateRelationshipSideDetails(
        session,
        input.data.relationshipId,
        input.data.request,
        companyId,
      ),
    "Couldn't save just now. Nothing was lost; try again.",
  );
}
