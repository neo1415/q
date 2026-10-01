import type { Metadata } from "next";

import { RehearsalLobbyPage } from "@/features/rehearsal/lobby-page";

export const metadata: Metadata = { title: "Rehearse" };
export const dynamic = "force-dynamic";

/** A founder's rehearsal of a meeting with an investor, played by Q. */
export default async function InvestorRehearsalPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
  readonly searchParams: Promise<{ readonly meeting?: string }>;
}) {
  const [{ investorOrganisationId }, { meeting }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <RehearsalLobbyPage
      kind="INVESTOR_ORGANISATION"
      counterpartId={investorOrganisationId}
      meeting={meeting}
    />
  );
}
