/**
 * What to call a kind of document Q prepared, wherever it is shown: the
 * answer card, the Board, the viewer.
 *
 * Artifact types are reference data that grows (contracts `artifact.ts`):
 * a type this build has not heard of is still a document the person can
 * open and download, so it gets the generic label and never disappears.
 */
const ARTIFACT_TYPE_LABELS: Readonly<Record<string, string>> = {
  INVESTMENT_BRIEF: "Investment brief",
  PITCH_DECK: "Investor deck",
  INVESTOR_MANDATE: "Investment mandate",
  Q_REPORT: "Report",
};

export function artifactTypeLabel(type: string): string {
  return ARTIFACT_TYPE_LABELS[type] ?? "Document";
}
