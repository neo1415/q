"use server";

import { z } from "zod";

import {
  applyThesisSuggestion,
  sendDiligenceQuestions,
} from "@capital-q/api-client";
import {
  ASSUMPTION_QUESTION_MAX_LENGTH,
  ASSUMPTION_QUESTIONS_SEND_MAX,
  ThesisSuggestionIdSchema,
} from "@capital-q/contracts";

import { diligenceErrorMessage } from "@/features/relationships/diligence-errors";
import { apiSession } from "@/features/q/context";

/**
 * The two approved writes of the investor promises, server side so the
 * session never reaches the browser. The click on the approval sheet IS
 * the approval of exactly the payload shown: the questions travel as
 * shown, under one idempotency key minted when the sheet opened, so a
 * double tap or a retry sends once. Ids are input; the API decides.
 */

export type PromiseActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Send = z
  .object({
    relationshipId: z.string().uuid(),
    questions: z
      .array(z.string().trim().min(3).max(ASSUMPTION_QUESTION_MAX_LENGTH))
      .min(1)
      .max(ASSUMPTION_QUESTIONS_SEND_MAX),
    idempotencyKey: z
      .string()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9:_-]+$/),
  })
  .strict();

export async function sendQuestionsAction(
  raw: unknown,
): Promise<PromiseActionResult<{ readonly via: string }>> {
  const input = Send.safeParse(raw);
  if (!input.success) {
    return { ok: false, message: "Pick one to five questions to send." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const sent = await sendDiligenceQuestions(
      session,
      input.data.relationshipId,
      input.data.questions,
      input.data.idempotencyKey,
    );
    return { ok: true, value: { via: sent.via } };
  } catch (error: unknown) {
    return { ok: false, message: diligenceErrorMessage(error) };
  }
}

const Apply = z
  .object({
    investorOrganisationId: z.string().uuid(),
    mandateId: z.string().uuid(),
    suggestionId: ThesisSuggestionIdSchema,
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export async function applySuggestionAction(
  raw: unknown,
): Promise<PromiseActionResult<{ readonly version: number }>> {
  const input = Apply.safeParse(raw);
  if (!input.success) {
    return { ok: false, message: "That suggestion isn't valid any more." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const mandate = await applyThesisSuggestion(session, input.data);
    return { ok: true, value: { version: mandate.version } };
  } catch (error: unknown) {
    return {
      ok: false,
      message: diligenceErrorMessage(
        error,
        "Your mandate changed since this was suggested, or it no longer fits. Refresh to see the latest.",
      ),
    };
  }
}
