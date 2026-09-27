"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";

import type {
  DiscoveredCompanyDto,
  DiscoveryReasonDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import {
  ArrowDown,
  Bookmark,
  BookmarkCheck,
  Building2,
  ChevronDown,
  ChevronUp,
  Globe,
  Handshake,
  ICON_SIZE,
  ICON_STROKE,
  Share2,
} from "@capital-q/ui/icons";

import { countryLabel, stageLabel } from "../company/declared-labels";
import { ExpressInterest } from "../network/express-interest";
import { useDockAvoid } from "../q-dock";

import type { FeedPreloadPolicy } from "./feed/feed-state";
import { actionPlaybackSource } from "./feed/action-feed-transport";
import { ruleList } from "./mandate-rules";
import { shareCompany, type ShareOutcome } from "./share-company";
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
  showMedia = true,
  askQMark,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly policy: FeedPreloadPolicy;
  readonly reducedMotion: boolean;
  readonly saved: boolean;
  readonly deciding: boolean;
  readonly onSave: () => void;
  readonly onPass: () => void;
  readonly onAskQ: () => void;
  /**
   * False inside the immersive feed, whose stage owns the players (three
   * recycled elements, spec §9.5); the card is then the company and its
   * decisions, over the stage on a phone and beside it on a desktop.
   */
  readonly showMedia?: boolean | undefined;
  /** Q's aperture in the Ask Q control: the dock merged into the rail. */
  readonly askQMark?: ReactNode;
}) {
  const place = [
    countryLabel(company.headquartersCountry),
    stageLabel(company.currentStageCode),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const decisions = useRef<HTMLDivElement>(null);
  useDockAvoid(decisions);
  const unverified = company.unverifiedExclusions ?? [];
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [shared, setShared] = useState<ShareOutcome | null>(null);

  return (
    <article
      className="cq-feed-card flex h-full w-full flex-col gap-5"
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
      {company.pitch === null || !showMedia ? null : (
        <PitchPlayer
          company={company}
          policy={policy}
          authorize={actionPlaybackSource(company.companyId)}
          reducedMotion={reducedMotion}
          attachSource={attachHlsOrNativeSource}
        />
      )}

      <div className="cq-feed-info flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Building2 size={ICON_SIZE.regular} aria-hidden="true" />
          <h2 className="cq-title-sm text-(--cq-text-primary)">
            {/* The name opens the company, as it does in any feed. */}
            <Link
              href={`/company/${company.companyId}`}
              className="underline-offset-4 hover:underline"
              data-feed-company-link
            >
              {company.canonicalName}
            </Link>
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
          <p
            className={cx(
              "cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)",
              expanded && "line-clamp-none",
            )}
          >
            {company.shortDescription}
          </p>
        )}

        {/*
          On a phone the overlay stays short so the pitch is the screen;
          the reasons, the website and Express Interest are one tap away.
          A desktop panel has the room and always shows them.
        */}
        <button
          type="button"
          className="cq-caption inline-flex min-h-11 items-center gap-1 self-start text-(--cq-text-secondary) lg:hidden"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((open) => !open)}
          data-feed-details-toggle
        >
          {expanded ? "Less" : "More about this company"}
          {expanded ? (
            <ChevronDown aria-hidden="true" size={ICON_SIZE.compact} />
          ) : (
            <ChevronUp aria-hidden="true" size={ICON_SIZE.compact} />
          )}
        </button>

        <div
          id={detailsId}
          className={cx(
            "flex-col gap-3 lg:flex",
            expanded
              ? "flex max-h-[45dvh] overflow-y-auto lg:max-h-none lg:overflow-visible"
              : "hidden",
          )}
          data-feed-details
        >
          <Reasons
            reasons={
              company.reasons.length > 0
                ? company.reasons
                : slateReasons(company)
            }
          />

          {/*
            Unknown never excludes (ADR 0020): a hard rule this company's own
            facts could not answer is said, quietly, rather than applied.
          */}
          {unverified.length === 0 ? null : (
            <p className="cq-caption text-(--cq-text-tertiary)">
              Your {ruleList(unverified)} exclusion
              {unverified.length === 1 ? " wasn't" : "s weren't"} checked: this
              company hasn&apos;t stated it yet.
            </p>
          )}

          {company.websiteUrl === null ? null : (
            <p className="flex items-center gap-1.5">
              <Globe size={ICON_SIZE.compact} aria-hidden="true" />
              <span className="cq-caption break-all text-(--cq-text-tertiary)">
                {company.websiteUrl}
              </span>
            </p>
          )}

          {/*
            Apart from Save and Pass on purpose: those are optimistic and
            this is server-confirmed (CQ-NET-010), and Interest ≠ Save. The
            rail's Interest only opens this at its confirmation step.
          */}
          <div className="cq-feed-interest">
            <ExpressInterest
              key={confirming ? "confirming" : "idle"}
              companyId={company.companyId}
              companyName={company.canonicalName}
              surface="RECOMMENDATION_FEED"
              startConfirming={confirming}
            />
          </div>
        </div>
      </div>

      {/*
        The action rail (spec §9.1; ADR 0017 C4; founder directive
        2026-09-27): labelled, and no counters of any kind -- nothing here
        counts views, saves or shares. On a phone it runs down the right of
        the stage; on a desktop it is a row in the intelligence panel,
        where Express Interest is already in view. The Q Dock never sits on
        it (spec §6.2).
      */}
      <div
        ref={decisions}
        className="cq-feed-rail"
        role="group"
        aria-label="Decide"
      >
        <Button
          variant={saved ? "secondary" : "primary"}
          aria-pressed={saved}
          disabled={deciding}
          onClick={onSave}
          className="cq-feed-rail-button"
        >
          {saved ? (
            <BookmarkCheck
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          ) : (
            <Bookmark
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          )}
          <span className="cq-feed-rail-label">{saved ? "Saved" : "Save"}</span>
        </Button>
        {/* Pass is neutral: quiet, never danger, never red. */}
        <Button
          variant="quiet"
          disabled={deciding}
          onClick={onPass}
          className="cq-feed-rail-button"
        >
          <ArrowDown
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
          />
          <span className="cq-feed-rail-label">Pass</span>
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setExpanded(true);
            setConfirming(true);
          }}
          className="cq-feed-rail-button lg:hidden"
          aria-controls={detailsId}
          data-feed-interest
        >
          <Handshake
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
          />
          <span className="cq-feed-rail-label">Interest</span>
        </Button>
        <Button
          variant="secondary"
          onClick={onAskQ}
          className="cq-feed-rail-button"
          data-feed-ask-q
        >
          {askQMark}
          <span className="cq-feed-rail-label">Ask Q</span>
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            void shareCompany(company).then(setShared);
          }}
          className="cq-feed-rail-button"
          data-feed-share
        >
          <Share2
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
          />
          <span className="cq-feed-rail-label">
            {shared === "COPIED" ? "Link copied" : "Share"}
          </span>
        </Button>
        <span className="sr-only" role="status">
          {shared === "COPIED" ? "Link to the company copied." : ""}
        </span>
      </div>
    </article>
  );
}
