"use client";

import Link from "next/link";

import type {
  DiscoveredCompanyDto,
  DiscoveryReasonDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Building2, Globe, ICON_SIZE } from "@capital-q/ui/icons";

import { countryLabel, stageLabel } from "../company/declared-labels";
import { ExpressInterest } from "../network/express-interest";

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

/**
 * What the persisted slate says two declared profiles share (CQ-REC-006).
 *
 * The feed is served from the slate, whose items carry bounded alignment
 * codes and no per-reason detail (`reasons` is empty on that path), so
 * the card has to read the codes. It did not, and every company in a
 * real feed said "nothing declared in common" — including a Nigerian
 * pre-seed company in front of a Nigeria, pre-seed-to-seed mandate
 * (CQ-ACCEPT-001). The detail is the company's own declared value; the
 * mandate's side is never quoted. A code this card does not know is not
 * shown rather than guessed at.
 */
function slateReasons(company: DiscoveredCompanyDto): DiscoveryReasonDto[] {
  const stage = stageLabel(company.currentStageCode);
  const country = countryLabel(company.headquartersCountry);
  const reasons: DiscoveryReasonDto[] = [];
  for (const code of company.reasonCodes) {
    switch (code) {
      case "STAGE_ALIGNED":
        reasons.push({
          kind: "STAGE_IN_RANGE",
          detail:
            stage === null ? "In your stage range" : `${stage}, in your range`,
        });
        break;
      case "GEOGRAPHY_COUNTRY_ALIGNED":
        reasons.push({
          kind: "GEOGRAPHY_MATCH",
          detail:
            country === null
              ? "A country you invest in"
              : `${country}, a country you invest in`,
        });
        break;
      case "GEOGRAPHY_REGION_ALIGNED":
        reasons.push({
          kind: "GEOGRAPHY_MATCH",
          detail: "In a region you invest in",
        });
        break;
      case "TAXONOMY_EXACT":
        reasons.push({
          kind: "SECTOR_MATCH",
          detail: "A category you named",
        });
        break;
      case "TAXONOMY_RELATED":
        reasons.push({
          kind: "SECTOR_MATCH",
          detail: "Close to a category you named",
        });
        break;
      default:
        break;
    }
  }
  return reasons;
}

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
  const place = [
    countryLabel(company.headquartersCountry),
    stageLabel(company.currentStageCode),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <article
      className="flex h-full w-full flex-col gap-5"
      aria-label={company.canonicalName}
      data-company-id={company.companyId}
    >
      {/*
        No pitch, and nothing pretending to be one: no frame is reserved
        for a video that does not exist. It used to be an empty 9:16 box,
        taller than a laptop screen, with the company below the fold — the
        "broken empty video screen" the first viewport showed an investor
        (CQ-ACCEPT-001). Without a pitch, the company leads.
      */}
      {company.pitch === null ? null : (
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

        {company.pitch === null ? (
          <p className="cq-caption text-(--cq-text-tertiary)">
            No pitch video yet. This is what {company.canonicalName} has
            declared.
          </p>
        ) : null}

        {company.shortDescription === null ? null : (
          <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
            {company.shortDescription}
          </p>
        )}

        <Reasons
          reasons={
            company.reasons.length > 0 ? company.reasons : slateReasons(company)
          }
        />

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

      {/*
        Apart from Save and Pass on purpose: those are optimistic and this
        is server-confirmed (CQ-NET-010), and Interest ≠ Save.
      */}
      <ExpressInterest
        companyId={company.companyId}
        companyName={company.canonicalName}
        surface="RECOMMENDATION_FEED"
      />
    </article>
  );
}
