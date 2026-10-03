import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Search } from "@capital-q/ui/icons";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { NetworkVideos } from "@/features/discover/network/network-videos";
import {
  cardDescriptor,
  publicExternalFields,
} from "@/features/q-card/card-content";
import { loadPublicCard } from "@/features/q-card/public-card-data";
import { nameMatches } from "@/features/search/name-matches";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

type Tab = "people" | "videos";

/**
 * Search (founder direction 2026-09-29, "like Instagram"): one box, two
 * tabs. People opens a Q Card by its whole @handle; a handle has a live
 * card or it does not, and nothing lists or suggests strangers. A name
 * (demo audit 2026-10-03) is matched only among people the person already
 * sees: their relationships and, for a founder, Discover's investors. Videos
 * is the founders' videos open to everyone on Capital Q whose company name
 * or line matches, as a grid; the API matches only what disclosure already
 * shows the viewer.
 */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly q?: string | string[];
    readonly handle?: string | string[];
    readonly tab?: string | string[];
  }>;
} = {}) {
  const params = (await searchParams) ?? {};
  const raw =
    typeof params.q === "string"
      ? params.q
      : typeof params.handle === "string"
        ? params.handle
        : "";
  const text = raw.trim().slice(0, 80);
  const tab: Tab = params.tab === "videos" ? "videos" : "people";
  const handle = text.replace(/^@/, "").toLowerCase();
  const validHandle = /^[a-z0-9-]{3,30}$/.test(handle);
  const found =
    tab === "people" && validHandle
      ? await loadPublicCard(handle).catch(() => null)
      : null;
  const card = found !== null && found.kind === "CARD" ? found : null;
  // A name, not a handle: look among people this person already sees.
  const names =
    tab === "people" && text.length >= 2 && !text.startsWith("@")
      ? await nameMatches(text).catch(() => [])
      : [];
  const tabHref = (next: Tab) =>
    `/search?${new URLSearchParams({ ...(text.length === 0 ? {} : { q: text }), tab: next }).toString()}`;

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader title="Search" />
      <form
        action="/search"
        method="get"
        role="search"
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">Search</span>
          <span className="flex min-h-11 items-center gap-2 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3 focus-within:outline-2 focus-within:outline-(--cq-focus-ring)">
            <Search
              size={ICON_SIZE.compact}
              aria-hidden="true"
              className="text-(--cq-text-tertiary)"
            />
            <input
              name="q"
              type="search"
              defaultValue={text}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                tab === "people"
                  ? "A name, or @their-handle"
                  : "Company or what they do"
              }
              className="cq-body min-w-0 flex-1 bg-transparent text-(--cq-text-primary) outline-none"
            />
          </span>
        </label>
        <button type="submit" className={buttonClassName("primary")}>
          Search
        </button>
      </form>

      <nav
        aria-label="Search results"
        className="flex gap-6 border-b border-(--cq-border-subtle)"
      >
        {(["people", "videos"] as const).map((option) => (
          <Link
            key={option}
            href={tabHref(option)}
            aria-current={tab === option ? "page" : undefined}
            className={`cq-body-sm inline-flex min-h-11 items-center border-b-2 px-1 ${
              tab === option
                ? "border-(--cq-text-primary) text-(--cq-text-primary)"
                : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            }`}
          >
            {option === "people" ? "People" : "Videos"}
          </Link>
        ))}
      </nav>

      {tab === "videos" ? (
        <NetworkVideos key={text} text={text} />
      ) : text.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Search a name among your relationships and Discover, or open
          anyone&apos;s Q Card by their @handle.
        </p>
      ) : card === null ? (
        <div className="flex flex-col gap-4">
          {names.length === 0 ? null : (
            <ul
              aria-label="Names you can already see"
              className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)"
              data-search-names
            >
              {names.map((match) => (
                <li key={match.href}>
                  <Link
                    href={match.href}
                    className="flex min-h-14 flex-col justify-center px-1 py-2 hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                  >
                    <span className="cq-body text-(--cq-text-primary)">
                      {match.name}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {match.detail}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
            {validHandle
              ? `No Q Card at @${handle}.${names.length === 0 ? " Check the spelling with them." : ""}`
              : names.length === 0
                ? "No one by that name among your relationships or Discover. Anyone else is found by their @handle."
                : "Anyone else is found by their @handle."}
          </p>
        </div>
      ) : (
        <Link
          href={`/@${card.handle}`}
          data-find-result={card.handle}
          className="flex min-h-14 items-center gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3 hover:bg-(--cq-surface-raised) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          <span
            aria-hidden="true"
            className="cq-label flex size-10 shrink-0 items-center justify-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-primary)"
          >
            {card.name.trim().slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="cq-body truncate font-medium text-(--cq-text-primary)">
              {card.name}
            </span>
            <span className="cq-caption truncate text-(--cq-text-secondary)">
              {cardDescriptor(
                card.subjectType,
                publicExternalFields(card.fields),
              )}
              {" · "}@{card.handle}
            </span>
          </span>
        </Link>
      )}
    </PageContainer>
  );
}
