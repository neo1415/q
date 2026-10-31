"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type {
  CompanyScoresDto,
  DiscoveredCompanyDto,
  DiscoveryReasonDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";
import {
  ArrowDown,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronRight,
  CircleHelp,
  Globe,
  ICON_SIZE,
  ICON_STROKE,
  Minus,
  MoreHorizontal,
  Share2,
} from "@capital-q/ui/icons";

import { CompanyAvatar, CompanyAvatarLink } from "../company/company-avatar";
import { compactMoneyText } from "../company/money-text";
import { RaiseFact } from "../company/raise-fact";
import { raiseWords, translatedRaise } from "../company/raise-words";
import { countryLabel, stageLabel } from "../company/declared-labels";
import {
  ExpressInterest,
  type ExpressInterestPort,
} from "../network/express-interest";
import { useDockAvoid } from "../q-dock/dock-avoid";

import type { FeedPreloadPolicy } from "./feed/feed-state";
import { actionPlaybackSource } from "./feed/action-feed-transport";
import { FILTER_UNKNOWN_TEXT } from "./filters/discover-filters";
import { ruleList } from "./mandate-rules";
import { shareCompany, type ShareOutcome } from "./share-company";
import { attachHlsOrNativeSource } from "./player/hls-source";
import { PitchPlayer } from "./player/pitch-player";
import { useT } from "@/features/i18n/language";
import { useCompanyScores } from "@/features/scores";
import { QRead } from "./q-read";

/** A swipe down this far on the details sheet closes it. */
const SHEET_DISMISS_PX = 64;

/**
 * One company in the feed (CQ-WEB-022; doc 17 §66-§68, doc 19 §44-§45).
 *
 * What is absent is the design. There is no percentage, no fit meter, no
 * "top match" badge: doc 19 forbids presenting the ranking's arithmetic as
 * a judgement, so the card says what was declared and in whose vocabulary.
 * ADR 0074 (owner 2026-10-16) adds exactly two scores, each its own line
 * with its coverage: Investability (InvestIQ, on shared evidence) and
 * Suitability (the fit). Never blended, never the ranking's order value. Pass is a quiet
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
      // QO-11 (QA 2026-10-23): a business model or customer type the
      // mandate names is not a sector, and the card never says it is.
      case "BUSINESS_MODEL_ALIGNED":
        reasons.push({
          kind: "BUSINESS_MODEL_MATCH",
          detail: "A business model you named",
        });
        break;
      case "CUSTOMER_TYPE_ALIGNED":
        reasons.push({
          kind: "CUSTOMER_TYPE_MATCH",
          detail: "A customer type you named",
        });
        break;
      default:
        break;
    }
  }
  return reasons;
}

/** A declared fact the mandate was compared on and that does not match. */
export type FeedMismatch = {
  readonly label: "Stage" | "Location" | "Sector" | "Cheque";
  readonly detail: string;
};

/**
 * Where the company does not fit the mandate, from the slate's own codes
 * (final check 2026-10-30). A card read "Seed, in your range" for a German
 * company in front of a Benelux-and-Nordics mandate: what it says is here
 * for must never leave out where it is not a fit. Neutral words, never a
 * verdict on the company: it is the mandate that differs.
 */
export function slateMismatches(
  company: Pick<
    DiscoveredCompanyDto,
    "reasonCodes" | "currentStageCode" | "headquartersCountry"
  >,
): FeedMismatch[] {
  const stage = stageLabel(company.currentStageCode);
  const country = countryLabel(company.headquartersCountry);
  const out: FeedMismatch[] = [];
  for (const code of company.reasonCodes) {
    switch (code) {
      case "STAGE_MISMATCH":
        out.push({
          label: "Stage",
          detail:
            stage === null
              ? "Outside your stage range"
              : `${stage}, outside your stage range`,
        });
        break;
      case "GEOGRAPHY_MISMATCH":
        out.push({
          label: "Location",
          detail:
            country === null
              ? "Outside your regions"
              : `${country}, outside your regions`,
        });
        break;
      case "TAXONOMY_MISMATCH":
        out.push({ label: "Sector", detail: "Not a category you named" });
        break;
      case "CHEQUE_ABOVE_ROUND":
        out.push({
          label: "Cheque",
          detail:
            "Your smallest cheque is larger than the round they are raising",
        });
        break;
      default:
        break;
    }
  }
  return out;
}

function Reasons({
  reasons,
  mismatches,
}: {
  readonly reasons: readonly DiscoveryReasonDto[];
  readonly mismatches: readonly FeedMismatch[];
}) {
  const t = useT();
  if (reasons.length === 0 && mismatches.length === 0) {
    return (
      <p className="cq-status-line">
        {t("Nothing in common with your mandate yet.")}
      </p>
    );
  }
  const list = (
    <dl className="flex flex-col gap-1">
      {reasons.map((reason) => (
        <div
          key={`${reason.kind}-${reason.detail}`}
          className="cq-feed-reason flex gap-2"
        >
          <dt className="cq-label flex items-center gap-1.5 text-(--cq-text-tertiary)">
            {/* Declared alignment that holds: a mark beside the word, never
                colour alone (Discover A). */}
            <Check
              aria-hidden="true"
              className="cq-feed-reason-mark"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            {t(REASON_LABELS[reason.kind])}
          </dt>
          <dd className="cq-body-sm text-(--cq-text-secondary)">
            {t(reason.detail)}
          </dd>
        </div>
      ))}
      {mismatches.map((mismatch) => (
        <div
          key={`${mismatch.label}-${mismatch.detail}`}
          className="cq-feed-reason flex gap-2"
          data-feed-mismatch
        >
          <dt className="cq-label flex items-center gap-1.5 text-(--cq-text-tertiary)">
            {/* Not a fit on this: a dash beside the word, neutral, never
                colour alone and never a warning. */}
            <Minus
              aria-hidden="true"
              className="cq-feed-reason-mark"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            {t(mismatch.label)}
          </dt>
          <dd className="cq-body-sm text-(--cq-text-secondary)">
            {t(mismatch.detail)}
          </dd>
        </div>
      ))}
    </dl>
  );
  if (reasons.length > 0) return list;
  return (
    <div className="flex flex-col gap-1">
      <p className="cq-status-line">
        {t("Nothing in common with your mandate yet.")}
      </p>
      {list}
    </div>
  );
}

const subscribeNothing = () => () => undefined;

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
  position = null,
  askPanel,
  onInterestConfirmed,
  initialScores,
  expressInterest,
  interestRequest = 0,
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
  /** Where this card is in the slate ("3 of 24"), when the feed knows. */
  readonly position?: string | null | undefined;
  /**
   * Q beside the dossier (Discover A): on a desktop Ask Q opens this over
   * the panel, the company pinned and the pitch still playing. Absent, Ask
   * Q opens Q's own panel (onAskQ), as on a phone.
   */
  readonly askPanel?: ReactNode;
  /** The server confirmed this reader's interest (the feed's toast). */
  readonly onInterestConfirmed?: (() => void) | undefined;
  /** Scores already read (a review harness); otherwise read for the page. */
  readonly initialScores?: ReadonlyMap<string, CompanyScoresDto> | undefined;
  /** The interest port (a review harness); the server action otherwise. */
  readonly expressInterest?: ExpressInterestPort | undefined;
  /**
   * Bumped by the feed when the person swipes right on a phone: the
   * details open at Express interest's confirmation step.
   */
  readonly interestRequest?: number | undefined;
}) {
  const t = useT();
  // Stage first, then where: "Seed · Nigeria".
  const place = [
    stageLabel(company.currentStageCode),
    countryLabel(company.headquartersCountry),
  ]
    .filter((part): part is string => part !== null)
    .map((part) => t(part))
    .join(" · ");
  const decisions = useRef<HTMLDivElement>(null);
  useDockAvoid(decisions);
  // The dossier's line under the name also names the sector (Discover A).
  const sectorWords = (company.summary?.sectorNodeIds ?? [])
    .map((id) => sectorLabels.get(id))
    .filter((label): label is string => label !== undefined)
    .slice(0, 2)
    .map((label) => t(label));
  const raise = raiseShort(company, t);
  const unverified = company.unverifiedExclusions ?? [];
  const filterUnknown = company.filterUnknown ?? [];
  const sheetDrag = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const wide = useDesktopPanel();
  // Investability and Suitability (owner 2026-10-16; ADR 0074): read for
  // the page in one batched call, off the swipe path; absent until known.
  const scores = useCompanyScores(
    [company.companyId],
    initialScores === undefined ? {} : { initial: initialScores },
  );
  const read = scores.get(company.companyId);
  // Discover A: Ask Q over the dossier on a desktop, in a sheet on a phone,
  // the company pinned either way; Q's own panel when no panel is given.
  const [asking, setAsking] = useState(false);
  const askHere = askPanel !== undefined;
  const askQ = askHere ? () => setAsking(true) : onAskQ;
  // The server-rendered control cannot open Q until its handler is attached.
  // Keep it disabled through hydration so an early press is never discarded.
  const interactive = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const [confirming, setConfirming] = useState(false);
  const openDetails = (confirm: boolean) => {
    setConfirming(confirm);
    setExpanded(true);
  };
  // A swipe right on a phone asks to express interest: the details open
  // at the confirmation step (it is server-confirmed and tells the
  // founders, so a gesture never sends it by itself).
  const [interestSeen, setInterestSeen] = useState(interestRequest);
  if (interestRequest !== interestSeen) {
    setInterestSeen(interestRequest);
    if (interestRequest > 0) {
      setConfirming(true);
      setExpanded(true);
    }
  }
  const [shared, setShared] = useState<ShareOutcome | null>(null);
  const share = () => {
    void shareCompany(company).then(setShared);
  };
  const reasons =
    company.reasons.length > 0 ? company.reasons : slateReasons(company);
  const mismatches = slateMismatches(company);
  const firstReason = reasons[0];
  const firstMismatch = mismatches[0];
  // Lines the chip does not say itself: a mismatch is never folded into "+N".
  const moreLines =
    reasons.length +
    mismatches.length -
    (firstReason === undefined ? 0 : 1) -
    (firstMismatch === undefined ? 0 : 1);
  const unverifiedLine =
    unverified.length === 0 ? null : (
      <p className="cq-feed-unverified" data-feed-unverified>
        <CircleHelp
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        {t(
          unverified.length === 1
            ? `Your ${ruleList(unverified)} exclusion can't be checked yet, so nobody is hidden because of it.`
            : `Your ${ruleList(unverified)} exclusions can't be checked yet, so nobody is hidden because of them.`,
        )}
      </p>
    );
  const why = (
    <div className="cq-feed-why flex flex-col gap-1" data-feed-why>
      <h3 className="cq-label text-(--cq-text-primary)">
        {t("Why it's here")}
      </h3>
      <Reasons reasons={reasons} mismatches={mismatches} />
      {unverifiedLine}
    </div>
  );
  const askOpenHere = asking && askHere && wide;

  return (
    <article
      className="cq-feed-card flex w-full flex-col gap-5"
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

      {askOpenHere ? (
        <DossierAsk
          company={company}
          place={place}
          onBack={() => setAsking(false)}
        >
          {askPanel}
        </DossierAsk>
      ) : null}

      {/*
        The words over the pitch on a phone (Discover A): the name, stage,
        place and raise in one line, the one-liner, and the first reason it
        is here -- a press opens the rest. On a desktop, the dossier's head.
      */}
      <div
        className="cq-feed-info flex flex-col gap-1"
        data-feed-summary
        hidden={askOpenHere}
      >
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
        {company.pitch === null ||
        !showMedia ||
        aiPresenterLine(company.pitch.title) === null ? null : (
          <p className="cq-caption cq-feed-muted" data-ai-presenter>
            {t(aiPresenterLine(company.pitch.title) ?? "")}
          </p>
        )}
        <div className="cq-feed-company">
          {/* On a desktop the panel names the company with its mark; the
              rail's avatar is the way into the profile on a phone. */}
          <span className="cq-feed-panel-mark">
            <CompanyAvatar
              companyId={company.companyId}
              photoUrl={company.photoUrl}
              size={44}
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
                {wide
                  ? sectorWords.length > 0
                    ? `${place} · ${sectorWords.join(", ")}`
                    : place
                  : raise.line === ""
                    ? place
                    : `${place} · ${raise.line}`}
              </span>
            )}
          </span>
        </div>

        {company.shortDescription === null ? null : (
          <p
            className={`cq-feed-one-liner text-(--cq-text-primary) ${wide ? "" : "line-clamp-2"}`}
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
          // The first reason it is here, and how many more: a press opens
          // the details (why, Q's read, the decision) in a sheet.
          <button
            type="button"
            className="cq-feed-reason-chip"
            aria-haspopup="dialog"
            aria-expanded={expanded}
            aria-label={`More about ${company.canonicalName}`}
            onClick={() => openDetails(false)}
            data-feed-details-toggle
          >
            {firstReason === undefined && firstMismatch === undefined ? (
              t("Why it's here")
            ) : (
              <>
                {firstReason === undefined ? null : (
                  <>
                    <Check
                      aria-hidden="true"
                      size={ICON_SIZE.compact}
                      strokeWidth={ICON_STROKE}
                    />
                    {t(firstReason.detail)}
                  </>
                )}
                {/* The first place it does not fit, beside the first place
                    it does: the chip never reads as a clean match. */}
                {firstMismatch === undefined ? null : (
                  <span data-feed-chip-mismatch>
                    <Minus
                      aria-hidden="true"
                      size={ICON_SIZE.compact}
                      strokeWidth={ICON_STROKE}
                    />
                    {t(firstMismatch.detail)}
                  </span>
                )}
                {moreLines > 0 ? (
                  <span className="cq-feed-reason-more">
                    +{String(moreLines)}
                  </span>
                ) : null}
              </>
            )}
          </button>
        )}
      </div>

      {/* The desktop dossier (Discover A, owner 2026-10-19). */}
      {wide && !askOpenHere ? (
        <div
          className="cq-feed-more-body cq-feed-dossier"
          id={`cq-feed-more-${company.companyId}`}
          data-feed-more
        >
          <DossierActions
            company={company}
            saved={saved}
            deciding={deciding}
            onSave={onSave}
            onPass={onPass}
            onAskQ={askQ}
            askQMark={askQMark}
            interactive={interactive}
            onInterestConfirmed={onInterestConfirmed}
            expressInterest={expressInterest}
            videos={videos}
          />
          <FactStrip company={company} raise={raise} />
          {why}
          {read === undefined ? null : (
            <QRead scores={read} companyName={company.canonicalName} />
          )}
          {feedNotes}
          <div className="cq-feed-dossier-foot">
            <Link
              href={`/company/${company.companyId}`}
              className="cq-feed-open-full"
              data-feed-open-profile
            >
              {t("Open full profile")}
              <ChevronRight
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </Link>
            {position === null ? null : (
              <span
                className="cq-caption text-(--cq-text-secondary)"
                data-feed-position
              >
                {position}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* A phone's Ask Q: the same panel, in a sheet over the pitch. */}
      {askHere && !wide ? (
        <SheetRoot open={asking} onOpenChange={setAsking}>
          <SheetContent title={t("Ask Q")} side="bottom" bare>
            <div
              className="flex min-h-[60dvh] flex-col"
              onTouchStart={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
              onTouchEnd={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                // Escape is the sheet's own (it closes); every other key
                // stays out of the feed behind it.
                if (event.key !== "Escape") event.stopPropagation();
              }}
              onWheel={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <DossierAsk
                company={company}
                place={place}
                onBack={() => setAsking(false)}
                done
              >
                {askPanel}
              </DossierAsk>
            </div>
          </SheetContent>
        </SheetRoot>
      ) : null}

      <SheetRoot
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open);
          if (!open) setConfirming(false);
        }}
      >
        <SheetContent
          title={company.canonicalName}
          side={wide ? "side" : "bottom"}
          bare={!wide}
        >
          {/*
            In a portal, but still inside the feed in React's tree: its
            gestures and keys stop here so a scroll in the sheet never
            moves the feed, and a swipe down on it closes it.
          */}
          <div
            className="cq-feed-sheet flex flex-col gap-5"
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
            onKeyDown={(event) => {
              // Escape is the sheet's own (it closes); every other key
              // stays out of the feed behind it.
              if (event.key !== "Escape") event.stopPropagation();
            }}
            onWheel={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cq-feed-sheet-head">
              <CompanyAvatar
                companyId={company.companyId}
                photoUrl={company.photoUrl}
                size={40}
              />
              <span className="flex min-w-0 flex-col">
                <span className="cq-body font-medium text-(--cq-text-primary)">
                  {company.canonicalName}
                </span>
                {place === "" ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {place}
                  </span>
                )}
              </span>
            </div>
            {/* On a phone the one-liner is already over the pitch; the sheet
                adds the facts, why and Q's read (Discover A). */}
            {wide && company.shortDescription !== null ? (
              <p className="cq-body-sm text-(--cq-text-primary)">
                {company.shortDescription}
              </p>
            ) : null}
            {company.pitch === null ? (
              <p className="cq-caption text-(--cq-text-secondary)">
                {t("No pitch to show yet.")}
              </p>
            ) : null}
            {/* The raise with where it came from, as the profile says it
                (R2): the line over the pitch is only its short form. */}
            <FactStrip company={company} raise={raise} />
            {why}
            {read === undefined ? null : (
              <QRead scores={read} companyName={company.canonicalName} />
            )}
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
              A swipe right opens it at its confirmation step.
            */}
            <div className="cq-feed-interest">
              <ExpressInterest
                key={confirming ? "confirming" : "idle"}
                companyId={company.companyId}
                companyName={company.canonicalName}
                surface="RECOMMENDATION_FEED"
                startConfirming={confirming}
                onConfirmed={onInterestConfirmed}
                prominent
                {...(expressInterest === undefined
                  ? {}
                  : { express: expressInterest })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/company/${company.companyId}`}
                className="cq-feed-open-full"
                data-feed-sheet-profile
              >
                {t("Open full profile")}
                <ChevronRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              </Link>
              <Button variant="quiet" onClick={share} data-feed-sheet-share>
                <Share2
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                {t(shared === "COPIED" ? "Link copied" : "Share")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </SheetRoot>

      {/*
        The action rail on a phone (spec §9.1; ADR 0017 C4; Discover A):
        the company's mark first -- the way into its profile -- then Save,
        Pass, Ask Q and More, labelled, no counters. Interest is the swipe
        right (and the details' own control); Share is in the details. The
        Q Dock never sits on it (spec §6.2). A desktop's decisions are in
        the dossier.
      */}
      <div
        ref={decisions}
        className="cq-feed-rail"
        role="group"
        aria-label={t("Decide")}
      >
        <span className="cq-feed-rail-profile">
          <CompanyAvatarLink
            companyId={company.companyId}
            companyName={company.canonicalName}
            photoUrl={company.photoUrl}
          />
          <span className="cq-feed-rail-label" aria-hidden="true">
            {t("Profile")}
          </span>
        </span>
        {/* Saved is marked by the filled icon and the word, never colour
            alone (demo audit 2026-10-03). */}
        <Button
          variant="quiet"
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
          <span className="cq-feed-rail-label">
            {t(saved ? "Saved" : "Save")}
          </span>
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
          <span className="cq-feed-rail-label">{t("Pass")}</span>
        </Button>
        <Button
          variant="quiet"
          disabled={!interactive}
          onClick={askQ}
          className="cq-feed-rail-button"
          data-feed-ask-q
        >
          {askQMark}
          <span className="cq-feed-rail-label">{t("Ask Q")}</span>
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
            <span className="cq-feed-rail-label">{t("Next video")}</span>
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
            <span className="cq-feed-rail-label">{t("More")}</span>
          </Button>
        )}
        <span className="sr-only" role="status">
          {shared === "COPIED" ? "Link to the company copied." : ""}
        </span>
      </div>
    </article>
  );
}

/**
 * The raise, short, as the server read it for this reader: "$1M" with
 * where it was said, or "Raise not shared" -- never a guessed figure.
 */
function raiseShort(
  company: DiscoveredCompanyDto,
  t: (words: string) => string,
): {
  /** False when the API sent no summary: nothing is said about a raise. */
  readonly sent: boolean;
  readonly figure: string | null;
  readonly note: string | null;
  readonly line: string;
} {
  const summary = company.summary;
  if (summary === undefined) {
    return { sent: false, figure: null, note: null, line: "" };
  }
  if (summary?.raiseView !== undefined) {
    const words = translatedRaise(raiseWords(summary.raiseView, false), t);
    return words.amount === null
      ? { sent: true, figure: null, note: null, line: words.label }
      : {
          sent: true,
          figure: words.amount,
          note: words.label,
          line: `${t("Raising")} ${words.amount}`,
        };
  }
  if (summary.raise === null) {
    return {
      sent: true,
      figure: null,
      note: null,
      line: t("Raise not shared"),
    };
  }
  const figure = compactMoneyText(summary.raise.money);
  return {
    sent: true,
    figure,
    note: t(
      evidenceWords(summary.raise.truthClass, summary.raise.evidenceStatus),
    ),
    line: `${t("Raising")} ${figure}`,
  };
}

/**
 * The dossier's three facts in a row (Discover A): stage, the raise as the
 * server read it for this reader, and where. Unknown is said, never blank
 * and never zero.
 */
function FactStrip({
  company,
  raise,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly raise: ReturnType<typeof raiseShort>;
}) {
  const t = useT();
  const stage = stageLabel(company.currentStageCode);
  const country = countryLabel(company.headquartersCountry);
  return (
    <dl className="cq-feed-strip" data-feed-facts>
      <div>
        <dt>{t("Stage")}</dt>
        <dd>{stage === null ? t("Not stated") : t(stage)}</dd>
      </div>
      {raise.sent ? (
        <div>
          <dt>{t("Raising")}</dt>
          <dd className="cq-numeric">
            {company.summary?.raiseView !== undefined ? (
              // R2: the profile's own raise element, so Discover and the
              // profile say the same raise in the same words.
              <RaiseFact
                words={translatedRaise(
                  raiseWords(company.summary.raiseView, false),
                  t,
                )}
              />
            ) : raise.figure === null ? (
              <span className="cq-feed-fact-unknown">
                {t("Not shared with you")}
              </span>
            ) : (
              <>
                {raise.figure}
                {raise.note === null ? null : (
                  <span className="cq-feed-strip-axis">{raise.note}</span>
                )}
              </>
            )}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{t("Location")}</dt>
        <dd>{country === null ? t("Not stated") : t(country)}</dd>
      </div>
    </dl>
  );
}

/**
 * Ask Q over the dossier (Discover A): the company pinned at the top so it
 * is plain what Q is looking at, then Q's own conversation -- the one the
 * dock opens, so nothing is a second Q. The pitch keeps playing beside it.
 */
function DossierAsk({
  company,
  place,
  onBack,
  children,
  done = false,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly place: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
  /** In a phone's sheet: "Done" on the right instead of Back. */
  readonly done?: boolean | undefined;
}) {
  const t = useT();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      className="cq-feed-ask"
      aria-label={t("Ask Q")}
      data-feed-ask-panel
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <div className="cq-feed-ask-head">
        {done ? null : (
          <button
            ref={backRef}
            type="button"
            className="cq-stage-quiet"
            aria-label={t("Back to the company")}
            onClick={onBack}
            data-feed-ask-back
          >
            <ArrowLeft
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
        )}
        <h3 className="cq-label flex-1 text-(--cq-text-primary)">
          {t("Ask Q")}
        </h3>
        {done ? (
          <button
            ref={backRef}
            type="button"
            className="cq-stage-quiet"
            onClick={onBack}
            data-feed-ask-done
          >
            {t("Done")}
          </button>
        ) : null}
      </div>
      <div className="cq-feed-ask-pin" data-feed-ask-pin>
        <CompanyAvatar
          companyId={company.companyId}
          photoUrl={company.photoUrl}
          size={32}
        />
        <span className="flex min-w-0 flex-col">
          <span className="cq-body-sm font-medium text-(--cq-text-primary)">
            {t("About")} {company.canonicalName}
          </span>
          <span className="cq-caption text-(--cq-text-secondary)">
            {place === "" ? "" : `${place} · `}
            {t("what you can see")}
          </span>
        </span>
      </div>
      <div className="cq-feed-ask-body">{children}</div>
    </section>
  );
}

/**
 * The desktop dossier's decisions (Discover A, owner 2026-10-19): beside
 * the pitch rather than on a rail over it. Express interest is the
 * server-confirmed step in place (it asks first, CQ-NET-010); Save and
 * Pass stay optimistic and Pass stays neutral.
 */
function DossierActions({
  company,
  saved,
  deciding,
  onSave,
  onPass,
  onAskQ,
  askQMark,
  interactive,
  videos,
  onInterestConfirmed,
  expressInterest,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly saved: boolean;
  readonly deciding: boolean;
  readonly onSave: () => void;
  readonly onPass: () => void;
  readonly onAskQ: () => void;
  readonly askQMark?: ReactNode;
  readonly interactive: boolean;
  readonly videos?:
    | {
        readonly index: number;
        readonly count: number;
        readonly onNext: () => void;
      }
    | undefined;
  readonly onInterestConfirmed?: (() => void) | undefined;
  readonly expressInterest?: ExpressInterestPort | undefined;
}) {
  const t = useT();
  return (
    <div
      className="cq-feed-actions"
      role="group"
      aria-label={t("Decide")}
      data-feed-dossier-actions
    >
      <ExpressInterest
        companyId={company.companyId}
        companyName={company.canonicalName}
        surface="RECOMMENDATION_FEED"
        prominent
        onConfirmed={onInterestConfirmed}
        {...(expressInterest === undefined ? {} : { express: expressInterest })}
      />
      <Button
        variant="secondary"
        aria-pressed={saved}
        disabled={deciding}
        onClick={onSave}
      >
        {saved ? (
          <BookmarkCheck
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        ) : (
          <Bookmark
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        )}
        {t(saved ? "Saved" : "Save")}
      </Button>
      <Button variant="secondary" disabled={deciding} onClick={onPass}>
        <ArrowDown
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        {t("Pass")}
      </Button>
      <Button
        variant="quiet"
        disabled={!interactive}
        onClick={onAskQ}
        className="cq-feed-actions-ask"
        data-feed-ask-q
      >
        {askQMark}
        {t("Ask Q")}
      </Button>
      {videos === undefined || videos.count < 2 ? null : (
        <Button
          variant="quiet"
          onClick={videos.onNext}
          aria-label={`Next video from ${company.canonicalName}, video ${String(
            ((videos.index + 1) % videos.count) + 1,
          )} of ${String(videos.count)}`}
          data-feed-next-video
        >
          <ChevronRight
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          {t("Next video")}
        </Button>
      )}
    </div>
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

/**
 * Live 2026-10-31 (Discover at 390): an AI-presented pitch carries its
 * label burned into the video's own lower third, which sits where the
 * caption does, so the label ran through the company's name. The label
 * is said by the app, in the caption's flow above the name, from the
 * provenance recorded with the video (its title names the AI presenter);
 * the caption's scrim then holds the frame's own text beneath it.
 */
export function aiPresenterLine(
  pitchTitle: string | null | undefined,
): string | null {
  return pitchTitle != null && /\bAI[- ]present(?:er|ed)\b/iu.test(pitchTitle)
    ? "AI presenter · AI-generated"
    : null;
}

/** The line on a passed company offered again (doc 19 §67). */
export function sinceYouLastSawLine(change: "NEW_PITCH" | null): string {
  return change === "NEW_PITCH"
    ? "New pitch since you last saw it. You passed on it before."
    : "Updated since you last saw it. You passed on it before.";
}
