"use server";

import { z } from "zod";

import {
  ApiProblemError,
  closeDeal,
  generateRelationshipReport,
  getRelationshipDeal,
  markDealSigned,
  recordDealTerms,
  tickDealChecklist,
  type ApiSession,
} from "@capital-q/api-client";
import {
  RecordDealTermsRequestSchema,
  RelationshipReportKindSchema,
  type DealViewDto,
  type RecordDealTermsRequest,
  type RelationshipReportKind,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Deal close, server side (2026-10-08). Server actions so the session
 * token never reaches the browser; ids are input, and the API decides
 * whether this person is a party and for which side. Every consequential
 * step carries a key made once per confirm, so a retry records once; after
 * each step the view is read again, so the strip is always the server's.
 */
export type DealResult<T> =
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
): Promise<DealResult<T>> {
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

const NOT_FOUND = {
  ok: false,
  message: "We couldn't find that. Refresh the page and try again.",
} as const;

export async function readDealAction(
  relationshipId: string,
): Promise<DealResult<DealViewDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success) return NOT_FOUND;
  return run((session) => getRelationshipDeal(session, id.data));
}

/** One step, then the strip as the server now reads it. */
async function stepThenRead(
  relationshipId: string,
  step: (session: ApiSession, id: string) => Promise<unknown>,
): Promise<DealResult<DealViewDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success) return NOT_FOUND;
  return run(async (session) => {
    await step(session, id.data);
    return getRelationshipDeal(session, id.data);
  });
}

export async function recordTermsAction(
  relationshipId: string,
  terms: RecordDealTermsRequest,
  idempotencyKey: string,
): Promise<DealResult<DealViewDto>> {
  const parsed = RecordDealTermsRequestSchema.safeParse(terms);
  const key = Key.safeParse(idempotencyKey);
  if (!parsed.success || !key.success) {
    return {
      ok: false,
      message: parsed.success
        ? "Please try again."
        : (parsed.error.issues[0]?.message ?? "Check the terms."),
    };
  }
  return stepThenRead(relationshipId, (session, id) =>
    recordDealTerms(session, id, parsed.data, key.data),
  );
}

export async function markSignedAction(
  relationshipId: string,
  termsId: string,
  signedDocumentId: string,
  idempotencyKey: string,
): Promise<DealResult<DealViewDto>> {
  const terms = Id.safeParse(termsId);
  const document = Id.safeParse(signedDocumentId);
  const key = Key.safeParse(idempotencyKey);
  if (!terms.success || !document.success || !key.success) {
    return { ok: false, message: "Choose the signed copy." };
  }
  return stepThenRead(relationshipId, (session, id) =>
    markDealSigned(
      session,
      id,
      { termsId: terms.data, signedDocumentId: document.data },
      key.data,
    ),
  );
}

export async function closeDealAction(
  relationshipId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<DealResult<DealViewDto>> {
  const key = Key.safeParse(idempotencyKey);
  if (!key.success) return { ok: false, message: "Please try again." };
  const trimmed = note?.trim() ?? "";
  return stepThenRead(relationshipId, (session, id) =>
    closeDeal(
      session,
      id,
      trimmed.length === 0 ? {} : { note: trimmed.slice(0, 1000) },
      key.data,
    ),
  );
}

export async function tickChecklistAction(
  relationshipId: string,
  item: string,
): Promise<DealResult<DealViewDto>> {
  if (!/^[A-Z][A-Z_]{2,47}$/.test(item)) return NOT_FOUND;
  return stepThenRead(relationshipId, (session, id) =>
    tickDealChecklist(session, id, item),
  );
}

export async function generateReportAction(
  relationshipId: string,
  kind: RelationshipReportKind,
  idempotencyKey: string,
): Promise<DealResult<DealViewDto>> {
  const parsed = RelationshipReportKindSchema.safeParse(kind);
  const key = Key.safeParse(idempotencyKey);
  if (!parsed.success || !key.success) return NOT_FOUND;
  return stepThenRead(relationshipId, (session, id) =>
    generateRelationshipReport(session, id, parsed.data, key.data),
  );
}
