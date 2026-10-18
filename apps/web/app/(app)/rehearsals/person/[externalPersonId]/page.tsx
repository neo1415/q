import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getRehearsalPersona } from "@capital-q/api-client";
import { z } from "zod";

import { qApiSession } from "@/features/q/context";

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
  // R5: a researched entity that is a canonical (unclaimed) investor is
  // rehearsed as that investor. A failed read just keeps the lobby below,
  // which says plainly when a rehearsal isn't available.
  const investorId = await linkedInvestor(externalPersonId);
  if (investorId !== null) {
    redirect(`/rehearsals/investor/${encodeURIComponent(investorId)}`);
  }
  return (
    <RehearsalLobbyPage
      kind="EXTERNAL_PERSON"
      counterpartId={externalPersonId}
      meeting={meeting}
    />
  );
}

async function linkedInvestor(
  externalPersonId: string,
): Promise<string | null> {
  if (!z.string().uuid().safeParse(externalPersonId).success) return null;
  const session = await qApiSession();
  if (session === null) return null;
  try {
    const persona = await getRehearsalPersona(
      session,
      "EXTERNAL_PERSON",
      externalPersonId,
    );
    return persona.simulation?.investorOrganisationId ?? null;
  } catch {
    return null;
  }
}
