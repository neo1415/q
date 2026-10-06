import type { FounderPersonDto } from "@capital-q/contracts";

/**
 * A founder as a person (overnight plan A7), projected for a reader the
 * pitch rule admits (ADR 0041) or the owner. An allow-list, like the team
 * projection: age only where the founder shared it (and never computed
 * from anything else), each background line only where shared, and every
 * line labelled with what it rests on. A line is "matches a shared
 * document" only when its supporting document is one THIS reader may open;
 * otherwise it is the founder's claim, never silently upgraded.
 */

export type FounderPersonSource = {
  readonly name: string;
  readonly businessTitle: string | null;
  readonly isFounder: boolean;
  readonly professionalSummary: string | null;
  readonly identityVerified: boolean;
  readonly facts: {
    readonly birthYear: number | null;
    readonly ageShared: boolean;
    readonly buildingSince: number | null;
    readonly companiesFounded: number | null;
    readonly exits: string | null;
    readonly lookingFor: string | null;
    readonly location: string | null;
  } | null;
  readonly background: readonly {
    readonly fromYear: number | null;
    readonly toYear: number | null;
    readonly title: string;
    readonly detail: string | null;
    readonly supportingDocumentId: string | null;
    readonly shared: boolean;
  }[];
};

/** The age they reach this year: only the year is stored, never a birth date. */
export function ageFrom(birthYear: number, today: Date): number {
  return today.getUTCFullYear() - birthYear;
}

export function projectFounderPerson(
  source: FounderPersonSource,
  context: {
    readonly companyId: string;
    readonly companyName: string;
    readonly position: number;
    /** Documents this reader may open now (the data room's own answer). */
    readonly openDocumentIds: ReadonlySet<string>;
    readonly today: Date;
  },
): FounderPersonDto {
  const facts = source.facts;
  const age =
    facts !== null && facts.ageShared && facts.birthYear !== null
      ? ageFrom(facts.birthYear, context.today)
      : null;
  return {
    companyId: context.companyId,
    companyName: context.companyName,
    position: context.position,
    name: source.name,
    roleLine: [source.isFounder ? "Co-founder" : null, source.businessTitle]
      .filter((part): part is string => part !== null && part !== "")
      .join(" and ")
      .concat(`, ${context.companyName}`)
      .replace(/^, /, ""),
    location: facts?.location ?? null,
    identityVerified: source.identityVerified,
    age: age !== null && age >= 16 && age <= 110 ? age : null,
    buildingSince: facts?.buildingSince ?? null,
    companiesFounded: facts?.companiesFounded ?? null,
    exits: facts?.exits ?? null,
    inTheirWords: source.professionalSummary?.slice(0, 600) ?? null,
    lookingFor: facts?.lookingFor ?? null,
    background: source.background
      .filter((line) => line.shared)
      .slice(0, 20)
      .map((line) => ({
        from: line.fromYear === null ? null : String(line.fromYear),
        to: line.toYear === null ? null : String(line.toYear),
        current: line.toYear === null && line.fromYear !== null,
        title: line.title,
        detail: line.detail,
        evidence:
          line.supportingDocumentId !== null && context.openDocumentIds.has(line.supportingDocumentId)
            ? "MATCHES_SHARED_DOCUMENT"
            : "FOUNDERS_CLAIM",
      })),
  };
}
