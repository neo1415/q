"use client";

import { useSyncExternalStore } from "react";

import type {
  DiscoveredCompanyDto,
  PitchSummaryDto,
} from "@capital-q/contracts";

import { actionPlaybackSource } from "./feed/action-feed-transport";
import { attachHlsOrNativeSource } from "./player/hls-source";
import { PitchPlayer } from "./player/pitch-player";
import { prefersReducedMotion } from "./player/use-pitch-playback";

/**
 * A company's pitch outside the feed (doc 19 §66–68; founder report
 * 2026-10-02): on the company page, in Saved, in Passed. It plays for
 * anyone the server lets play it, whatever that person saved or passed:
 * pass and save are feed decisions, not access. Poster first, nothing
 * fetched until Play (R36), one player per page section.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !("matchMedia" in window)) {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function asPlayable(company: {
  readonly companyId: string;
  readonly canonicalName: string;
  readonly websiteUrl?: string | null | undefined;
  readonly headquartersCountry?: string | null | undefined;
  readonly currentStageCode?: string | null | undefined;
  readonly shortDescription?: string | null | undefined;
  readonly pitch: PitchSummaryDto;
}): DiscoveredCompanyDto {
  return {
    companyId: company.companyId,
    canonicalName: company.canonicalName,
    websiteUrl: company.websiteUrl ?? null,
    headquartersCountry: company.headquartersCountry ?? null,
    currentStageCode: company.currentStageCode ?? null,
    shortDescription: company.shortDescription ?? null,
    reasons: [],
    reasonCodes: [],
    pitch: company.pitch,
  };
}

export function CompanyPitch({
  company,
}: {
  readonly company: Parameters<typeof asPlayable>[0];
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );
  return (
    <div className="w-full max-w-xs" data-company-pitch={company.companyId}>
      <PitchPlayer
        company={asPlayable(company)}
        policy="ACTIVE"
        authorize={actionPlaybackSource(company.companyId)}
        reducedMotion={reducedMotion}
        attachSource={attachHlsOrNativeSource}
        startOnRequest
      />
    </div>
  );
}
