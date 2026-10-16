"use server";

import { z } from "zod";

import { getMyOrganisations } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import type { ActionResult } from "../onboarding-kit/api-actions";
import {
  materialListAction,
  materialUploadCompleteAction,
  materialUploadTargetAction,
  type MaterialUploadTarget,
} from "../onboarding-kit/material-actions";
import type { MaterialFileView } from "../onboarding-kit/materials";

/**
 * An investor's optional materials in setup (owner directive 2026-10-16): a
 * fund deck, an investment thesis or an LP letter, held as the firm's own
 * organisation documents through the ordinary Evidence upload.
 *
 * The document lands in the person's ACTIVE organisation, so it is accepted
 * only while that organisation is a firm's workspace. A founder who also
 * invests, acting in their company's workspace, is refused with a sentence
 * rather than having a fund deck filed under their company (no crossover).
 * The API still decides whether the person may upload there at all.
 */

const INVESTOR_DOCUMENT_TYPES = [
  "FUND_DECK",
  "INVESTMENT_THESIS",
  "LP_LETTER",
] as const;

const TargetInput = z.object({
  documentType: z.enum(INVESTOR_DOCUMENT_TYPES),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(129),
  sizeBytes: z.number().int().min(1),
  idempotencyKey: z.string().uuid(),
});

const NOT_A_FIRM: ActionResult<never> = {
  ok: false,
  kind: "REJECTED",
  message:
    "Switch to your firm's workspace first, so this is filed with the firm and not with a company.",
};

async function actingForAFirm(): Promise<boolean> {
  const session = await apiSession();
  if (session === null) return false;
  try {
    const mine = await getMyOrganisations(session);
    return mine.items.some(
      (organisation) => organisation.active && organisation.kind === "FIRM",
    );
  } catch {
    return false;
  }
}

export async function investorMaterialTargetAction(
  raw: unknown,
): Promise<ActionResult<MaterialUploadTarget>> {
  const input = TargetInput.parse(raw);
  if (!(await actingForAFirm())) return NOT_A_FIRM;
  // No company: the firm's own document.
  return materialUploadTargetAction(input);
}

export async function investorMaterialCompleteAction(
  uploadSessionId: string,
  idempotencyKey: string,
): Promise<ActionResult<{ readonly documentId: string }>> {
  return materialUploadCompleteAction(uploadSessionId, idempotencyKey);
}

/** The firm's investor materials, read fresh, so reload shows the truth. */
export async function investorMaterialListAction(): Promise<
  ActionResult<readonly MaterialFileView[]>
> {
  if (!(await actingForAFirm())) return { ok: true, value: [] };
  const listed = await materialListAction();
  if (!listed.ok) return listed;
  const kinds: ReadonlySet<string> = new Set(INVESTOR_DOCUMENT_TYPES);
  return {
    ok: true,
    value: listed.value.filter(
      (file) => file.documentType !== undefined && kinds.has(file.documentType),
    ),
  };
}
