import type {
  QDailyChart,
  QDailyEdition,
  QDailyImage,
  QDailyStory,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { Download, ExternalLink } from "@capital-q/ui/icons";

import { formatLongDay } from "@/components/date-format";

/**
 * The Q Daily, read in the app (DAILY spec §3): a newspaper rather than a
 * feed. Masthead, a lead across the page, sections in columns on wide
 * screens and one column on a phone, a deals diagram drawn from the
 * figures the sources printed, briefs, and Q's take set apart and labelled
 * as Q's inference. Every story names its publisher and links to it.
 *
 * Pictures: a licensed stock photograph with its credit, or a publisher's
 * own feed thumbnail, hotlinked and linked to the article (never copied).
 */

const EDITORIAL = "font-(family-name:--cq-font-editorial)";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Picture({
  image,
  priority = false,
}: {
  readonly image: QDailyImage;
  readonly priority?: boolean;
}) {
  const img = (
    // A remote picture shown as the publisher or Pexels serves it: the
    // optimiser would re-host bytes Capital Q has no right to copy.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      className="aspect-[16/9] w-full rounded-sm bg-(--cq-surface-subtle) object-cover"
    />
  );
  return (
    <figure className="flex flex-col gap-1">
      {image.linkUrl === null ? (
        img
      ) : (
        <a href={image.linkUrl} target="_blank" rel="noopener noreferrer">
          {img}
        </a>
      )}
      <figcaption className="cq-caption text-(--cq-text-tertiary)">
        {image.creditUrl === null ? (
          image.credit
        ) : (
          <a
            href={image.creditUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {image.credit}
          </a>
        )}
      </figcaption>
    </figure>
  );
}

function Sources({ story }: { readonly story: QDailyStory }) {
  return (
    <p className="cq-caption flex flex-wrap items-center gap-x-2 text-(--cq-text-secondary)">
      <span>Source:</span>
      {story.sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 underline underline-offset-2 sm:min-h-0"
        >
          {source.publisher}
          <span className="sr-only">
            {" "}
            ({hostOf(source.url)}, opens in a new tab)
          </span>
          <ExternalLink aria-hidden="true" size={12} strokeWidth={1.75} />
        </a>
      ))}
    </p>
  );
}

function Paragraphs({ story }: { readonly story: QDailyStory }) {
  return (
    <>
      {story.paragraphs.map((paragraph, index) => (
        <p key={index} className="cq-body-sm text-(--cq-text-primary)">
          {paragraph}
        </p>
      ))}
      {story.quotes.map((quote, index) => (
        <blockquote
          key={index}
          className={`${EDITORIAL} border-l-2 border-(--cq-text-primary) pl-3 text-[17px] leading-snug text-(--cq-text-primary)`}
        >
          <p>&ldquo;{quote.text}&rdquo;</p>
          {quote.speaker === null ? null : (
            <footer className="cq-caption mt-1 font-(family-name:--cq-font-ui) text-(--cq-text-secondary)">
              {quote.speaker}
            </footer>
          )}
        </blockquote>
      ))}
    </>
  );
}

function Body({
  story,
  fold = false,
}: {
  readonly story: QDailyStory;
  /**
   * design-48 v2: on a phone a story below the lead is its headline,
   * standfirst and sources; the body is one tap away. Open on a large
   * screen through ::details-content (folded where that is unsupported).
   */
  readonly fold?: boolean;
}) {
  const hasBody = story.paragraphs.length > 0 || story.quotes.length > 0;
  return (
    <>
      {!hasBody ? null : fold ? (
        <details
          className="group flex flex-col gap-3 lg:[&::details-content]:[content-visibility:visible]"
          data-story-fold
        >
          <summary className="cq-body-sm flex min-h-11 cursor-pointer list-none items-center text-(--cq-text-primary) underline underline-offset-4 lg:hidden [&::-webkit-details-marker]:hidden">
            Read
            <span className="sr-only"> {story.headline}</span>
          </summary>
          <div className="flex flex-col gap-3">
            <Paragraphs story={story} />
          </div>
        </details>
      ) : (
        <Paragraphs story={story} />
      )}
      <Sources story={story} />
    </>
  );
}

function Lead({ story }: { readonly story: QDailyStory }) {
  return (
    <article
      aria-labelledby={`story-${story.id}`}
      className={
        story.image === null
          ? "grid max-w-4xl gap-5 border-b border-(--cq-border) pb-8"
          : "grid gap-5 border-b border-(--cq-border) pb-8 md:grid-cols-[3fr_2fr]"
      }
      data-daily-lead
    >
      <div className="flex flex-col gap-3">
        <h2
          id={`story-${story.id}`}
          className={`${EDITORIAL} text-[30px] leading-[1.12] font-semibold text-(--cq-text-primary) md:text-[38px]`}
        >
          {story.headline}
        </h2>
        {story.standfirst.length === 0 ? null : (
          <p
            className={`${EDITORIAL} text-[19px] leading-snug text-(--cq-text-secondary)`}
          >
            {story.standfirst}
          </p>
        )}
        <div className="flex flex-col gap-3 md:columns-1">
          <Body story={story} />
        </div>
      </div>
      {story.image === null ? null : (
        <div className="order-first md:order-none">
          <Picture image={story.image} priority />
        </div>
      )}
    </article>
  );
}

function Story({ story }: { readonly story: QDailyStory }) {
  return (
    <article
      aria-labelledby={`story-${story.id}`}
      className="flex break-inside-avoid flex-col gap-2 border-t border-(--cq-border-subtle) pt-4"
    >
      {story.image === null ? null : <Picture image={story.image} />}
      <h3
        id={`story-${story.id}`}
        className={`${EDITORIAL} text-[21px] leading-tight font-semibold text-(--cq-text-primary)`}
      >
        {story.headline}
      </h3>
      {story.standfirst.length === 0 ? null : (
        <p className="cq-body-sm font-medium text-(--cq-text-secondary)">
          {story.standfirst}
        </p>
      )}
      <Body story={story} fold />
    </article>
  );
}

function Kicker({
  id,
  title,
}: {
  readonly id: string;
  readonly title: string;
}) {
  return (
    <h2
      id={id}
      className="cq-label border-b-2 border-(--cq-text-primary) pb-1 text-(--cq-text-primary)"
    >
      {title}
    </h2>
  );
}

function DealsChart({ chart }: { readonly chart: QDailyChart }) {
  const top = Math.max(...chart.bars.map((bar) => bar.value), 1);
  return (
    <figure
      className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-4"
      data-daily-chart
    >
      <figcaption className="cq-title-sm text-(--cq-text-primary)">
        {chart.title}
      </figcaption>
      <ol className="flex flex-col gap-2">
        {chart.bars.map((bar) => (
          <li
            key={bar.storyId}
            className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3"
          >
            <a
              href={`#story-${bar.storyId}`}
              className="cq-body-sm truncate text-(--cq-text-primary) underline-offset-2 hover:underline"
            >
              {bar.label}
            </a>
            <span
              aria-hidden="true"
              className="h-3 rounded-sm bg-(--cq-accent)"
              style={{
                width: `${Math.max(2, Math.round((bar.value / top) * 100))}%`,
              }}
            />
            <span className="cq-body-sm cq-numeric font-semibold text-(--cq-text-primary)">
              {bar.formatted}
            </span>
          </li>
        ))}
      </ol>
      <p className="cq-caption text-(--cq-text-tertiary)">{chart.source}</p>
    </figure>
  );
}

function usesStock(edition: QDailyEdition): boolean {
  return [
    ...(edition.lead === null ? [] : [edition.lead]),
    ...edition.sections.flatMap((section) => section.stories),
  ].some((story) => story.image?.kind === "STOCK");
}

export function dateline(edition: QDailyEdition): string {
  return [
    formatLongDay(edition.editionDate),
    edition.frequency === "DAILY" ? "Daily edition" : "Weekly edition",
    `No. ${edition.number}`,
    ...(edition.readerName === null ? [] : [`For ${edition.readerName}`]),
  ].join(" · ");
}

export function Newspaper({ edition }: { readonly edition: QDailyEdition }) {
  const hasDeals = edition.sections.some((section) => section.code === "DEALS");
  return (
    <article className="flex flex-col gap-8" data-daily-edition={edition.id}>
      <header className="flex flex-col items-center gap-2 text-center">
        <p
          className={`${EDITORIAL} text-[44px] leading-none font-semibold tracking-tight text-(--cq-text-primary) md:text-[64px]`}
        >
          The Q Daily
        </p>
        <div className="w-full border-y-[3px] border-double border-(--cq-text-primary) py-2">
          <p className="cq-caption text-(--cq-text-secondary)">
            {dateline(edition)}
          </p>
        </div>
        {edition.topics.length === 0 ? null : (
          <p className="cq-caption text-(--cq-text-tertiary)">
            Following {edition.topics.join(", ")}
          </p>
        )}
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <a
            href={`/api/q-daily/${edition.id}/pdf`}
            className={buttonClassName("secondary", "compact")}
            download
            data-daily-pdf
          >
            <Download aria-hidden="true" size={16} strokeWidth={1.75} />
            Download PDF
          </a>
          <a
            href="/settings#q-daily"
            className={buttonClassName("quiet", "compact")}
          >
            Change how often
          </a>
        </div>
      </header>

      {edition.lead === null ? (
        <p
          className={`${EDITORIAL} text-center text-[19px] text-(--cq-text-secondary)`}
        >
          A quiet {edition.frequency === "DAILY" ? "day" : "week"} in your
          markets: nothing new Q could cite.
        </p>
      ) : (
        <Lead story={edition.lead} />
      )}

      {edition.sections.map((section) => (
        <section
          key={section.code}
          aria-labelledby={`section-${section.code}`}
          className="flex flex-col gap-4"
        >
          <Kicker id={`section-${section.code}`} title={section.title} />
          <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {section.stories.map((story) => (
              <Story key={story.id} story={story} />
            ))}
          </div>
          {section.code === "DEALS" && edition.chart !== null ? (
            <DealsChart chart={edition.chart} />
          ) : null}
        </section>
      ))}

      {!hasDeals && edition.chart !== null ? (
        <section
          aria-labelledby="section-deals-chart"
          className="flex flex-col gap-4"
        >
          <Kicker id="section-deals-chart" title="Deals and rounds" />
          <DealsChart chart={edition.chart} />
        </section>
      ) : null}

      {edition.briefs.length === 0 ? null : (
        <section
          aria-labelledby="section-briefs"
          className="flex flex-col gap-3"
        >
          <Kicker id="section-briefs" title="In brief" />
          <ul className="grid gap-x-8 md:grid-cols-2">
            {edition.briefs.map((story) => (
              <li
                key={story.id}
                id={`story-${story.id}`}
                className="flex flex-col gap-1 border-t border-(--cq-border-subtle) py-3"
              >
                <p
                  className={`${EDITORIAL} text-[17px] leading-snug font-semibold text-(--cq-text-primary)`}
                >
                  {story.headline}
                </p>
                <Sources story={story} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {edition.qTake === null ? null : (
        <aside
          aria-labelledby="section-q-take"
          className="flex flex-col gap-2 rounded-md border border-(--cq-border-strong) p-5"
          data-daily-q-take
        >
          <h2 id="section-q-take" className="cq-label text-(--cq-text-primary)">
            Q&apos;s take
          </h2>
          <p className="cq-caption text-(--cq-text-secondary)">
            Q&apos;s inference from the stories in this edition, not reported
            fact.
          </p>
          {edition.qTake.paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className={`${EDITORIAL} text-[17px] leading-relaxed text-(--cq-text-primary)`}
            >
              {paragraph}
            </p>
          ))}
        </aside>
      )}

      <footer className="cq-caption flex flex-col gap-1 border-t border-(--cq-border) pt-4 text-(--cq-text-tertiary)">
        <p>
          Every story names its source. Q&apos;s take is Q&apos;s inference.
        </p>
        {usesStock(edition) ? (
          <p>
            <a
              href="https://www.pexels.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Photos provided by Pexels
            </a>
          </p>
        ) : null}
      </footer>
    </article>
  );
}
