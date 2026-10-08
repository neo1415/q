"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type {
  DiscoveredCompanyDto,
  DiscoveryReasonDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";
import {
  ArrowDown,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Globe,
  Handshake,
  ICON_SIZE,
  ICON_STROKE,
  MoreHorizontal,
  Share2,
} from "@capital-q/ui/icons";

import { CompanyAvatar, CompanyAvatarLink } from "../company/company-avatar";
import { moneyText } from "../company/money-text";
import { countryLabel, stageLabel } from "../company/declared-labels";
import { ExpressInterest } from "../network/express-interest";
import { useDockAvoid } from "../q-dock/dock-avoid";

import type { FeedPreloadPolicy } from "./feed/feed-state";
import { actionPlaybackSource } from "./feed/action-feed-transport";
import { FILTER_UNKNOWN_TEXT } from "./filters/discover-filters";
import { ruleList } from "./mandate-rules";
import { shareCompany, type ShareOutcome } from "./share-company";
import { attachHlsOrNativeSource } from "./player/hls-source";
import { PitchPlayer } from "./player/pitch-player";

/** A swipe down this far on the details sheet closes it. */
const SHEET_DISMISS_PX = 64;

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
  GEOGRAPHY_MATCH: "Location",
  BUSINESS_MODEL_MATCH: "Model",
  CUSTOMER_TYPE_MATCH: "Customers",
  DECLARED_DEPLOYING: "Status",
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
      <p className="cq-status-line">Nothing in common with your mandate yet.</p>
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

const DESKTOP = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
/** The intelligence panel's width: a desktop shows the fit beside the pitch. */
function useDesktopPanel(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

/** The few words a statement's axes earn on a card (ADR-001). */
export function evidenceWords(
  truthClass: string,
  evidenceStatus: string,
): string {
  if (truthClass === "VERIFIED") return "verified";
  if (evidenceStatus === "SELF_REPORTED" || truthClass === "USER_CLAIM") {
    return "founder-stated";
  }
  return "not verified";
}

/**
 * The card's declared facts beyond the name (Discover v2): sector and the
 * raise, only as the server read them for this reader. Unknown is said as
 * unknown ("Not shared with you"), never as zero or as nothing.
 */
function CardFacts({
  company,
  sectorLabels,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly sectorLabels: ReadonlyMap<string, string>;
}) {
  const summary = company.summary;
  if (summary === undefined) return null;
  const sectors = summary.sectorNodeIds
    .map((id) => sectorLabels.get(id))
    .filter((label): label is string => label !== undefined);
  const stage = stageLabel(company.currentStageCode);
  return (
    <dl className="cq-feed-facts" data-feed-facts>
      {sectors.length === 0 ? null : (
        <>
          <dt>Sector</dt>
          <dd>{sectors.slice(0, 3).join(", ")}</dd>
        </>
      )}
      {stage === null ? null : (
        <>
          <dt>Stage</dt>
          <dd>{stage}</dd>
        </>
      )}
      <dt>Raising</dt>
      <dd className="cq-numeric">
        {summary.raise === null ? (
          <span className="cq-feed-fact-unknown">Not shared with you</span>
        ) : (
          <>
            {moneyText(summary.raise.money)}{" "}
            <span className="cq-feed-fact-axis">
              {evidenceWords(
                summary.raise.truthClass,
                summary.raise.evidenceStatus,
              )}
            </span>
          </>
        )}
      </dd>
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
  onMore,
  showMedia = true,
  askQMark,
  feedNotes = null,
  videos,
  sectorLabels = NO_LABELS,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly policy: FeedPreloadPolicy;
  readonly reducedMotion: boolean;
  readonly saved: boolean;
  readonly deciding: boolean;
  readonly onSave: () => void;
  readonly onPass: () => void;
  readonly onAskQ: () => void;
  /** The pitch's options (speed, download, captions...): the rail's More. */
  readonly onMore?: (() => void) | undefined;
  /**
   * False inside the immersive feed, whose stage owns the players (three
   * recycled elements, spec §9.5); the card is then the company and its
   * decisions, over the stage on a phone and beside it on a desktop.
   */
  readonly showMedia?: boolean | undefined;
  /** Q's aperture in the Ask Q control: the dock merged into the rail. */
  readonly askQMark?: ReactNode;
  /** The feed's own notes, said in the details rather than over the pitch. */
  readonly feedNotes?: ReactNode;
  /**
   * When the company has several videos (ADR 0022): which one is showing,
   * how many there are, and how to move to the next. Absent with one.
   */
  readonly videos?:
    | {
        readonly index: number;
        readonly count: number;
        readonly onNext: () => void;
      }
    | undefined;
  /** The industry vocabulary's names, for the card's sector. */
  readonly sectorLabels?: ReadonlyMap<string, string> | undefined;
}) {
  // Stage first, then where: "Seed · Nigeria".
  const place = [
    stageLabel(company.currentStageCode),
    countryLabel(company.headquartersCountry),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const decisions = useRef<HTMLDivElement>(null);
  useDockAvoid(decisions);
  const unverified = company.unverifiedExclusions ?? [];
  const filterUnknown = company.filterUnknown ?? [];
  const sheetDrag = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The caption's "more": in place, over its own darker scrim (Discover v2).
  const [captionOpen, setCaptionOpen] = useState(false);
  const wide = useDesktopPanel();
  const [confirming, setConfirming] = useState(false);
  const openDetails = (confirm: boolean) => {
    setConfirming(confirm);
    setExpanded(true);
  };
  const [shared, setShared] = useState<ShareOutcome | null>(null);
  const reasons =
    company.reasons.length > 0 ? company.reasons : slateReasons(company);
  const open = wide || captionOpen;

  return (
    <article
      className="cq-feed-card flex w-full flex-col gap-5"
      aria-label={company.canonicalName}
      data-company-id={company.companyId}
      data-caption-open={captionOpen ? "" : undefined}
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

      {/*
        The caption over the pitch (Discover v2): the name with stage and
        place, two lines, and "more" that opens it in place. The scrim sits
        behind the words only, never a block over the picture.
      */}
      <div className="cq-feed-info flex flex-col gap-1" data-feed-summary>
        {company.sinceYouLastSaw === undefined ? null : (
          // Passed before, offered again because something is new (doc 19
          // §67). Words, not a colour or a badge.
          <p className="cq-caption cq-feed-muted" data-since-you-last-saw>
            {sinceYouLastSawLine(company.sinceYouLastSaw.change)}
          </p>
        )}
        {exploringLine(company.reasonCodes) === null ? null : (
          // Q.06: placed by the bounded exploration/diversity policy, not by
          // fit, so its fit out of 10 may be lower than the card below it.
          // Said in words, never a badge or a colour.
          <p className="cq-caption cq-feed-muted" data-exploring>
            {exploringLine(company.reasonCodes)}
          </p>
        )}
        <div className="cq-feed-company">
          {/* On a desktop the panel names the company with its mark; the
              rail's avatar is the way into the profile on both. */}
          <span className="cq-feed-panel-mark">
            <CompanyAvatar
              companyId={company.companyId}
              photoUrl={company.photoUrl}
              size={52}
            />
          </span>
          <span className="flex min-w-0 flex-col">
            <h2 className="cq-title-sm min-w-0 text-(--cq-text-primary)">
              {/* The name opens the company, as it does in any feed. */}
              <Link
                href={`/company/${company.companyId}`}
                className="underline-offset-4 hover:underline"
                data-feed-company-link
              >
                {company.canonicalName}
              </Link>
            </h2>
            {place === "" ? null : (
              <span className="cq-caption cq-feed-muted" data-feed-place>
                {place}
              </span>
            )}
          </span>
        </div>

        {company.shortDescription === null ? null : (
          <p
            className={`cq-body-sm max-w-(--cq-layout-narrow) text-(--cq-text-primary) ${open ? "" : "line-clamp-2"}`}
            data-feed-one-liner
          >
            {company.shortDescription}
          </p>
        )}

        {/*
          Filters the reader applied that this company could not be checked
          against (not stated, or a raise not shared with them): it stays
          in view and says which, in one short line (ux/discover-filters).
        */}
        {filterUnknown.length === 0 ? null : (
          <p className="cq-caption cq-feed-muted">
            {filterUnknown
              .map((dimension) => FILTER_UNKNOWN_TEXT[dimension])
              .join(" · ")}
          </p>
        )}

        {wide ? null : (
          <button
            type="button"
            className="cq-feed-more"
            aria-expanded={captionOpen}
            aria-controls={`cq-feed-more-${company.companyId}`}
            aria-label={
              captionOpen
                ? `Less about ${company.canonicalName}`
                : `More about ${company.canonicalName}`
            }
            onClick={() => setCaptionOpen((value) => !value)}
            data-feed-details-toggle
          >
            {captionOpen ? "less" : "more"}
          </button>
        )}
      </div>

      {/*
        What "more" opens on a phone, and what the panel always shows on a
        desktop (spec §9.2): the declared facts, why it is here, and the
        way into the profile. Declared alignment only; never a score.
      */}
      {open ? (
        <div
          className="cq-feed-more-body flex flex-col gap-4"
          id={`cq-feed-more-${company.companyId}`}
          data-feed-more
        >
          <CardFacts company={company} sectorLabels={sectorLabels} />
          <div className="cq-feed-why flex flex-col gap-1" data-feed-why>
            <h3 className="cq-label text-(--cq-text-primary)">
              Why it&apos;s here
            </h3>
            <Reasons reasons={reasons} />
            {unverified.length === 0 ? null : (
              <p className="cq-caption cq-feed-muted">
                Your {ruleList(unverified)} exclusion
                {unverified.length === 1 ? " wasn't" : "s weren't"} checked:
                this company hasn&apos;t stated it yet.
              </p>
            )}
          </div>
          {feedNotes}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/company/${company.companyId}`}
              className={buttonClassName("primary")}
              data-feed-open-profile
            >
              Open profile
            </Link>
            {/* Everything else, with Express interest at its first step:
                the website, the notes, and the server-confirmed decision. */}
            <Button
              variant="secondary"
              onClick={() => openDetails(false)}
              aria-haspopup="dialog"
              aria-expanded={expanded}
              data-feed-all-details
            >
              All details
            </Button>
          </div>
        </div>
      ) : null}

      <SheetRoot
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open);
          if (!open) setConfirming(false);
        }}
      >
        <SheetContent title={company.canonicalName} side="side">
          {/*
            In a portal, but still inside the feed in React's tree: its
            gestures and keys stop here so a scroll in the sheet never
            moves the feed, and a swipe down on it closes it.
          */}
          <div
            className="flex flex-col gap-5"
            data-feed-details
            onTouchStart={(event) => {
              event.stopPropagation();
              sheetDrag.current = event.touches[0]?.clientY ?? null;
            }}
            onTouchMove={(event) => event.stopPropagation()}
            onTouchEnd={(event) => {
              event.stopPropagation();
              const start = sheetDrag.current;
              sheetDrag.current = null;
              const end = event.changedTouches[0]?.clientY;
              const scroller = event.currentTarget.parentElement;
              if (
                start !== null &&
                end !== undefined &&
                end - start > SHEET_DISMISS_PX &&
                (scroller === null || scroller.scrollTop <= 0)
              ) {
                setExpanded(false);
              }
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              {place === "" ? null : (
                <p className="cq-caption text-(--cq-text-secondary)">{place}</p>
              )}
              {company.shortDescription === null ? null : (
                <p className="cq-body text-(--cq-text-primary)">
                  {company.shortDescription}
                </p>
              )}
              {company.pitch === null ? (
                <p className="cq-caption text-(--cq-text-secondary)">
                  No pitch to show yet.
                </p>
              ) : null}
            </div>

            <section className="flex flex-col gap-2" aria-label="Why it's here">
              <h3 className="cq-label text-(--cq-text-secondary)">
                Why it&apos;s here
              </h3>
              <Reasons reasons={reasons} />
              {/*
                Unknown never excludes (ADR 0020): a hard rule this
                company's own facts could not answer is said, quietly,
                rather than applied.
              */}
              {unverified.length === 0 ? null : (
                <p className="cq-caption text-(--cq-text-secondary)">
                  Your {ruleList(unverified)} exclusion
                  {unverified.length === 1 ? " wasn't" : "s weren't"} checked:
                  this company hasn&apos;t stated it yet.
                </p>
              )}
            </section>

            {company.websiteUrl === null ? null : (
              <p className="flex items-center gap-1.5">
                <Globe size={ICON_SIZE.compact} aria-hidden="true" />
                <span className="cq-caption break-all text-(--cq-text-secondary)">
                  {company.websiteUrl}
                </span>
              </p>
            )}

            {feedNotes}

            {/*
              Apart from Save and Pass on purpose: those are optimistic and
              this is server-confirmed (CQ-NET-010), and Interest ≠ Save.
              The rail's Interest opens it at its confirmation step.
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
        </SheetContent>
      </SheetRoot>

      {/*
        The action rail (spec §9.1; ADR 0017 C4; founder directive
        2026-09-27; Discover v2): the company's mark first -- the way into
        its profile is always there -- then the decisions, labelled, with
        no counters of any kind. A phone carries it down the right of the
        pitch on one quiet capsule; a desktop beside the 9:16 stage. The Q
        Dock never sits on it (spec §6.2).
      */}
      <div
        ref={decisions}
        className="cq-feed-rail"
        role="group"
        aria-label="Decide"
      >
        <span className="cq-feed-rail-profile">
          <CompanyAvatarLink
            companyId={company.companyId}
            companyName={company.canonicalName}
            photoUrl={company.photoUrl}
          />
          <span className="cq-feed-rail-label" aria-hidden="true">
            Profile
          </span>
        </span>
        <Button
          variant="quiet"
          onClick={() => openDetails(true)}
          className="cq-feed-rail-button"
          aria-haspopup="dialog"
          data-feed-interest
        >
          <Handshake
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
          />
          <span className="cq-feed-rail-label">Interest</span>
        </Button>
        {/* Unsaved reads as a quiet choice like Pass; saved is marked by
            the filled icon and the word (demo audit 2026-10-03: a filled
            Save read as already saved). */}
        <Button
          variant={saved ? "secondary" : "quiet"}
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
        {videos === undefined || videos.count < 2 ? null : (
          <Button
            variant="quiet"
            onClick={videos.onNext}
            className="cq-feed-rail-button"
            aria-label={`Next video from ${company.canonicalName}, video ${String(
              ((videos.index + 1) % videos.count) + 1,
            )} of ${String(videos.count)}`}
            data-feed-next-video
          >
            <ChevronRight
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
            <span className="cq-feed-rail-label">Next video</span>
          </Button>
        )}
        {onMore === undefined ? null : (
          <Button
            variant="quiet"
            onClick={onMore}
            className="cq-feed-rail-button"
            aria-haspopup="dialog"
            data-feed-more-options
          >
            <MoreHorizontal
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
            <span className="cq-feed-rail-label">More</span>
          </Button>
        )}
        <span className="sr-only" role="status">
          {shared === "COPIED" ? "Link to the company copied." : ""}
        </span>
      </div>
    </article>
  );
}

const NO_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * Discover is ordered by fit (fit-order.v1): a higher fit out of 10 is
 * never below a lower one, except where the exploration and diversity
 * policy placed a company. Those say so.
 */
const EXPLORING_CODES: ReadonlySet<string> = new Set([
  "EXPLORATION_SLOT",
  "DIVERSITY_ADJUSTMENT",
]);
export function exploringLine(reasonCodes: readonly string[]): string | null {
  return reasonCodes.some((code) => EXPLORING_CODES.has(code))
    ? "Exploring: placed here to widen your view, not by fit."
    : null;
}

/** The line on a passed company offered again (doc 19 §67). */
export function sinceYouLastSawLine(change: "NEW_PITCH" | null): string {
  return change === "NEW_PITCH"
    ? "New pitch since you last saw it. You passed on it before."
    : "Updated since you last saw it. You passed on it before.";
}
