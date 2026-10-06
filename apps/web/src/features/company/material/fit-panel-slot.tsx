"use client";

import { FitPanel, useCompanyFit } from "@/features/fit";

/**
 * The fit panel's place on a company profile (overnight plan A1/B3/B4).
 *
 * The fit feature owns the scores and the panel's content (ADR 0052, 0059);
 * the profile only gives it a place. With no fit to show (not an investor,
 * no mandate yet, a company this reader may not see, the Q API unreachable)
 * the region stays empty and hidden rather than guessing a score.
 */
export function FitPanelSlot({
  companyId,
  companyName,
}: {
  readonly companyId: string;
  readonly companyName: string;
}) {
  const fit = useCompanyFit(companyId);
  return (
    <div
      data-fit-panel-slot={companyId}
      aria-label={`How ${companyName} fits your mandate`}
      role="region"
      className="empty:hidden"
    >
      <FitPanel companyId={companyId} name={companyName} fit={fit} />
    </div>
  );
}
