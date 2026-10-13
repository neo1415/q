"use server";

import { z } from "zod";

import {
  saveAccountApplicationContact,
  shareApplicationMaterials,
} from "@capital-q/api-client";
import {
  ApplicationContactAccountRequestSchema,
  type ApplicationContactDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * F1: the signed-in founder's ticked documents, shared with their GateQ
 * application at the moment they press Send. The API proves each document
 * is their organisation's own; this only forwards what was ticked.
 */
const Input = z.object({
  sessionToken: z.string().min(16).max(128),
  documentIds: z.array(z.string().uuid()).max(10),
});

export async function shareMaterialsAction(
  sessionToken: string,
  documentIds: readonly string[],
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> {
  const parsed = Input.safeParse({ sessionToken, documentIds });
  const session = await apiSession();
  if (!parsed.success || session === null) {
    return { ok: false, message: "Sign in again to share your documents." };
  }
  try {
    await shareApplicationMaterials(session, parsed.data);
    return { ok: true };
  } catch {
    return { ok: false, message: "Your documents couldn't be shared." };
  }
}

/**
 * GateQ slice 1: a signed-in founder's contact. The API confirms it without
 * a code only when the email is the account's own, which it resolves from
 * the actor, never from this request. A different email comes back
 * unconfirmed with a code sent, exactly like a guest's. No membership.
 */
export async function saveAccountContactAction(
  sessionToken: string,
  contact: unknown,
): Promise<
  | {
      readonly ok: true;
      readonly contact: ApplicationContactDto;
      readonly codeSent: boolean;
      readonly codeExpiresInMinutes: number | null;
    }
  | { readonly ok: false; readonly message: string }
> {
  const parsed = ApplicationContactAccountRequestSchema.safeParse({
    ...(typeof contact === "object" && contact !== null ? contact : {}),
    sessionToken,
  });
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to confirm your details." };
  }
  if (!parsed.success) {
    return { ok: false, message: "Please check your details and try again." };
  }
  try {
    const saved = await saveAccountApplicationContact(session, parsed.data);
    return {
      ok: true,
      contact: saved.contact,
      codeSent: saved.codeSent,
      codeExpiresInMinutes: saved.codeExpiresInMinutes,
    };
  } catch {
    return { ok: false, message: "Your details couldn't be saved." };
  }
}
