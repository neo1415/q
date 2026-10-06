"use server";

import { z } from "zod";

import { shareApplicationMaterials } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * F1: the signed-in founder's ticked documents, shared with their GateQ
 * application at the moment they press Send. The API proves each document
 * is their organisation's own; this only forwards what was ticked.
 */
const Input = z.object({
  sessionToken: z.string().min(16).max(128),
  documentIds: z.array(z.string().uuid()).min(1).max(10),
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
