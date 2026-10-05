/**
 * @capital-q/results
 *
 * Owns: the per-person results read model (spec docs/specs/2026-10/admin.md
 * §5) and the report rendered from it (CSV; PDF through
 * @capital-q/deck-render). Does not own any record it reads: relationships,
 * commitments, interactions, rehearsals and documents stay with their
 * contexts. Server-side only; no model, no write.
 */
export {
  activitySeries,
  createResultsReader,
  ENGAGEMENT_FLOOR,
  resultsWindow,
  type RaisePort,
  type ResultsReader,
  type ResultsWindow,
} from "./reader.js";
export {
  money,
  reasonWords,
  resultsCsv,
  resultsDocument,
  resultsPdf,
  stateWords,
} from "./report.js";
