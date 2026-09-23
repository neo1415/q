"use client";

import Link from "next/link";

import type {
  DiscoveredCompanyDto,
  DiscoveryReasonDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Building2, Globe, ICON_SIZE } from "@capital-q/ui/icons";

import type { FeedPreloadPolicy } from "./feed/feed-state";
import { actionPlaybackSource } from "./feed/action-feed-transport";
import { attachHlsOrNativeSource } from "./player/hls-source";
import { PitchPlayer } from "./player/pitch-player";

/**
 * One company in the feed (CQ-WEB-022; doc 17 §66-§68, doc 19 §44-§45).
 *
 * What is absent is the design. There is no score, no percentage, no fit
 * meter, no "top match" badge and nowhere to put one: doc 19 forbids
 * presenting the ranking's arithmetic as a judgement, so the card says
 * only what was declared and in whose vocabulary. Pass is a quiet
 * secondary control, never danger — a pass is "not now", not a verdict.
 */

const REASON_LABELS: Readonly<Record<DiscoveryReasonDto["kind"], string>> = {
  STAGE_IN_RANGE: "Stage",
  SECTOR_MATCH: "Sector",
  GEOGRAPHY_MATCH: "Where",
  BUSINESS_MODEL_MATCH: "Model",
  CUSTOMER_TYPE_MATCH: "Customers",
  DECLARED_DEPLOYING: "Deploying",
  PROFILE_COMPLETE: "Profile",
};

function Reasons({
  reasons,
}: {
  readonly reasons: readonly DiscoveryReasonDto[];
}) {
  if (reasons.length === 0) {
    return (
      <p className="cq-status-line">
        Discoverable, with nothing declared in common yet.
      </p>
    );
  }
  return (
    <dl className="flex flex-col gap-1">
      {reasons.map((reason) => (
        <div key={`${reason.kind}-${reason.detail}`} className="flex gap-2">
          <dt className="cq-label text-(--cq-text-tertiary)">
            {REASON_LABELS[reason.kind]}
          </dt>
          <dd className="cq-body-sm text-(--cq-text-secondary)">
            {reason.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FeedCard({
  company,
  policy,
  reducedMotion,
  saved,
  deciding,
  onSave,
  onPass,
  onAskQ,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly policy: FeedPreloadPolicy;
  readonly reducedMotion: boolean;
  readonly saved: boolean;
  readonly deciding: boolean;
  readonly onSave: () => void;
  readonly onPass: () => void;
  readonly onAskQ: () => void;
}) {
  const place = [company.headquartersCountry, company.currentStageCode]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <article
      className="flex h-full w-full flex-col gap-5"
      aria-label={company.canonicalName}
      data-company-id={company.companyId}
    >
      {company.pitch === null ? (
        /*
          No pitch, and nothing pretending to be one. A still frame with a
          play control over it would promise a video that does not exist.
        */
        <div
          className="flex items-center justify-center rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) p-8"
          style={{ aspectRatio: "9 / 16" }}
        >
          <p className="cq-body-sm max-w-(--cq-layout-narrow) text-center text-(--cq-text-tertiary)">
            No pitch video yet. Everything below is what {company.canonicalName}{" "}
            has declared.
          </p>
        </div>
      ) : (
        <PitchPlayer
          company={company}
          policy={policy}
          authorize={actionPlaybackSource(company.companyId)}
          reducedMotion={reducedMotion}
          attachSource={attachHlsOrNativeSource}
        />
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Building2 size={ICON_SIZE.regular} aria-hidden="true" />
          <h2 className="cq-title-sm text-(--cq-text-primary)">
            {company.canonicalName}
          </h2>
        </div>

        {place === "" ? null : (
          <p className="cq-caption text-(--cq-text-tertiary)">{place}</p>
        )}

        {company.shortDescription === null ? null : (
          <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
            {company.shortDescription}
          </p>
        )}

        <Reasons reasons={company.reasons} />

        {company.websiteUrl === null ? null : (
          <p className="flex items-center gap-1.5">
            <Globe size={ICON_SIZE.compact} aria-hidden="true" />
            <span className="cq-caption break-all text-(--cq-text-tertiary)">
              {company.websiteUrl}
            </span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={saved ? "secondary" : "primary"}
          aria-pressed={saved}
          disabled={deciding}
          onClick={onSave}
        >
          {saved ? "Saved" : "Save"}
        </Button>
        {/* Pass is neutral: quiet, never danger, never red. */}
        <Button variant="quiet" disabled={deciding} onClick={onPass}>
          Pass
        </Button>
        <Button variant="secondary" onClick={onAskQ}>
          Ask Q
        </Button>
        <Link
          href={`/company/${company.companyId}`}
          className={buttonClassName("quiet")}
        >
          Open company
        </Link>
      </div>
    </article>
  );
}
