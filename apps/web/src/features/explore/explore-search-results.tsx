"use client";

import Link from "next/link";

import { EXPLORE_SEARCH_TABS, type ExploreTileDto } from "@capital-q/contracts";
import { ChevronRight, ICON_SIZE, Search, X } from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { ExploreGrid } from "./explore-grid";
import {
  SEARCH_TAB_LABELS,
  searchHref,
  type ExploreSearchView,
  type ProfileResult,
} from "./explore-search-view";
import { ExploreState } from "./explore-state";

/** The box at the top of Explore; a plain GET form, so it works before hydration. */
export function ExploreSearchBar({ value = "" }: { readonly value?: string }) {
  return (
    <form action="/explore" method="get" role="search" className="w-full">
      <label className="relative block">
        <span className="sr-only">
          Search companies, investors, people and pitches
        </span>
        <Search
          size={ICON_SIZE.prominent}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-(--cq-text-tertiary)"
        />
        <input
          name="q"
          type="search"
          defaultValue={value}
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          placeholder="Search companies, investors, people"
          className="cq-body min-h-12 w-full rounded-(--cq-radius-full) border border-transparent bg-(--cq-surface-subtle) pr-4 pl-11 text-[16px] text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          data-explore-search
        />
      </label>
    </form>
  );
}

function ResultRow({ result }: { readonly result: ProfileResult }) {
  return (
    <li>
      <Link
        href={result.href}
        className="grid min-h-16 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-(--cq-border-subtle) py-2.5 hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        data-explore-result={result.kind}
      >
        <EntityAvatar
          kind={result.kind}
          name={result.name}
          {...(result.kind === "company"
            ? { companyId: result.id }
            : { investorOrganisationId: result.id })}
          src={result.photoUrl ?? null}
          size={48}
          decorative
        />
        <span className="min-w-0">
          <b className="block truncate font-semibold">{result.name}</b>
          {result.line === null ? null : (
            <span className="cq-body-sm block truncate text-(--cq-text-primary)">
              {result.line}
            </span>
          )}
          <span className="cq-caption block truncate text-(--cq-text-secondary)">
            {result.meta}
          </span>
        </span>
        <ChevronRight
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="text-(--cq-text-tertiary)"
        />
      </Link>
    </li>
  );
}

function Section({
  title,
  seeAll,
  children,
}: {
  readonly title: string;
  readonly seeAll?: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="cq-title-sm">{title}</h2>
        {seeAll === undefined ? null : (
          <Link
            href={seeAll}
            className="cq-body-sm text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          >
            See all
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function ExploreSearchResults({
  view,
  state = "ready",
  columns,
  posters,
  sectorLabels,
  limited,
  onOpen,
}: {
  readonly view: ExploreSearchView;
  readonly state?: "ready" | "loading" | "error";
  readonly columns: number | null;
  readonly posters: Readonly<Record<string, string>>;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly limited: React.ReactNode;
  readonly onOpen: (tiles: readonly ExploreTileDto[], index: number) => void;
}) {
  const { query, tab } = view;
  const head = (
    <>
      <ExploreSearchBar value={query} />
      {view.chips.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5" data-explore-chips>
          <span className="cq-caption text-(--cq-text-secondary)">
            Searching for
          </span>
          {view.chips.map((chip) => (
            <span
              key={`${chip.kind}:${chip.label}`}
              className="inline-flex min-h-8 items-center gap-1 rounded-(--cq-radius-full) bg-(--cq-accent-soft) py-0 pr-1.5 pl-3 text-[13.5px] text-(--cq-text-primary)"
            >
              {chip.label}
              <Link
                href={searchHref(chip.without, tab)}
                aria-label={`Remove ${chip.label}`}
                className="grid size-7 place-items-center rounded-full hover:bg-(--cq-surface-subtle)"
              >
                <X size={14} aria-hidden="true" />
              </Link>
            </span>
          ))}
        </div>
      )}
      <nav
        aria-label="Result types"
        className="flex gap-[22px] overflow-x-auto border-b border-(--cq-border-subtle) [scrollbar-width:none]"
      >
        {EXPLORE_SEARCH_TABS.map((option) => (
          <Link
            key={option}
            href={searchHref(query, option)}
            aria-current={tab === option ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-px text-[15px] whitespace-nowrap ${
              tab === option
                ? "border-(--cq-text-primary) font-medium text-(--cq-text-primary)"
                : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            }`}
          >
            {SEARCH_TAB_LABELS[option]}
          </Link>
        ))}
      </nav>
    </>
  );

  if (state === "loading") {
    return (
      <div className="flex max-w-[900px] flex-col gap-3.5" aria-busy="true">
        {head}
        {[0, 1, 2].map((n) => (
          <div key={n} className="flex items-center gap-3">
            <div className="cq-explore-skeleton size-12 shrink-0" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="cq-explore-skeleton h-[15px] w-2/5" />
              <div className="cq-explore-skeleton h-3 w-[70%]" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex max-w-[900px] flex-col gap-3.5">
        {head}
        <ExploreState
          kind="error"
          what="Search"
          retryHref={searchHref(query, tab)}
        />
      </div>
    );
  }

  const nothing =
    view.companies.length === 0 &&
    view.investors.length === 0 &&
    view.people.length === 0 &&
    view.pitches.length === 0;
  if (nothing) {
    return (
      <div className="flex max-w-[900px] flex-col gap-3.5">
        <ExploreSearchBar value={query} />
        <ExploreState
          kind="no-results"
          query={query}
          suggestions={view.chips
            .map((chip) => chip.without)
            .filter((q) => q.length > 0)}
        />
      </div>
    );
  }

  const grid = (tiles: readonly ExploreTileDto[]) =>
    columns === null ? null : (
      <ExploreGrid
        tiles={tiles}
        posters={posters}
        columns={columns}
        sectorLabels={sectorLabels}
        label="Pitches"
        onOpen={(index) => onOpen(tiles, index)}
      />
    );
  const list = (results: readonly ProfileResult[], empty: string) =>
    results.length === 0 ? (
      <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
        {empty}
      </p>
    ) : (
      <ul className="flex flex-col">
        {results.map((r) => (
          <ResultRow key={`${r.kind}:${r.id}`} result={r} />
        ))}
      </ul>
    );

  return (
    <div
      className="flex max-w-[1100px] flex-col gap-3.5"
      data-explore-search-results
    >
      {head}
      {limited}
      {tab === "top" ? (
        <>
          {view.companies.length === 0 ? null : (
            <Section
              title="Companies"
              seeAll={
                view.companies.length > 3
                  ? searchHref(query, "companies")
                  : undefined
              }
            >
              {list(view.companies.slice(0, 3), "")}
            </Section>
          )}
          {view.investors.length === 0 ? null : (
            <Section
              title="Investors"
              seeAll={
                view.investors.length > 3
                  ? searchHref(query, "investors")
                  : undefined
              }
            >
              {list(view.investors.slice(0, 3), "")}
            </Section>
          )}
          {view.pitches.length === 0 ? null : (
            <Section
              title="Pitches"
              seeAll={
                view.pitches.length > 6
                  ? searchHref(query, "pitches")
                  : undefined
              }
            >
              {grid(view.pitches.slice(0, 6))}
            </Section>
          )}
        </>
      ) : tab === "companies" ? (
        list(view.companies, "No company you can see matches.")
      ) : tab === "investors" ? (
        list(
          view.investors,
          "No investor among your relationships or Discover matches. Anyone else is found by their @handle.",
        )
      ) : tab === "people" ? (
        <div className="flex flex-col gap-3">
          {list(
            view.people,
            "No one by that name among the people you already work with.",
          )}
          {query.startsWith("@") ? (
            <Link
              href={`/search?${new URLSearchParams({ q: query, tab: "people" }).toString()}`}
              className="cq-body-sm underline"
            >
              Look up {query}
            </Link>
          ) : null}
        </div>
      ) : (
        grid(view.pitches)
      )}
      {view.related.length === 0 ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Related:{" "}
          {view.related.map((phrase, at) => (
            <span key={phrase}>
              {at === 0 ? null : " · "}
              <Link href={searchHref(phrase)} className="underline">
                {phrase}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
