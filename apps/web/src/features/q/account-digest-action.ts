"use server";

import type { QAccountDigest } from "@capital-q/contracts";

import { createQApiAccountDigestReader } from "./account-digest";
import { qApiSession } from "./context";

/**
 * Owner 14 Nov 2026: the person's own account digest, for a client surface
 * such as the resume opening. Read under their own session; null when it
 * could not be read.
 */
export async function readAccountDigestAction(): Promise<QAccountDigest | null> {
  return createQApiAccountDigestReader(await qApiSession())();
}
