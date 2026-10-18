import type { DeckSection } from "@capital-q/contracts";
import { metricDate } from "./structured-facts.js";
const FUNCTION_LABELS: Readonly<
  Record<string, "TECHNICAL" | "COMMERCIAL" | "OPERATIONAL">
> = {
  engineering: "TECHNICAL",
  "engineering headcount": "TECHNICAL",
  "engineering and ml": "TECHNICAL",
  "engineering and bioinformatics": "TECHNICAL",
  "technical headcount": "TECHNICAL",
  sales: "COMMERCIAL",
  commercial: "COMMERCIAL",
  "go-to-market headcount": "COMMERCIAL",
  "sales headcount": "COMMERCIAL",
  operations: "OPERATIONAL",
  "customer operations": "OPERATIONAL",
  "field operations": "OPERATIONAL",
  "operations headcount": "OPERATIONAL",
};
/** C2 P9.A: dated declared function coverage, never quality or milestone execution. */
export function typedTeamCoverage(section: DeckSection | undefined): readonly {
  readonly index: number;
  readonly function: "TECHNICAL" | "COMMERCIAL" | "OPERATIONAL";
  readonly at: string;
}[] {
  if (
    section === undefined ||
    section.section !== "TEAM" ||
    section.status === "UNCLEAR" ||
    section.status === "NOT_IN_DECK"
  )
    return [];
  const groups = new Map<
    string,
    {
      index: number;
      function: "TECHNICAL" | "COMMERCIAL" | "OPERATIONAL";
      at: string;
      count: number;
    }[]
  >();
  for (const [index, fact] of section.facts.entries()) {
    const fn = FUNCTION_LABELS[fact.label.trim().toLowerCase()];
    if (fn === undefined) continue;
    if (
      fact.kind !== "FIGURE" ||
      fact.value === null ||
      fact.unknownReason !== null ||
      fact.truthClass !== "USER_CLAIM" ||
      (fact.evidenceStatus !== "SELF_REPORTED" &&
        fact.evidenceStatus !== "DOCUMENT_SUPPORTED")
    )
      return [];
    const value =
      /^([1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\s+(?:people|persons|FTEs?))?$/iu.exec(
        fact.value.trim(),
      );
    const count = value === null ? NaN : Number(value[1]?.replaceAll(",", ""));
    const at = metricDate(fact.asOf);
    if (!Number.isSafeInteger(count) || count <= 0 || at === null) return [];
    const items = groups.get(fn) ?? [];
    items.push({ index, function: fn, count, at });
    groups.set(fn, items);
  }
  if (!["TECHNICAL", "COMMERCIAL", "OPERATIONAL"].every((fn) => groups.has(fn)))
    return [];
  const selected = [...groups.values()].flat();
  const first = selected[0];
  if (first === undefined || selected.some((item) => item.at !== first.at))
    return [];
  // Conflicting duplicate field assertions cannot be silently resolved to a preferred count.
  if (
    [...groups.values()].some((items) =>
      items.some((item) => item.count !== items[0]?.count),
    )
  )
    return [];
  return selected.map(({ index, function: fn, at }) => ({
    index,
    function: fn,
    at,
  }));
}
