"use client";

import { useEffect } from "react";

import { reportInvestorViewAction } from "./investor-view-actions";

function clientEventId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `ivw-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Reports one view of an investor's profile when it is shown (who viewed
 * an investor). Renders nothing; one id per page view, so a retry is one.
 */
export function InvestorViewBeacon({
  investorOrganisationId,
}: {
  readonly investorOrganisationId: string;
}): null {
  useEffect(() => {
    void reportInvestorViewAction({
      clientEventId: clientEventId(),
      investorOrganisationId,
      occurredAt: new Date().toISOString(),
    });
  }, [investorOrganisationId]);
  return null;
}
