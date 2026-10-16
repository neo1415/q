/**
 * Investability and Suitability in the web app (owner 2026-10-16; ADR 0074).
 * One component, one DTO (contracts `CompanyScoresDto`), on every surface.
 */
export {
  CompanyScores,
  CompanyScoresFor,
  CompanyScoresLive,
  companyScoresLabel,
  type CompanyScoresVariant,
} from "./company-scores";
export {
  resetCompanyScoresCache,
  useCompanyScores,
  type ScoresPort,
} from "./use-company-scores";
