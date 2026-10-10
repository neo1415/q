import {
  EXTERNAL_REHEARSAL_LABEL,
  type ExternalSimulationDto,
  type QPersonaSourceDto,
} from "@capital-q/contracts";

import { plain } from "./external-persona.js";
import { scenarioFor, simulationTitle } from "./external-scenarios.js";
import type { ExternalSubjectRecord } from "./external-subjects.js";

/** The chip on the rehearsal screen. */
export const SIMULATION_CHIP = "Research-informed simulation";

const KIND_WORDS = {
  PERSON: null,
  ORGANIZATION: "Organisation",
  GOVERNMENT_AGENCY: "Government agency",
} as const;

/**
 * How the rehearsal screen labels and shows a researched entity: the chip,
 * the long label, the permitted portrait or logo (our stored asset only),
 * a role or category, one line from the sourced brief, source quotes
 * (display-only) and the public sources. All from stored data: no lookup.
 */
export function externalSimulation(
  record: ExternalSubjectRecord,
  sources: readonly QPersonaSourceDto[],
): ExternalSimulationDto {
  const { subject, brief, presentation } = record;
  const entityKind = presentation?.entityKind ?? "PERSON";
  const scenario = scenarioFor({
    displayName: subject.displayName,
    nameVariants: subject.nameVariants,
    entityKind,
  });
  const title = simulationTitle(
    scenario,
    plain(subject.displayName, 120),
    subject.organization,
  );
  const headline =
    entityKind === "PERSON"
      ? [subject.role, subject.organization]
          .filter((x): x is string => x !== null && x.trim().length > 0)
          .map((x) => plain(x, 80))
          .join(" at ") || null
      : [KIND_WORDS[entityKind], subject.location]
          .filter((x): x is string => x !== null && x.trim().length > 0)
          .join(", ");
  // One sourced line: the first uncontested role or background statement.
  const line = brief?.assertions.find(
    (a) =>
      (a.topic === "CURRENT_ROLE" || a.topic === "BACKGROUND") &&
      a.sourceRefs.length > 0 &&
      a.assertionClass !== "UNKNOWN" &&
      a.assertionClass !== "CONTRADICTORY_OR_STALE",
  );
  return {
    label: SIMULATION_CHIP,
    title,
    disclaimer: `${title}. ${EXTERNAL_REHEARSAL_LABEL}. It is not the real ${entityKind === "PERSON" ? "person" : "organisation or any of its staff"} and does not predict what they would say.`,
    entityKind,
    // Only our own stored asset: the card saves an https asset URL it holds.
    imageUrl: presentation?.image?.assetUrl ?? null,
    imageAttribution: presentation?.image?.attribution ?? null,
    headline: headline === "" ? null : headline,
    description: line === undefined ? null : plain(line.text, 240),
    quotes: (presentation?.quotes ?? []).map((q) => ({
      quote: q.quote,
      sourceLabel: q.sourceLabel,
      sourceUrl: q.sourceUrl,
    })),
    sources: sources
      .filter(
        (s): s is QPersonaSourceDto & { url: string } => s.url !== null,
      )
      .slice(0, 12)
      .map((s) => ({ label: s.label, url: s.url })),
  };
}
