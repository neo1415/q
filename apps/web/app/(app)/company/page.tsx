import { redirect } from "next/navigation";

import { resolveOwnContext } from "@/features/q/context";
import { companyLandingPath } from "@/features/q/own-paths";

export const dynamic = "force-dynamic";

/**
 * `/company` on its own (D6, live typed run 2026-10-28): the founder's own
 * company page when they have one, otherwise the setup that creates it.
 * Decided here, on the server, from the session's own context.
 */
export default async function CompanyIndexPage(): Promise<never> {
  redirect(companyLandingPath(await resolveOwnContext()));
}
