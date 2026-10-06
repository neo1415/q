"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { DECK_SECTION_LABELS, type DeckSection, type DeckSectionCode } from "@capital-q/contracts";
import { ChevronLeft, ChevronRight, CircleAlert, FileText, ICON_SIZE, Search, UserRound } from "@capital-q/ui/icons";

/**
 * Q's read of the deck, as twelve sub-tabs in the same order for every
 * company (overnight plan A5): a swipeable carousel on a phone (CSS scroll
 * snap: native momentum, no gesture library) and arrows plus the left and
 * right keys on a large screen, like flipping slides. It shows whether or
 * not the deck downloads.
 *
 * What an investor reads is coverage, never a grade: "in the deck", "not
 * in the deck yet" or "unclear". The 0-5 rubric is the founder's alone
 * (research pitch-deck.md §7.10), so it is not on this component at all.
 */

const STATUS_WORDS: Readonly<Record<DeckSection["status"], string>> = {
  PRESENT: "In the deck",
  NOT_IN_DECK: "Not in the deck yet",
  UNCLEAR: "Unclear",
  CONTRADICTORY: "Numbers disagree",
};

function slides(pages: readonly number[]): string | null {
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const first = unique[0] ?? 0;
  const last = unique.at(-1) ?? first;
  return first === last ? `Slide ${String(first)}` : `Slides ${String(first)}–${String(last)}`;
}

export function StatusMark({ status }: { readonly status: DeckSection["status"] }) {
  // Shape and word together: never colour alone.
  return status === "PRESENT" ? (
    <span aria-hidden="true" className="inline-block size-3.5 shrink-0 rounded-full bg-(--cq-positive)" />
  ) : status === "NOT_IN_DECK" ? (
    <span aria-hidden="true" className="inline-block size-3.5 shrink-0 rounded-full border border-dashed border-(--cq-text-tertiary)" />
  ) : (
    <CircleAlert size={ICON_SIZE.compact} aria-hidden="true" className="shrink-0 text-(--cq-warning)" />
  );
}

/** The summary grid: twelve sections, coverage only. */
export function DeckReadSummary({
  sections,
  readAt,
  versionNumber,
  onPick,
  current,
}: {
  readonly sections: readonly DeckSection[];
  readonly readAt: string;
  readonly versionNumber: number;
  readonly onPick: (index: number) => void;
  readonly current: number;
}) {
  const present = sections.filter((section) => section.status === "PRESENT").length;
  const missing = sections.filter((section) => section.status === "NOT_IN_DECK").map((s) => DECK_SECTION_LABELS[s.section].toLowerCase());
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-(--cq-surface-subtle) p-4" aria-labelledby="deck-read-title" data-deck-read>
      <h3 id="deck-read-title" className="cq-title-sm text-(--cq-text-primary)">
        Q&rsquo;s read of the deck
      </h3>
      <p className="cq-body-sm text-(--cq-text-primary)">
        {present} of 12 sections are in the deck.
        {missing.length === 0 ? "" : ` Not in the deck yet: ${missing.join(", ")}.`}
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sections.map((section, index) => (
          <li key={section.section}>
            <button
              type="button"
              onClick={() => onPick(index)}
              aria-current={current === index ? "true" : undefined}
              className={`cq-body-sm flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-(--cq-text-primary) ${
                current === index
                  ? "border-(--cq-text-primary) border-2"
                  : section.status === "NOT_IN_DECK"
                    ? "border-dashed border-(--cq-border)"
                    : "border-(--cq-border-subtle) bg-(--cq-surface-raised)"
              }`}
            >
              <StatusMark status={section.status} />
              <span className="min-w-0">{DECK_SECTION_LABELS[section.section]}</span>
              <span className="sr-only">: {STATUS_WORDS[section.status]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="cq-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-(--cq-text-secondary)">
        <span className="inline-flex items-center gap-1">
          <StatusMark status="PRESENT" /> In the deck
        </span>
        <span className="inline-flex items-center gap-1">
          <StatusMark status="NOT_IN_DECK" /> Not in the deck yet
        </span>
        <span className="inline-flex items-center gap-1">
          <StatusMark status="UNCLEAR" /> Unclear
        </span>
      </p>
      <p className="cq-caption text-(--cq-text-secondary)">
        Read by Q on{" "}
        {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(readAt))}, from
        version {versionNumber}. Figures are the company&rsquo;s own claims.
      </p>
    </section>
  );
}

function SectionCard({
  section,
  downloadable,
  companyName,
}: {
  readonly section: DeckSection;
  readonly downloadable: boolean;
  readonly companyName: string;
}) {
  const label = DECK_SECTION_LABELS[section.section];
  const where = slides(section.pages);
  return (
    <article
      className="flex h-full flex-col gap-4 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
      aria-label={label}
      data-deck-section={section.section}
    >
      <header className="flex items-start justify-between gap-3">
        <h4 className="cq-title-md text-(--cq-text-primary)">{label}</h4>
        <span className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-secondary)">
          <StatusMark status={section.status} /> {STATUS_WORDS[section.status]}
        </span>
      </header>
      {section.summary === null ? (
        <p className="cq-body text-(--cq-text-secondary)">
          {section.status === "NOT_IN_DECK"
            ? `${companyName}'s deck doesn't cover this yet. Unknown, not zero: ask them.`
            : "Q couldn't read this part clearly."}
        </p>
      ) : (
        <p className="cq-body text-(--cq-text-primary)">{section.summary}</p>
      )}
      {section.facts.length === 0 ? null : (
        <dl className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
          {section.facts.map((fact) => (
            <div key={`${fact.label}-${fact.pages.join(",")}`} className="flex items-start justify-between gap-4 py-3">
              <dt className="flex min-w-0 flex-col gap-1">
                <span className="cq-body-sm text-(--cq-text-primary)">{fact.label}</span>
                <span className="cq-caption inline-flex flex-wrap items-center gap-1 text-(--cq-text-secondary)">
                  <UserRound size={ICON_SIZE.compact} aria-hidden="true" />
                  {fact.truthClass === "Q_INFERENCE" ? "Q's inference" : "Founder's claim"}
                  {slides(fact.pages) === null ? "" : ` · ${slides(fact.pages) ?? ""}`}
                  {fact.asOf === null ? "" : ` · as of ${fact.asOf}`}
                </span>
              </dt>
              <dd className="cq-title-sm cq-numeric text-right text-(--cq-text-primary)">
                {fact.value ?? <span className="cq-body-sm text-(--cq-text-secondary)">Not in the deck</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <footer className="mt-auto flex flex-col gap-2">
        {where === null ? null : (
          <p className="cq-caption inline-flex items-center gap-1 text-(--cq-text-secondary)">
            <FileText size={ICON_SIZE.compact} aria-hidden="true" />
            {where} · {downloadable ? "deck can be downloaded" : "deck is view only"}
          </p>
        )}
        <Link
          href={`/q?ask=${encodeURIComponent(`About ${companyName}'s ${label.toLowerCase()}: `)}`}
          className="cq-body-sm inline-flex min-h-11 items-center gap-2 text-(--cq-text-primary) hover:underline"
        >
          <Search size={ICON_SIZE.compact} aria-hidden="true" /> Ask Q about {label.toLowerCase()}
        </Link>
      </footer>
    </article>
  );
}

/**
 * The twelve as a carousel. The chips and the summary grid move it; the
 * track's own scroll position moves the chips (an observer, not a scroll
 * handler), so a swipe and a tap stay in step.
 */
export function DeckCarousel({
  sections,
  downloadable,
  companyName,
  index,
  onIndex,
}: {
  readonly sections: readonly DeckSection[];
  readonly downloadable: boolean;
  readonly companyName: string;
  readonly index: number;
  readonly onIndex: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(index);

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(sections.length - 1, next));
    const card = track.current?.children[clamped];
    if (card instanceof HTMLElement) {
      track.current?.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
    }
    onIndex(clamped);
  }, [sections.length, onIndex]);

  // Only an outside pick (the summary grid) moves the track here.
  const shown = useRef(visible);
  useEffect(() => {
    shown.current = visible;
  }, [visible]);
  useEffect(() => {
    if (index !== shown.current) go(index);
  }, [index, go]);

  useEffect(() => {
    const root = track.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const at = Array.prototype.indexOf.call(root.children, entry.target);
            if (at >= 0) {
              setVisible(at);
              onIndex(at);
              const chip = chips.current?.children[at];
              if (chip instanceof HTMLElement) chip.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [onIndex]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(visible + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(visible - 1);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-roledescription="carousel" aria-label="The deck, section by section" data-deck-carousel>
      <div ref={chips} className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sections">
        {sections.map((section, at) => (
          <button
            key={section.section}
            type="button"
            role="tab"
            aria-selected={visible === at}
            onClick={() => go(at)}
            className={`cq-body-sm min-h-11 shrink-0 rounded-full border px-4 ${
              visible === at
                ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-text-inverse)"
                : "border-(--cq-border) text-(--cq-text-primary)"
            }`}
          >
            {DECK_SECTION_LABELS[section.section as DeckSectionCode]}
          </button>
        ))}
      </div>
      <div className="relative">
        <div
          ref={track}
          tabIndex={0}
          onKeyDown={onKey}
          aria-live="polite"
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) motion-reduce:scroll-auto"
        >
          {sections.map((section, at) => (
            <div
              key={section.section}
              className="w-[86%] shrink-0 snap-start sm:w-full"
              role="group"
              aria-roledescription="slide"
              aria-label={`${String(at + 1)} of ${String(sections.length)}`}
            >
              <SectionCard section={section} downloadable={downloadable} companyName={companyName} />
            </div>
          ))}
        </div>
        <div className="mt-2 hidden items-center justify-between sm:flex">
          <button
            type="button"
            onClick={() => go(visible - 1)}
            disabled={visible === 0}
            aria-label="Previous section"
            className="flex size-11 items-center justify-center rounded-full border border-(--cq-border) text-(--cq-text-primary) disabled:opacity-40"
          >
            <ChevronLeft size={ICON_SIZE.regular} aria-hidden="true" />
          </button>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {visible + 1} / {sections.length}
          </p>
          <button
            type="button"
            onClick={() => go(visible + 1)}
            disabled={visible === sections.length - 1}
            aria-label="Next section"
            className="flex size-11 items-center justify-center rounded-full border border-(--cq-border) text-(--cq-text-primary) disabled:opacity-40"
          >
            <ChevronRight size={ICON_SIZE.regular} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex justify-center gap-1.5 sm:hidden" aria-hidden="true">
        {sections.map((section, at) => (
          <span
            key={section.section}
            className={`h-1.5 rounded-full ${visible === at ? "w-5 bg-(--cq-text-primary)" : "w-1.5 bg-(--cq-border)"}`}
          />
        ))}
      </div>
    </section>
  );
}
