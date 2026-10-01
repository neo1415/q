import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The C12 address of a founder's rehearsal with an investor; it moved. */
export default async function OldRehearsePage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  redirect(
    `/rehearsals/investor/${encodeURIComponent(investorOrganisationId)}`,
  );
}
