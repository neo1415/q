import type { Metadata } from "next";

import { RehearsalLobbyPage } from "@/features/rehearsal/lobby-page";

export const metadata: Metadata = { title: "Rehearse" };
export const dynamic = "force-dynamic";

/** An investor's rehearsal of a meeting with a company's founder, played by Q. */
export default async function CompanyRehearsalPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
  readonly searchParams: Promise<{ readonly meeting?: string }>;
}) {
  const [{ companyId }, { meeting }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <RehearsalLobbyPage
      kind="COMPANY"
      counterpartId={companyId}
      meeting={meeting}
    />
  );
}
