import type { Metadata } from "next";

import { RehearsalLobbyPage } from "@/features/rehearsal/lobby-page";

export const metadata: Metadata = { title: "Rehearse" };
export const dynamic = "force-dynamic";

/**
 * A founder's rehearsal with a researched external person, organisation or
 * agency (the identity card's "Rehearse with them"): a labelled AI
 * simulation informed by public sources. No account or relationship needed.
 */
export default async function ExternalPersonRehearsalPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly externalPersonId: string }>;
  readonly searchParams: Promise<{ readonly meeting?: string }>;
}) {
  const [{ externalPersonId }, { meeting }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <RehearsalLobbyPage
      kind="EXTERNAL_PERSON"
      counterpartId={externalPersonId}
      meeting={meeting}
    />
  );
}
