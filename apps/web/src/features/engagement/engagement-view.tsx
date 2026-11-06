"use client";

import { useEffect } from "react";

import { engagementReporter } from "./engagement-reporter";

/**
 * Reports one view of a company surface when it is shown (Q Workspace §8
 * A1). Renders nothing. Never rendered for the company's own team; the
 * server drops those anyway.
 */
export function EngagementView({
  type,
  companyId,
}: {
  readonly type: "PROFILE_VIEW" | "Q_CARD_VIEW";
  readonly companyId: string;
}): null {
  useEffect(() => {
    engagementReporter().report({ type, companyId });
  }, [type, companyId]);
  return null;
}
