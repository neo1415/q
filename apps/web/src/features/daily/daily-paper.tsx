"use client";

import { useState } from "react";

import type { QDailyEdition, QDailyStory } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  CalendarDays,
  Download,
  ExternalLink,
  ICON_SIZE,
  Link as LinkIcon,
} from "@capital-q/ui/icons";

import { formatDay, formatLongDay } from "@/components/date-format";
import { OpenPdfButton } from "@/features/documents/in-app-reader";
import { QRing } from "@/features/relationships/crm-kit";
import { WorkSheet, WorkTag, workButton } from "@/features/work/work-kit";
import { useT } from "@/features/i18n/language";

/**
 * The Q Daily as a newspaper (chosen design 2026-10-21, option 1, near
 * black): the masthead, the lead with its source and Q's take, In brief
 * beside it, then Deals and rounds, and Following. Every story names its
 * source; Q's take is labelled Q's inference, and a story Q has no take on
 * says so. A story opens in a sheet: its source first, then the reporting,
 * then Q's take.
 */

/** The stories under each of the paper's headings. */
export function paperColumns(edition: QDailyEdition): {
  readonly brief: readonly QDailyStory[];
  readonly deals: readonly QDailyStory[];
  readonly following: readonly QDailyStory[];
} {
  const sections = edition.sections;
  return {
    brief: [
      ...sections
        .filter((section) => section.code !== "DEALS" && section.code !== "PEOPLE")
        .flatMap((section) => section.stories),
      ...edition.briefs,
    ],
    deals: sections
      .filter((section) => section.code === "DEALS")
      .flatMap((section) => section.stories),
    following: sections
      .filter((section) => section.code === "PEOPLE")
      .flatMap((section) => section.stories),
  };
}

/** Q's take on one story: the edition's take, when it names this story. */
export function takeFor(
  edition: QDailyEdition,
  story: QDailyStory,
): readonly string[] | null {
  return edition.qTake !== null && edition.qTake.storyIds.includes(story.id)
    ? edition.qTake.paragraphs
    : null;
}

function sourceWords(story: QDailyStory): string {
  const first = story.sources[0];
  if (first === undefined) return "";
  const when =
    first.publishedAt !== null && !Number.isNaN(Date.parse(first.publishedAt))
      ? `, ${formatDay(first.publishedAt)}`
      : "";
  const more =
    story.sources.length > 1
      ? ` and ${String(story.sources.length - 1)} more`
      : "";
  return `${first.publisher}${when}${more}`;
}

function Source({ story }: { readonly story: QDailyStory }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--cq-text-tertiary)">
      <LinkIcon size={14} aria-hidden="true" />
      {t(`Source: ${sourceWords(story)}`)}
    </span>
  );
}

function Take({ paragraphs }: { readonly paragraphs: readonly string[] | null }) {
  const t = useT();
  if (paragraphs === null) {
    return (
      <p className="m-0 text-xs text-(--cq-text-tertiary)">
        {t("Q has no take on this one.")}
      </p>
    );
  }
  return (
    <div
      className="flex flex-col items-start gap-1.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3.5 py-3"
      data-daily-take
    >
      <WorkTag
        tone="stone"
        icon={<QRing className="size-3.5 text-[8px]" />}
      >
        {t("Q’s take, Q’s inference")}
      </WorkTag>
      {paragraphs.map((paragraph) => (
        <p
          key={paragraph}
          className="m-0 text-[15px] leading-[1.55] text-(--cq-text-primary)"
        >
          {t(paragraph)}
        </p>
      ))}
    </div>
  );
}

function body(story: QDailyStory): readonly string[] {
  return [
    ...(story.standfirst.length === 0 ? [] : [story.standfirst]),
    ...story.paragraphs,
  ];
}

export function DailyPaper({
  edition,
  onEarlier,
}: {
  readonly edition: QDailyEdition;
  /** "Earlier editions": opens the calendar (or the archive). */
  readonly onEarlier?: { readonly href: string } | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState<QDailyStory | null>(null);
  const { brief, deals, following } = paperColumns(edition);
  const lead = edition.lead;
  const storyButton =
    "flex w-full flex-col gap-1 rounded-(--cq-radius-md) text-start transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)";

  return (
    <article
      className="flex flex-col gap-5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-[18px] sm:px-8 sm:py-7"
      data-daily-edition={edition.id}
    >
      <header className="flex flex-col items-center gap-1 border-b-[3px] border-double border-(--cq-border) pb-4 text-center">
        <span className="text-xs text-(--cq-text-tertiary)">
          {t(formatLongDay(edition.editionDate))}
        </span>
        <h2 className="m-0 text-[34px] leading-none font-semibold tracking-[-0.035em] text-(--cq-text-primary) sm:text-[44px]">
          The Q Daily
        </h2>
        <span className="text-xs text-(--cq-text-tertiary)">
          {t(
            `No. ${String(edition.number)}, ${
              edition.frequency === "DAILY" ? "daily" : "weekly"
            } edition${edition.readerName === null ? "" : `, for ${edition.readerName}`}`,
          )}
        </span>
      </header>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-7">
        {lead === null ? (
          <p className="m-0 text-[17px] text-(--cq-text-secondary)">
            {t(
              `A quiet ${edition.frequency === "DAILY" ? "day" : "week"} in your markets: nothing new Q could cite.`,
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5" data-daily-lead>
            <button
              type="button"
              onClick={() => setOpen(lead)}
              className={cx(storyButton, "-m-1 p-1")}
            >
              <h3 className="m-0 text-[23px] leading-[1.15] font-semibold tracking-[-0.02em] text-(--cq-text-primary) sm:text-[28px]">
                {t(lead.headline)}
              </h3>
            </button>
            <Source story={lead} />
            {body(lead)
              .slice(0, 2)
              .map((paragraph) => (
                <p
                  key={paragraph}
                  className="m-0 text-base leading-[1.6] text-(--cq-text-primary)"
                >
                  {t(paragraph)}
                </p>
              ))}
            <Take paragraphs={takeFor(edition, lead)} />
          </div>
        )}
        <section
          aria-labelledby="daily-brief"
          className="flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-3.5 lg:border-t-0 lg:border-s lg:ps-6 lg:pt-0"
        >
          <h4
            id="daily-brief"
            className="m-0 mb-1.5 text-sm font-semibold text-(--cq-text-primary)"
          >
            {t("In brief")}
          </h4>
          {brief.length === 0 ? (
            <p className="m-0 text-xs text-(--cq-text-tertiary)">
              {t("Nothing else Q could cite this time.")}
            </p>
          ) : (
            brief.map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={() => setOpen(story)}
                className={cx(
                  storyButton,
                  "border-b border-(--cq-border-subtle) px-2 py-2.5",
                )}
                data-daily-story={story.id}
              >
                <b className="text-[15px] leading-[1.35] font-medium text-(--cq-text-primary)">
                  {t(story.headline)}
                </b>
                <Source story={story} />
              </button>
            ))
          )}
        </section>
      </div>

      <div className="grid gap-[18px] border-t border-(--cq-border-subtle) pt-4 sm:grid-cols-2 sm:gap-7">
        <section aria-labelledby="daily-deals" className="flex flex-col">
          <h4
            id="daily-deals"
            className="m-0 mb-1.5 text-sm font-semibold text-(--cq-text-primary)"
          >
            {t("Deals and rounds")}
          </h4>
          {deals.length === 0 ? (
            <p className="m-0 text-xs text-(--cq-text-tertiary)">
              {t("No rounds Q could cite this time.")}
            </p>
          ) : (
            deals.map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={() => setOpen(story)}
                className={cx(
                  storyButton,
                  "gap-0.5 rounded-none border-b border-(--cq-border-subtle) py-2",
                )}
                data-daily-story={story.id}
              >
                <b className="text-sm text-(--cq-text-primary)">
                  {t(story.deal?.company ?? story.headline)}
                </b>
                {story.deal === null ? null : (
                  <span className="text-sm text-(--cq-text-primary) tabular-nums">
                    {t(
                      [story.deal.amount, story.deal.round]
                        .filter((part): part is string => part !== null)
                        .join(" ") || "Amount not reported",
                    )}
                  </span>
                )}
                <Source story={story} />
              </button>
            ))
          )}
        </section>
        <section aria-labelledby="daily-following" className="flex flex-col">
          <h4
            id="daily-following"
            className="m-0 mb-1.5 text-sm font-semibold text-(--cq-text-primary)"
          >
            {t("Following")}
          </h4>
          {following.map((story) => (
            <button
              key={story.id}
              type="button"
              onClick={() => setOpen(story)}
              className={cx(
                storyButton,
                "gap-0.5 rounded-none border-b border-(--cq-border-subtle) py-2",
              )}
              data-daily-story={story.id}
            >
              <b className="text-sm text-(--cq-text-primary)">
                {t(story.headline)}
              </b>
              <Source story={story} />
            </button>
          ))}
          {following.length > 0 ? null : edition.topics.length === 0 ? (
            <p className="m-0 text-xs text-(--cq-text-tertiary)">
              {t("Nothing new about the people you follow that Q could cite.")}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 border-b border-(--cq-border-subtle) py-2">
              <b className="text-sm text-(--cq-text-primary)">
                {t(edition.topics.join(", "))}
              </b>
              <span className="text-xs text-(--cq-text-tertiary)">
                {t("Nothing new about them that Q could cite")}
              </span>
            </div>
          )}
        </section>
      </div>

      <p className="m-0 text-xs text-(--cq-text-tertiary)">
        {t("Every story names its source. Q’s take is Q’s inference, not reporting.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <OpenPdfButton
          title={t("The Q Daily")}
          url={`/api/q-daily/${edition.id}/pdf`}
          className={workButton("secondary", undefined, "small")}
          dataAttribute="data-daily-pdf"
        >
          <Download size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Open PDF")}
        </OpenPdfButton>
        <a
          href="/settings#q-daily"
          className={workButton("quiet", undefined, "small")}
        >
          {t("Change how often")}
        </a>
        {onEarlier === undefined ? null : (
          <a
            href={onEarlier.href}
            className={workButton("quiet", undefined, "small")}
          >
            <CalendarDays size={ICON_SIZE.compact} aria-hidden="true" />
            {t("Earlier editions")}
          </a>
        )}
      </div>

      <WorkSheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        tone="ink"
        title={open === null ? "" : t(open.headline)}
        footer={
          open?.sources[0] === undefined ? null : (
            <a
              href={open.sources[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className={workButton("secondary")}
            >
              {t("Read at the source")}
              <ExternalLink size={ICON_SIZE.compact} aria-hidden="true" />
            </a>
          )
        }
        data-daily-story-sheet
      >
        {open === null ? null : (
          <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {open.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 text-xs text-(--cq-text-tertiary) underline-offset-2 hover:underline lg:min-h-0"
                  >
                    <LinkIcon size={14} aria-hidden="true" />
                    {t(`Source: ${source.publisher}`)}
                    {source.title.length === 0 ? "" : ` · ${source.title}`}
                  </a>
                </li>
              ))}
            </ul>
            {open.image === null ? null : (
              <figure className="m-0 flex flex-col gap-1">
                {/* A remote picture as its publisher serves it: never re-hosted. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={open.image.url}
                  alt={t(open.image.alt)}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="aspect-video w-full rounded-(--cq-radius-md) bg-(--cq-surface-subtle) object-cover"
                />
                <figcaption className="text-xs text-(--cq-text-tertiary)">
                  {t(open.image.credit)}
                </figcaption>
              </figure>
            )}
            {body(open).map((paragraph) => (
              <p
                key={paragraph}
                className="m-0 text-base leading-[1.6] text-(--cq-text-primary)"
              >
                {t(paragraph)}
              </p>
            ))}
            {open.quotes.map((quote) => (
              <blockquote
                key={quote.text}
                className="m-0 border-s-2 border-(--cq-text-primary) ps-3 text-[15px] text-(--cq-text-primary)"
              >
                &ldquo;{quote.text}&rdquo;
                {quote.speaker === null ? null : (
                  <footer className="mt-1 text-xs text-(--cq-text-secondary)">
                    {t(quote.speaker)}
                  </footer>
                )}
              </blockquote>
            ))}
            <Take paragraphs={takeFor(edition, open)} />
          </>
        )}
      </WorkSheet>
    </article>
  );
}
