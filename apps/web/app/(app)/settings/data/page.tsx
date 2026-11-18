import type { Metadata } from "next";

import { getDataRights } from "@capital-q/api-client";

import { DataRightsView } from "@/features/settings/data-rights-view";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Your data" };
export const dynamic = "force-dynamic";

/**
 * Your data (owner decision 107): download a copy, or delete the account,
 * read under the person's own session. A failed read is said as such,
 * never shown as "nothing to download".
 */
export default async function DataRightsPage() {
  const session = await apiSession();
  const data =
    session === null ? null : await getDataRights(session).catch(() => null);
  return <DataRightsView data={data} />;
}
