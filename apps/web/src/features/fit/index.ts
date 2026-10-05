/**
 * Fit with the reader's own mandate in the web app (ADR 0052). The
 * company profile's FitPanelSlot takes `FitPanel` with `useCompanyFit`.
 */
export { FitPanel } from "./fit-panel";
export { useCompanyFit, type CompanyFit } from "./use-company-fit";
export { FitScore, FitRows, FitBreakdownSheet } from "./fit-breakdown";
export { FitComparisonView, WhyTheseSheet } from "./fit-comparison";
export { RelationshipFitChips } from "./relationship-fit-chips";
export { QViewNote, LazyQViewNote } from "./q-view-note";
