import type { QRetrievalFocus } from "@capital-q/q-runtime";

/**
 * The companies the turn reader bound this turn's words to (Q
 * intelligence step 3), as record ids: "it", "their", "its loan book"
 * pointing at a company, or at a figure or document of one. Taken only
 * from refs the reader returned and code checked against the ledger this
 * person was shown (step 3), never from recency or a guess. Binding grants
 * nothing: each id is still read through its tool's authorize step.
 */
export const BOUND_COMPANIES_MAX = 4;

export function boundCompaniesOf(
  focus: QRetrievalFocus | undefined,
): readonly string[] {
  if (focus === undefined) return [];
  const byRef = new Map(
    focus.ledger.entities.map((entity) => [entity.ref, entity]),
  );
  const ids: string[] = [];
  for (const ref of focus.boundRefs) {
    const entity = byRef.get(ref);
    if (entity === undefined) continue;
    const company =
      entity.kind === "COMPANY"
        ? entity
        : (entity.kind === "FIGURE" || entity.kind === "DOCUMENT") &&
            entity.of !== null
          ? byRef.get(entity.of)
          : undefined;
    if (company?.kind !== "COMPANY" || company.id === null) continue;
    if (!ids.includes(company.id)) ids.push(company.id);
  }
  return ids.slice(0, BOUND_COMPANIES_MAX);
}
