import "server-only";

import { getKyb } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import { verifyNudge, type VerifyNudge } from "./verify-state";

/** The shell's verification item, read under the person's own session. */
export async function loadVerifyNudge(): Promise<VerifyNudge | null> {
  const session = await apiSession();
  if (session === null) return null;
  const kyb = await getKyb(session).catch(() => null);
  return kyb === null ? null : verifyNudge(kyb);
}
