"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { DECK_SECTION_LABELS, type DeckSection } from "@capital-q/contracts";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  ICON_SIZE,
  Search,
  UserRound,
} from "@capital-q/ui/icons";
import { useT } from "@/features/i18n/language";

import {
  deckFactSource,
  slidesLine as slides,
  type ReadSection,
} from "./read-section";

export type { ReadFact, ReadSection } from "./read-section";

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

export function StatusMark({
  status,
}: {
  readonly status: DeckSection["status"];
}) {
  // Shape and word together: never colour alone.
  return status === "PRESENT" ? (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 shrink-0 rounded-full bg-(--cq-positive)"
    />
  ) : status === "NOT_IN_DECK" ? (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 shrink-0 rounded-full border border-dashed border-(--cq-text-tertiary)"
    />
  ) : (
    <CircleAlert
      size={ICON_SIZE.compact}
      aria-hidden="true"
      className="shrink-0 text-(--cq-warning)"
    />
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
  const t = useT();
  const present = sections.filter(
    (section) => section.status === "PRESENT",
  ).length;
  const missing = sections
    .filter((section) => section.status === "NOT_IN_DECK")
    .map((s) => DECK_SECTION_LABELS[s.section].toLowerCase());
  // The coverage grid is reference, not the reading: it starts folded so
  // the section analysis and the deck sit near the top (founder,
  // 2026-10-11). Native <details>: opens by keyboard and AT with no script.
  return (
    <details
      className="group bg-(--cq-surface-subtle)"
      aria-labelledby="deck-read-title"
      data-deck-read
    >
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col">
          <h3
            id="deck-read-title"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            {t("Q’s read of the deck")}
          </h3>
          <span
            className="cq-body-sm text-(--cq-text-secondary)"
            data-deck-read-summary
          >
            {present} of 12 sections identified
            {missing.length === 0
              ? ""
              : ` · ${String(missing.length)} not in the deck yet`}
          </span>
        </span>
        <span className="cq-body-sm inline-flex items-center gap-1 text-(--cq-text-primary) underline underline-offset-4">
          <span className="group-open:hidden">{t("View coverage")}</span>
          <span className="hidden group-open:inline">{t("Hide coverage")}</span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {missing.length === 0 ? null : (
          <p className="cq-body-sm text-(--cq-text-primary)">
            Not in the deck yet: {missing.join(", ")}.
          </p>
        )}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sections.map((section, index) => (
            <li key={section.section}>
              <button
                type="button"
                onClick={() => onPick(index)}
                aria-current={current === index ? "true" : undefined}
                className={`cq-body-sm flex min-h-11 w-full items-center gap-2 border px-3 py-2 text-start text-(--cq-text-primary) ${
                  current === index
                    ? "border-(--cq-text-primary) border-2"
                    : section.status === "NOT_IN_DECK"
                      ? "border-dashed border-(--cq-border)"
                      : "border-(--cq-border-subtle) bg-(--cq-surface-raised)"
                }`}
              >
                <StatusMark status={section.status} />
                <span className="min-w-0">
                  {DECK_SECTION_LABELS[section.section]}
                </span>
                <span className="sr-only">
                  : {STATUS_WORDS[section.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="cq-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-(--cq-text-secondary)">
          <span className="inline-flex items-center gap-1">
            <StatusMark status="PRESENT" /> {t("In the deck")}
          </span>
          <span className="inline-flex items-center gap-1">
            <StatusMark status="NOT_IN_DECK" /> {t("Not in the deck yet")}
          </span>
          <span className="inline-flex items-center gap-1">
            <StatusMark status="UNCLEAR" /> {t("Unclear")}
          </span>
        </p>
        <p className="cq-caption text-(--cq-text-secondary)">
          Read by Q on{" "}
          {new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(readAt))}
          , from version {versionNumber}. Figures are the company&rsquo;s own
          claims.
        </p>
      </div>
    </details>
  );
}

/** A deck section in the shared card's shape (the Pitch deck tab). */
export function deckReadSection(
  section: DeckSection,
  downloadable: boolean,
  companyName: string,
): ReadSection {
  const label = DECK_SECTION_LABELS[section.section];
  const where = slides(section.pages);
  return {
    key: section.section,
    label,
    chip: label,
    status: section.status,
    statusWords: STATUS_WORDS[section.status],
    summary: section.summary,
    emptyText:
      section.status === "NOT_IN_DECK"
        ? `${companyName}'s deck doesn't cover this yet. Unknown, not zero: ask them.`
        : "Q couldn't read this part clearly.",
    facts: section.facts.map((fact) => ({
      key: `${fact.label}-${fact.pages.join(",")}`,
      label: fact.label,
      value: fact.value ?? null,
      source: deckFactSource(fact),
    })),
    where:
      where === null
        ? null
        : `${where} · ${downloadable ? "deck can be downloaded" : "deck is view only"}`,
    askHref: `/q?ask=${encodeURIComponent(`About ${companyName}'s ${label.toLowerCase()}: `)}`,
    askLabel: `Ask Q about ${label.toLowerCase()}`,
  };
}

export function ReadSectionCard({
  section,
  attribute,
}: {
  readonly section: ReadSection;
  readonly attribute: "deck" | "profile";
}) {
  const t = useT();
  return (
    <article
      className="flex h-full flex-col gap-4 border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
      aria-label={section.label}
      {...(attribute === "deck"
        ? { "data-deck-section": section.key }
        : { "data-profile-section": section.key })}
    >
      <header className="flex items-start justify-between gap-3">
        <h4 className="cq-title-md text-(--cq-text-primary)">
          {section.label}
        </h4>
        <span className="cq-caption inline-flex shrink-0 items-center gap-1.5 text-(--cq-text-secondary)">
          <StatusMark status={section.status} /> {section.statusWords}
        </span>
      </header>
      {section.summary === null ? (
        <p className="cq-body text-(--cq-text-secondary)">
          {section.emptyText}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="cq-body text-(--cq-text-primary)">{section.summary}</p>
          {section.summarySource === undefined ||
          section.summarySource === null ? null : (
            <span className="cq-caption inline-flex flex-wrap items-center gap-1 text-(--cq-text-secondary)">
              <UserRound size={ICON_SIZE.compact} aria-hidden="true" />
              {section.summarySource}
            </span>
          )}
        </div>
      )}
      {section.facts.length === 0 ? null : (
        <dl className="flex flex-col divide-y divide-(--cq-border-subtle) border-t border-(--cq-border-subtle)">
          {section.facts.map((fact, at) => {
            const previous = section.facts[at - 1]?.group ?? null;
            const heading =
              fact.group !== undefined &&
              fact.group !== null &&
              fact.group !== previous
                ? fact.group
                : null;
            return (
              <div key={fact.key} className="flex flex-col">
                {heading === null ? null : (
                  <p className="cq-label pt-3 text-(--cq-text-secondary)">
                    {heading}
                  </p>
                )}
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="flex min-w-0 flex-col gap-1">
                    <span className="cq-body-sm text-(--cq-text-primary)">
                      {fact.label}
                    </span>
                    <span className="cq-caption inline-flex flex-wrap items-center gap-1 text-(--cq-text-secondary)">
                      <UserRound size={ICON_SIZE.compact} aria-hidden="true" />
                      {fact.source}
                    </span>
                  </dt>
                  <dd className="cq-title-sm cq-numeric min-w-0 text-end break-words text-(--cq-text-primary)">
                    {fact.value ?? (
                      <span className="cq-body-sm text-(--cq-text-secondary)">
                        {t("Not in the deck")}
                      </span>
                    )}
                  </dd>
                </div>
              </div>
            );
          })}
        </dl>
      )}
      <footer className="mt-auto flex flex-col gap-2">
        {section.where === null ? null : (
          <p className="cq-caption inline-flex items-center gap-1 text-(--cq-text-secondary)">
            <FileText size={ICON_SIZE.compact} aria-hidden="true" />
            {section.where}
          </p>
        )}
        {section.prompt === undefined ? null : (
          <div className="flex flex-col gap-2">
            {section.prompt.question === null ? null : (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                Q will ask: &ldquo;{section.prompt.question}&rdquo;
              </p>
            )}
            <Link
              href={section.prompt.href}
              className="cq-body-sm inline-flex min-h-11 w-fit items-center gap-2 border border-(--cq-border) px-4 text-(--cq-text-primary) hover:border-(--cq-text-primary)"
              data-profile-section-prompt={section.key}
            >
              {section.prompt.label}
            </Link>
          </div>
        )}
        <Link
          href={section.askHref}
          className="cq-body-sm inline-flex min-h-11 items-center gap-2 text-(--cq-text-primary) hover:underline"
        >
          <Search size={ICON_SIZE.compact} aria-hidden="true" />{" "}
          {section.askLabel}
        </Link>
      </footer>
    </article>
  );
}

/** Q's read of the deck as the shared carousel (the Pitch deck tab). */
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
  const t = useT();
  return (
    <ReadCarousel
      sections={sections.map((section) =>
        deckReadSection(section, downloadable, companyName),
      )}
      attribute="deck"
      label={t("The deck, section by section")}
      index={index}
      onIndex={onIndex}
    />
  );
}

/**
 * Sections as a carousel: Q's read of the deck and the profile Overview.
 * The chips and the summary grid move it; the track's own scroll position
 * moves the chips (an observer, not a scroll handler), so a swipe and a
 * tap stay in step.
 */
export function ReadCarousel({
  sections,
  attribute,
  label,
  index,
  onIndex,
}: {
  readonly sections: readonly ReadSection[];
  readonly attribute: "deck" | "profile";
  readonly label: string;
  readonly index: number;
  readonly onIndex: (index: number) => void;
}) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(index);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(sections.length - 1, next));
      const card = track.current?.children[clamped];
      const root = track.current;
      if (
        card instanceof HTMLElement &&
        root !== null &&
        typeof root.scrollTo === "function"
      ) {
        root.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
      }
      onIndex(clamped);
    },
    [sections.length, onIndex],
  );

  // Only an outside pick (the summary grid) moves the track here.
  const shown = useRef(visible);
  useEffect(() => {
    shown.current = visible;
  }, [visible]);
  useEffect(() => {
    if (index !== shown.current) go(index);
  }, [index, go]);

  // A section asked for from outside (Q, a link) is where the track opens,
  // before the observer reads which card is in view.
  const opening = useRef(index);
  useEffect(() => {
    const root = track.current;
    const card = root?.children[opening.current];
    if (
      opening.current > 0 &&
      root !== null &&
      card instanceof HTMLElement &&
      typeof root.scrollTo === "function"
    ) {
      root.scrollTo({ left: card.offsetLeft });
    }
  }, []);

  useEffect(() => {
    const root = track.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const at = Array.prototype.indexOf.call(
              root.children,
              entry.target,
            );
            if (at >= 0) {
              setVisible(at);
              onIndex(at);
              const chip = chips.current?.children[at];
              if (chip instanceof HTMLElement)
                chip.scrollIntoView({ block: "nearest", inline: "nearest" });
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
    <section
      className="flex flex-col gap-3"
      aria-roledescription="carousel"
      aria-label={label}
      {...(attribute === "deck"
        ? { "data-deck-carousel": "" }
        : { "data-profile-carousel": "" })}
    >
      <div
        ref={chips}
        className="relative flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label={t("Sections")}
      >
        {sections.map((section, at) => (
          <button
            key={section.key}
            type="button"
            role="tab"
            aria-selected={visible === at}
            onClick={() => go(at)}
            className={`cq-body-sm min-h-11 shrink-0 border px-4 ${
              visible === at
                ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-text-inverse)"
                : "border-(--cq-border) text-(--cq-text-primary)"
            }`}
          >
            {section.chip}
          </button>
        ))}
      </div>
      <div className="relative">
        <div
          ref={track}
          tabIndex={0}
          onKeyDown={onKey}
          aria-live="polite"
          className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) motion-reduce:scroll-auto"
        >
          {sections.map((section, at) => (
            <div
              key={section.key}
              className="w-[86%] shrink-0 snap-start sm:w-full"
              role="group"
              aria-roledescription="slide"
              aria-label={`${String(at + 1)} of ${String(sections.length)}`}
            >
              <ReadSectionCard section={section} attribute={attribute} />
            </div>
          ))}
        </div>
        <div className="mt-2 hidden items-center justify-between sm:flex">
          <button
            type="button"
            onClick={() => go(visible - 1)}
            disabled={visible === 0}
            aria-label={t("Previous section")}
            className="flex size-11 items-center justify-center border border-(--cq-border) text-(--cq-text-primary) disabled:opacity-40"
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
            aria-label={t("Next section")}
            className="flex size-11 items-center justify-center border border-(--cq-border) text-(--cq-text-primary) disabled:opacity-40"
          >
            <ChevronRight size={ICON_SIZE.regular} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex justify-center gap-1.5 sm:hidden" aria-hidden="true">
        {sections.map((section, at) => (
          <span
            key={section.key}
            className={`h-1.5 rounded-full ${visible === at ? "w-5 bg-(--cq-text-primary)" : "w-1.5 bg-(--cq-border)"}`}
          />
        ))}
      </div>
    </section>
  );
}
