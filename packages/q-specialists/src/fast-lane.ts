import type { TurnSkimResult } from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

/**
 * The fast lane (founder brief K, 2026-10-09): a turn the short first read
 * (TURN_SKIM) names, with HIGH confidence, as companies of a kind or as
 * fit, is answered by the read-only app query at once instead of after the
 * full turn reading (p50 1.2 s hosted). Read-only by construction: the
 * worst a misread can do is show a list nobody asked for, never act. A
 * turn about companies already shown needs the reader's references and
 * waits for it; everything else is null and waits, as before.
 */
export type FastLane = Required<Pick<QAnswerRequest, "questionKind">> &
  Pick<QAnswerRequest, "discoverCompanies" | "fitQuestion" | "personSearch">;

export function fastLaneOf(
  skim: TurnSkimResult | null,
  utterance: string,
): FastLane | null {
  if (skim === null || skim.confidence !== "HIGH") return null;
  const text = utterance.trim().slice(0, 1_000);
  if (text.length === 0) return null;
  if (skim.kind === "DISCOVER_COMPANIES") {
    const discover = skim.discover;
    if (discover === null || discover.previous) return null;
    // Companies "of a kind" names a kind; with none it is a fit question.
    if (
      discover.sectors.length === 0 &&
      discover.countries.length === 0 &&
      discover.stages.length === 0
    ) {
      return null;
    }
    return {
      questionKind: "DISCOVER_COMPANIES",
      discoverCompanies: {
        text,
        sectors: discover.sectors,
        countries: discover.countries.map((code) => code.toUpperCase()),
        stages: discover.stages,
        count: skim.count,
        ranking: discover.ranking,
        mandateRelevant: discover.mandateRelevant,
        previous: false,
      },
    };
  }
  if (skim.kind === "PERSON_SEARCH") {
    // Read-only and public-only: the worst a misread can do is show a
    // card for a name nobody asked about, never act.
    const person = skim.person;
    if (person === null) return null;
    return {
      questionKind: "PERSON_SEARCH",
      personSearch: {
        name: person.name,
        entityKind: person.kind,
        city: person.city,
        country: person.country,
        organization: person.organization,
        role: person.role,
        freshSearch: person.freshSearch,
      },
    };
  }
  if (skim.kind === "FIT") {
    return {
      questionKind: "FIT",
      fitQuestion: { text, count: skim.count, previous: false },
    };
  }
  return null;
}
