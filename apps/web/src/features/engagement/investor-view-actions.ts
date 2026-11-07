"use server";

import { recordInvestorView } from "@capital-q/api-client";
import { RecordInvestorViewRequestSchema } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * A founder's view of an investor's profile (who viewed an investor). The
 * server decides whether it counts (the founder may see the investor; not
 * their own firm; not a duplicate), and the answer never says which.
 */
export async function reportInvestorViewAction(input: unknown): Promise<void> {
  const parsed = RecordInvestorViewRequestSchema.safeParse(input);
  if (!parsed.success) return;
  const session = await apiSession();
  if (session === null) return;
  await recordInvestorView(session, parsed.data).catch(() => undefined);
}
