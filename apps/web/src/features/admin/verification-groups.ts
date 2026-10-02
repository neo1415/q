import type { AdminVerificationRowDto } from "@capital-q/contracts";

export type VerificationGroup = {
  readonly organisationId: string;
  readonly rows: readonly AdminVerificationRowDto[];
  /**
   * The person's identity claim and the organisation's claim, both
   * pending: an operator may verify the pair in one action (each still
   * decided and recorded on its own). Null when there is no such pair.
   */
  readonly pair: readonly [string, string] | null;
};

/**
 * ADMIN-4: the queue shows a person and their organisation together, in
 * the order the oldest request in each group arrived.
 */
export function verificationGroups(
  rows: readonly AdminVerificationRowDto[],
): readonly VerificationGroup[] {
  const byOrganisation = new Map<string, AdminVerificationRowDto[]>();
  for (const row of rows) {
    const group = byOrganisation.get(row.organisationId);
    if (group === undefined) byOrganisation.set(row.organisationId, [row]);
    else group.push(row);
  }
  return [...byOrganisation.entries()].map(([organisationId, group]) => {
    const person = group.filter(
      (row) =>
        row.claimType === "FOUNDER_IDENTITY" ||
        row.claimType === "INVESTOR_IDENTITY",
    );
    const organisation = group.find((row) => row.claimType === "ORGANISATION");
    const onlyPerson = person.length === 1 ? person[0] : undefined;
    return {
      organisationId,
      rows: group,
      pair:
        onlyPerson !== undefined && organisation !== undefined
          ? [onlyPerson.claimId, organisation.claimId]
          : null,
    };
  });
}
