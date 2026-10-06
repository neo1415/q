/**
 * The fit panel's place on a company profile (overnight plan A1/B4).
 *
 * The match builder (build/match) owns the scores, their contract and this
 * panel's content; the profile only reserves the place, so the two can be
 * built in parallel and joined by name. Until filled it renders nothing a
 * reader could mistake for a score: an empty, labelled region.
 */
export function FitPanelSlot({
  companyId,
  companyName,
}: {
  readonly companyId: string;
  readonly companyName: string;
}) {
  return (
    <div
      data-fit-panel-slot={companyId}
      aria-label={`How ${companyName} fits your mandate`}
      role="region"
      className="empty:hidden"
    />
  );
}
