"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  type FitCompanyDto,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import { ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";

import { FitPanel, useCompanyFit, type CompanyFit } from "@/features/fit";
import { useT } from "@/features/i18n/language";
import { CompanyScores } from "@/features/scores";
import { UnicornPotential } from "@/features/scores/unicorn-potential";

/**
 * The fit panel's place on a company profile (overnight plan A1/B3/B4).
 *
 * The fit feature owns the scores and the panel's content (ADR 0052, 0059);
 * the profile only gives it a place. With no fit to show (not an investor,
 * no mandate yet, a company this reader may not see, the Q API unreachable)
 * the region stays empty and hidden rather than guessing a score.
 *
 * The overview declutter (2026-10-08): the fit is read ONCE per profile
 * (ProfileFitProvider) and shown twice from that read -- a word in the
 * summary strip, and the panel. On a phone the panel is folded behind its
 * one-line summary; on a large screen it is the open rail it always was.
 */

const ProfileFit = createContext<CompanyFit>({ status: "NONE" });

export function ProfileFitProvider({
  companyId,
  initial,
  children,
}: {
  readonly companyId: string;
  /** A fit already in hand (design review); undefined reads it once. */
  readonly initial?: FitCompanyDto | null | undefined;
  readonly children: ReactNode;
}) {
  const fit = useCompanyFit(companyId, { initial });
  return <ProfileFit.Provider value={fit}>{children}</ProfileFit.Provider>;
}

/** The profile's one fit read (NONE outside a provider). */
export function useProfileFit(): CompanyFit {
  return useContext(ProfileFit);
}

/** "Good fit · Moderate confidence", or null while there is none to show. */
export function fitWords(fit: CompanyFit): string | null {
  if (fit.status !== "READY") return null;
  const { band, confidence } = fit.fit.profile;
  return `${FIT_BAND_LABELS[band]} · ${FIT_CONFIDENCE_LABELS[confidence]}`;
}

/** The summary strip's fit cell: words only, absent when there is no fit. */
export function FitStripCell() {
  const t = useT();
  const fit = useContext(ProfileFit);
  if (fit.status !== "READY") return null;
  const { band, confidence } = fit.fit.profile;
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-strip-fit>
      <dt className="cq-caption text-(--cq-text-secondary)">
        {t("Fit with you")}
      </dt>
      <dd className="cq-title-sm text-(--cq-text-primary)">
        {t(FIT_BAND_LABELS[band])}
        <span className="cq-caption block font-normal text-(--cq-text-secondary)">
          {t(FIT_CONFIDENCE_LABELS[confidence])}
        </span>
      </dd>
    </div>
  );
}

/**
 * Investability and Suitability at the top of the profile, beside "Fit
 * with you" (owner 2026-10-16): from the same single fit read, so the
 * Suitability shown is exactly the fit the panel explains. Exported for the
 * overview's own slot; renders nothing until the scores are known.
 */
export function ProfileCompanyScores({
  className,
}: {
  readonly className?: string | undefined;
}) {
  const fit = useContext(ProfileFit);
  if (fit.status !== "READY" || fit.fit.scores === undefined) return null;
  return (
    <CompanyScores
      scores={fit.fit.scores}
      variant="full"
      unicornDetails={false}
      className={className}
    />
  );
}

/** Same authorized profile read, with room for evidence and twelve pillars. */
export function ProfileUnicornAssessment() {
  const fit = useContext(ProfileFit);
  if (fit.status !== "READY" || fit.fit.scores?.unicornPotential === undefined)
    return null;
  return (
    <UnicornPotential
      companyId={fit.fit.companyId}
      score={fit.fit.scores.unicornPotential}
    />
  );
}

export function FitPanelSlot({
  companyId,
  companyName,
  relationshipState = null,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly relationshipState?: RelationshipStateV2 | null | undefined;
}) {
  const t = useT();
  const fit = useContext(ProfileFit);
  if (fit.status === "NONE") return null;
  const words = fitWords(fit);
  return (
    <details
      className="group border-y border-(--cq-border-subtle) lg:border-0 lg:[&::details-content]:[content-visibility:visible]"
      data-fit-panel-slot={companyId}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-2 lg:hidden [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col">
          <span className="cq-title-sm text-(--cq-text-primary)">
            {t("Fit with your mandate")}
          </span>
          <span className="cq-body-sm text-(--cq-text-secondary)">
            {words ?? "Reading your fit…"}
          </span>
        </span>
        <ChevronDown
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="shrink-0 text-(--cq-text-tertiary) transition-transform group-open:rotate-180"
        />
      </summary>
      <div
        aria-label={`How ${companyName} fits your mandate`}
        role="region"
        className="pb-3 empty:hidden lg:pb-0"
      >
        <ProfileCompanyScores className="mb-3" />
        <FitPanel
          companyId={companyId}
          name={companyName}
          fit={fit}
          relationshipState={relationshipState}
        />
      </div>
    </details>
  );
}
