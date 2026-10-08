"use server";

import { z } from "zod";

import {
  getCompanyProfile,
  getDiscoveredInvestor,
} from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * Names for the companies and investors a Q answer refers to
 * (RECOVERY-2026-10 E4, audit E-08: an investor reference rendered as an
 * unnamed "Investor", comparison columns as "Company 1"). A block carries
 * ids only; each name is read here under the person's own session,
 * through the same read the record's own page uses, so a name they may
 * not see stays unread (null) and the card keeps its plain label.
 */

const Ids = z.array(z.string().uuid()).max(12);
const Input = z.object({ investors: Ids, companies: Ids }).strict();

export type ReferenceNames = {
  readonly investors: Readonly<Record<string, string | null>>;
  readonly companies: Readonly<Record<string, string | null>>;
};

export async function referenceNamesAction(raw: {
  readonly investors: readonly string[];
  readonly companies: readonly string[];
}): Promise<ReferenceNames> {
  const input = Input.safeParse({
    investors: [...new Set(raw.investors)],
    companies: [...new Set(raw.companies)],
  });
  const session = input.success ? await apiSession() : null;
  if (!input.success || session === null) {
    return { investors: {}, companies: {} };
  }
  const [investors, companies] = await Promise.all([
    Promise.all(
      input.data.investors.map(async (id) => {
        const read = await getDiscoveredInvestor(session, id).catch(() => null);
        return [id, read?.displayName ?? null] as const;
      }),
    ),
    Promise.all(
      input.data.companies.map(async (id) => {
        const read = await getCompanyProfile(session, id).catch(() => null);
        return [id, read?.canonicalName ?? null] as const;
      }),
    ),
  ]);
  return {
    investors: Object.fromEntries(investors),
    companies: Object.fromEntries(companies),
  };
}
