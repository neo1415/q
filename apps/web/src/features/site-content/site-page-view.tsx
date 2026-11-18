import type { PublicSitePageDto, SiteBlock } from "@capital-q/contracts";

import { anchorOf, SiteBlocks, type SiteBlocksOptions } from "./site-blocks";

/**
 * One published page (decision 107) in the design system: a reading
 * column, and on a legal page a contents list beside it on wide screens
 * so a long document can be scanned and jumped through. Shared by the
 * public routes and the editor's preview, so what an admin previews is
 * what a visitor gets.
 */

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
}

function contentsOf(blocks: readonly SiteBlock[]) {
  return blocks.flatMap((block) =>
    block.type === "legalClause" && block.title !== ""
      ? [{ id: anchorOf(block.title), title: block.title }]
      : [],
  );
}

export function SitePageView({
  page,
  options,
  compact = false,
}: {
  readonly page: Pick<
    PublicSitePageDto,
    "kind" | "title" | "summary" | "effectiveDate" | "blocks"
  > & { readonly versionNumber?: number | undefined };
  readonly options?: SiteBlocksOptions;
  /** The editor's phone preview: no side column whatever the window. */
  readonly compact?: boolean;
}) {
  const contents = page.kind === "legal" ? contentsOf(page.blocks) : [];
  const wide = page.kind === "pricing";
  const sideBySide = contents.length > 2 && !compact;
  // Container queries, not viewport ones: the editor previews this at
  // phone and desktop widths inside the console, and it lays out exactly
  // as it will for a visitor at that width.
  return (
    <div className="@container">
      <article
        className={`mx-auto flex flex-col gap-10 px-4 pt-12 pb-20 @2xl:px-8 @2xl:pt-16 ${
          wide ? "max-w-6xl" : sideBySide ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        <header className={`flex flex-col gap-4 ${wide ? "max-w-3xl" : ""}`}>
          <h1 className="cq-display text-balance text-(--cq-text-primary) @2xl:text-[2.75rem]">
            {page.title}
          </h1>
          {page.summary === "" ? null : (
            <p className="cq-body-lg max-w-[62ch] text-pretty text-(--cq-text-secondary)">
              {page.summary}
            </p>
          )}
          {page.kind === "legal" && page.effectiveDate !== null ? (
            <p className="cq-body-sm text-(--cq-text-tertiary)">
              Effective {formatDate(page.effectiveDate)}
              {page.versionNumber === undefined
                ? ""
                : `, version ${String(page.versionNumber)}`}
            </p>
          ) : null}
        </header>
        {sideBySide ? (
          <div className="grid gap-10 @5xl:grid-cols-[15rem_minmax(0,1fr)] @5xl:gap-16">
            <nav
              aria-label="Contents"
              className="hidden self-start @5xl:sticky @5xl:top-24 @5xl:block"
            >
              <p className="cq-label mb-3 text-(--cq-text-primary)">Contents</p>
              <ol className="flex max-h-[calc(100dvh-9rem)] flex-col gap-0.5 overflow-y-auto border-s border-(--cq-border-subtle)">
                {contents.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="cq-body-sm -ms-px block border-s border-transparent py-1.5 ps-4 text-(--cq-text-secondary) hover:border-(--cq-text-primary) hover:text-(--cq-text-primary)"
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="max-w-[70ch]">
              <SiteBlocks
                blocks={page.blocks}
                {...(options === undefined ? {} : { options })}
              />
            </div>
          </div>
        ) : (
          <SiteBlocks
            blocks={page.blocks}
            {...(options === undefined ? {} : { options })}
          />
        )}
      </article>
    </div>
  );
}
