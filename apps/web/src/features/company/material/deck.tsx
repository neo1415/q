"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import {
  DECK_SECTION_LABELS,
  type CompanyDeck,
  type CompanyDeckView,
  type DeckCoaching,
  type DeckCoachingSection,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  ICON_SIZE,
  Lock,
  Move,
  Upload,
} from "@capital-q/ui/icons";

import { DeckReadingReview } from "./deck-review";
import { DeckCarousel, DeckReadSummary } from "./deck-sections";
import { Watermark } from "./file-viewer";
import {
  confirmReadingAction,
  openDeckAction,
  type OpenedFile,
} from "./material-actions";

/**
 * The Pitch deck tab (overnight plan A4-A6; design-a "deck-*" and "coach-*").
 *
 * An investor (and the founder previewing "what investors see"): the deck
 * itself, view only with their name over it unless the founder allowed
 * downloads, then Q's read in twelve sections. The founder: the coaching,
 * section by section, weakest first, and what investors can do with the
 * deck. Nothing is fetched until the reader opens the deck (the bytes go
 * browser <-> storage on a short-lived signed URL).
 */

const longDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(iso));

function DeckViewer({
  companyId,
  deck,
  owner,
}: {
  readonly companyId: string;
  readonly deck: CompanyDeck;
  readonly owner: boolean;
}) {
  const [file, setFile] = useState<OpenedFile | null>(null);
  const [slide, setSlide] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const frame = useRef<HTMLDivElement>(null);
  const total = deck.pageCount;
  const open = () =>
    start(async () => {
      const result = await openDeckAction(companyId);
      if (result.ok) setFile(result.value);
      else setMessage(result.message);
    });
  const move = (by: number) =>
    setSlide((now) => Math.max(1, Math.min(total ?? now + by, now + by)));
  return (
    <div className="flex flex-col gap-3" data-deck-viewer>
      <div
        ref={frame}
        className="relative aspect-video w-full overflow-hidden rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
      >
        {file === null ? (
          <button
            type="button"
            onClick={open}
            disabled={pending}
            className="flex h-full w-full flex-col items-start justify-center gap-2 p-6 text-left sm:p-10"
          >
            <span className="cq-caption text-(--cq-text-tertiary)">
              {deck.title}
            </span>
            <span className="cq-body font-medium text-(--cq-text-primary)">
              {pending ? "Opening…" : "Open the deck"}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {deck.downloadable || owner
                ? "Opens here."
                : "Opens here, view only, with your name on every slide."}
            </span>
          </button>
        ) : (
          <>
            <iframe
              key={slide}
              src={`${file.url}#page=${String(slide)}&toolbar=0&navpanes=0&view=Fit`}
              title={`${deck.title}, slide ${String(slide)}`}
              className="h-full w-full"
              referrerPolicy="no-referrer"
            />
            {file.watermark === null ? null : (
              <Watermark words={file.watermark} />
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={file === null || slide === 1}
          aria-label="Previous slide"
          className="flex size-11 items-center justify-center rounded-full border border-(--cq-border) text-(--cq-text-primary) disabled:opacity-40"
        >
          <ChevronLeft size={ICON_SIZE.regular} aria-hidden="true" />
        </button>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Slide {slide}
          {total === null ? "" : ` of ${String(total)}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Full screen"
            disabled={file === null}
            onClick={() =>
              void frame.current?.requestFullscreen?.().catch(() => undefined)
            }
            className="flex size-11 items-center justify-center rounded-full text-(--cq-text-primary) disabled:opacity-40"
          >
            <Move size={ICON_SIZE.regular} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={file === null || (total !== null && slide >= total)}
            aria-label="Next slide"
            className="flex size-11 items-center justify-center rounded-full border border-(--cq-border) text-(--cq-text-primary) disabled:opacity-40"
          >
            <ChevronRight size={ICON_SIZE.regular} aria-hidden="true" />
          </button>
        </div>
      </div>
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
      {file?.downloadable === true && !owner ? (
        <a
          href={file.url}
          download
          className={buttonClassName("secondary", "regular", "self-start")}
        >
          <Download size={ICON_SIZE.compact} aria-hidden="true" /> Download the
          deck
        </a>
      ) : null}
    </div>
  );
}

/** What investors see: the deck, then Q's read. */
export function DeckForReaders({
  companyId,
  companyName,
  view,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly view: CompanyDeckView;
}) {
  const [index, setIndex] = useState(0);
  const carousel = useRef<HTMLDivElement>(null);
  const { deck, extraction } = view;
  if (deck === null) {
    return (
      <div className="flex flex-col gap-2 py-6" data-deck="empty">
        <p className="cq-body text-(--cq-text-primary)">
          {companyName} hasn&rsquo;t shared a deck with you yet.
        </p>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          When they do, it appears here with Q&rsquo;s read of it.
        </p>
      </div>
    );
  }
  const owner = view.viewer === "OWNER";
  return (
    <section
      className="flex flex-col gap-5"
      aria-labelledby="deck-title"
      data-deck={owner ? "owner-preview" : "investor"}
    >
      <div className="flex flex-col gap-1">
        <h2 id="deck-title" className="cq-title-md text-(--cq-text-primary)">
          {companyName} deck, version {deck.versionNumber}
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {deck.pageCount === null ? "" : `${String(deck.pageCount)} slides · `}
          Updated {longDay(deck.uploadedAt)}
        </p>
        <p className="cq-caption mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-(--cq-border) px-3 py-1 text-(--cq-text-primary)">
          {deck.downloadable ? (
            <>
              <Download size={ICON_SIZE.compact} aria-hidden="true" /> Can be
              downloaded
            </>
          ) : (
            <>
              <Lock size={ICON_SIZE.compact} aria-hidden="true" /> View only
            </>
          )}
        </p>
        {deck.scanned ? null : (
          <p className="cq-caption text-(--cq-text-secondary)">
            Not virus-scanned yet.
          </p>
        )}
      </div>
      <DeckViewer companyId={companyId} deck={deck} owner={owner} />
      {extraction === null ? (
        <p className="cq-body-sm rounded-lg bg-(--cq-surface-subtle) p-4 text-(--cq-text-secondary)">
          {owner
            ? "Q hasn't read this version yet. Its twelve sections appear here when it has."
            : `Q's read of the deck appears once ${companyName} confirms it.`}
        </p>
      ) : (
        <>
          <DeckReadSummary
            sections={extraction.sections}
            readAt={extraction.readAt}
            versionNumber={extraction.versionNumber}
            current={index}
            onPick={(at) => {
              setIndex(at);
              carousel.current?.scrollIntoView({
                block: "start",
                behavior: "smooth",
              });
            }}
          />
          <div ref={carousel}>
            <DeckCarousel
              sections={extraction.sections}
              downloadable={deck.downloadable}
              companyName={companyName}
              index={index}
              onIndex={setIndex}
            />
          </div>
        </>
      )}
    </section>
  );
}

// --- the founder's coaching ------------------------------------------------------

const LEVEL_WORDS: Readonly<Record<DeckCoachingSection["level"], string>> = {
  MISSING: "Not in the deck yet",
  MENTIONED: "Mentioned",
  BASIC: "Basic",
  CLEAR: "Clear",
  STRONG: "Strong",
  EXCEPTIONAL: "Exceptional",
};

function Dots({ score }: { readonly score: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`size-1.5 rounded-full ${n <= score ? "bg-(--cq-text-primary)" : "bg-(--cq-border)"}`}
        />
      ))}
    </span>
  );
}

function RubricMark({ section }: { readonly section: DeckCoachingSection }) {
  return section.score === 0 ? (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border border-dashed border-(--cq-text-tertiary)"
    />
  ) : section.atStandard ? (
    <Check
      size={ICON_SIZE.regular}
      aria-hidden="true"
      className="shrink-0 text-(--cq-positive)"
    />
  ) : (
    <CircleAlert
      size={ICON_SIZE.regular}
      aria-hidden="true"
      className="shrink-0 text-(--cq-warning)"
    />
  );
}

function qAsk(words: string) {
  return `/q?ask=${encodeURIComponent(words)}`;
}

export function DeckCoach({
  companyId,
  view,
  coaching,
}: {
  readonly companyId: string;
  readonly view: CompanyDeckView;
  readonly coaching: DeckCoaching;
}) {
  const deck = view.deck;
  const [confirmed, setConfirmed] = useState(
    view.extraction?.confirmed ?? false,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (deck === null) return null;
  const ordered = [...coaching.sections].sort((a, b) => a.score - b.score);
  const below = coaching.sections.filter(
    (s) => s.requiredForMinimum && !s.atStandard,
  );
  const first = below[0];
  const title = coaching.atMinimumStandard
    ? "Your deck meets the minimum standard"
    : below.length === 1
      ? "One step from the minimum standard"
      : below.length === 0
        ? "Nearly at the minimum standard"
        : `${String(below.length)} steps from the minimum standard`;
  const confirm = () =>
    start(async () => {
      if (view.extraction === null) return;
      const result = await confirmReadingAction({
        companyId,
        documentId: deck.documentId,
        extractionId: view.extraction.extractionId,
      });
      if (result.ok) setConfirmed(true);
      else setMessage(result.message);
    });

  return (
    <div
      className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8"
      data-deck-coach
    >
      <section className="flex flex-col gap-6" aria-labelledby="coach-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="coach-title"
              className="cq-title-lg text-(--cq-text-primary)"
            >
              Your pitch deck
            </h2>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Version {deck.versionNumber}
              {deck.pageCount === null
                ? ""
                : ` · ${String(deck.pageCount)} slides`}{" "}
              · Uploaded {longDay(deck.uploadedAt)}
            </p>
          </div>
          <Link
            href="/documents"
            className={buttonClassName("secondary", "regular")}
          >
            <Upload size={ICON_SIZE.compact} aria-hidden="true" /> Upload a new
            version
          </Link>
        </div>

        {view.extraction !== null && !confirmed ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-(--cq-border) p-4 sm:flex-row sm:items-center"
            data-confirm-reading
          >
            <p className="cq-body-sm flex-1 text-(--cq-text-primary)">
              Q read version {view.extraction.versionNumber}. Investors see a
              section only once you confirm it. Confirming all keeps any you
              marked as wrong or corrected as you left them. Coaching notes stay
              yours.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={confirm}
              className={buttonClassName("primary", "regular")}
            >
              Confirm all and show
            </button>
          </div>
        ) : null}
        {message === null ? null : (
          <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
            {message}
          </p>
        )}

        {view.extraction === null ? null : (
          <DeckReadingReview
            companyId={companyId}
            documentId={deck.documentId}
            extraction={view.extraction}
          />
        )}

        <div
          className="flex flex-col gap-4 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
          data-standard
        >
          <div className="flex flex-col gap-1">
            <h3 className="cq-title-md text-(--cq-text-primary)">{title}</h3>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Sections at standard: {coaching.sectionsAtStandard} of 12.
              {first === undefined ? null : (
                <>
                  {" "}
                  To reach the minimum,{" "}
                  <strong className="text-(--cq-text-primary)">
                    {DECK_SECTION_LABELS[first.section]}
                  </strong>{" "}
                  needs to be Clear.
                </>
              )}
            </p>
          </div>
          <div className="flex gap-1" aria-hidden="true">
            {coaching.sections.map((section) => (
              <span
                key={section.section}
                className={`h-1.5 flex-1 rounded-full ${section.atStandard ? "bg-(--cq-positive)" : "bg-(--cq-border-subtle)"}`}
              />
            ))}
          </div>
          <ul className="flex flex-col gap-1.5">
            {coaching.checks.map((check) => (
              <li
                key={check.code}
                className="cq-body-sm flex items-start gap-2 text-(--cq-text-primary)"
              >
                {check.passed ? (
                  <Check
                    size={ICON_SIZE.compact}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-(--cq-positive)"
                  />
                ) : (
                  <CircleAlert
                    size={ICON_SIZE.compact}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-(--cq-warning)"
                  />
                )}
                {check.words}
              </li>
            ))}
          </ul>
          <p className="cq-caption text-(--cq-text-secondary)">
            Q shows investors the same twelve sections for every company, so
            missing ones read &ldquo;Not in the deck yet&rdquo; until you add
            them. They never see these notes, and deck quality is never used to
            rank you.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {first === undefined ? null : (
              <Link
                href={qAsk(
                  `Draft a better ${DECK_SECTION_LABELS[first.section]} slide for my deck. Show me before you change anything.`,
                )}
                className={buttonClassName("primary", "regular")}
              >
                Fix {DECK_SECTION_LABELS[first.section].toLowerCase()} with Q
              </Link>
            )}
            <Link
              href={`/company/${companyId}?tab=deck&as=investor`}
              className={buttonClassName("quiet", "regular")}
            >
              See what investors see
            </Link>
          </div>
        </div>

        <section className="flex flex-col gap-2" aria-labelledby="by-section">
          <div className="flex items-baseline justify-between">
            <h3
              id="by-section"
              className="cq-title-sm text-(--cq-text-primary)"
            >
              Section by section
            </h3>
            <span className="cq-caption text-(--cq-text-secondary)">
              Weakest first
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {ordered.map((section) => {
              const label = DECK_SECTION_LABELS[section.section];
              return (
                <li key={section.section}>
                  <details
                    className="group"
                    open={section.score < 3}
                    data-coach-section={section.section}
                  >
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                      <RubricMark section={section} />
                      <span className="cq-body min-w-0 flex-1 text-(--cq-text-primary)">
                        {label}
                        {section.requiredForMinimum && !section.atStandard ? (
                          <span className="cq-caption text-(--cq-text-secondary)">
                            {" "}
                            · needed for the minimum
                          </span>
                        ) : null}
                      </span>
                      <span className="cq-caption inline-flex items-center gap-2 text-(--cq-text-secondary)">
                        <Dots score={section.score} />{" "}
                        {LEVEL_WORDS[section.level]}
                      </span>
                      <ChevronDown
                        size={ICON_SIZE.compact}
                        aria-hidden="true"
                        className="text-(--cq-text-tertiary) transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <div className="flex flex-col gap-3 pb-4 pl-8">
                      {section.gaps.length === 0 && section.improve === null ? (
                        <p className="cq-body-sm text-(--cq-text-secondary)">
                          Nothing to add here.
                        </p>
                      ) : (
                        <p className="cq-body-sm text-(--cq-text-primary)">
                          {[...section.gaps, section.improve]
                            .filter((line): line is string => line !== null)
                            .join(" ")}
                        </p>
                      )}
                      {section.score >= 5 ? null : (
                        <div className="flex flex-wrap gap-3">
                          <Link
                            href={qAsk(
                              `Draft my ${label} slide. Show me the exact words before anything changes; a new deck version only once I approve.`,
                            )}
                            className={buttonClassName(
                              "secondary",
                              "compact",
                              "min-h-11",
                            )}
                          >
                            Let Q draft it
                          </Link>
                          <Link
                            href={qAsk(
                              `Ask me what you need to improve my ${label} slide.`,
                            )}
                            className={buttonClassName(
                              "quiet",
                              "compact",
                              "min-h-11",
                            )}
                          >
                            Answer a question
                          </Link>
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      </section>

      <aside
        className="flex flex-col gap-4 lg:sticky lg:top-6"
        aria-label="Who can see your deck"
      >
        <div className="flex aspect-video flex-col justify-center gap-1 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5">
          <p className="cq-caption text-(--cq-text-tertiary)">Your deck</p>
          <p className="cq-title-sm text-(--cq-text-primary)">{deck.title}</p>
        </div>
        <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
          <div className="flex justify-between gap-3 py-3">
            <dt className="cq-body-sm text-(--cq-text-secondary)">
              Investors can
            </dt>
            <dd className="cq-body-sm text-(--cq-text-primary)">
              {deck.downloadable ? "Download it" : "View only"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 py-3">
            <dt className="cq-body-sm text-(--cq-text-secondary)">
              Q&rsquo;s sections
            </dt>
            <dd className="cq-body-sm text-(--cq-text-primary)">
              {confirmed ? "Shown to investors" : "Waiting for you"}
            </dd>
          </div>
        </dl>
        <Link
          href="/documents"
          className="cq-body-sm inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Change who can download it
        </Link>
      </aside>
    </div>
  );
}
