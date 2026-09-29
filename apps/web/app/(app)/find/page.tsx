import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Search } from "@capital-q/ui/icons";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import {
  cardDescriptor,
  publicExternalFields,
} from "@/features/q-card/card-content";
import {
  appOrigin,
  displayUrlFor,
  loadPublicCard,
} from "@/features/q-card/public-card-data";
import { QCard } from "@/features/q-card/q-card";
import { qrSvg } from "@/features/q-card/qr";

export const metadata: Metadata = { title: "Find by handle" };
export const dynamic = "force-dynamic";

/**
 * Find a Q Card by its @handle (founder design 2026-09-28). The lookup is
 * the public page's own read: a handle either has a live card, which is
 * shown as its owner chose, or it does not; a malformed handle, an unknown
 * one and one without a card are one answer. Whole handles only: nothing
 * here lists or suggests other people.
 */
export default async function FindPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly handle?: string | string[] }>;
} = {}) {
  const raw = (await searchParams)?.handle;
  const query =
    typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
  const valid = /^[a-z0-9-]{3,30}$/.test(query);
  const found = valid ? await loadPublicCard(query).catch(() => null) : null;
  const card = found !== null && found.kind === "CARD" ? found : null;
  const origin = appOrigin();

  return (
    <PageContainer width="reading">
      <PageHeader
        title="Find by handle"
        description="Type someone's @handle to open their Q Card."
      />
      <form
        action="/find"
        method="get"
        role="search"
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="cq-label text-(--cq-text-primary)">Handle</span>
          <span className="flex min-h-11 items-center gap-2 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3 focus-within:outline-2 focus-within:outline-(--cq-focus-ring)">
            <Search
              size={ICON_SIZE.compact}
              aria-hidden="true"
              className="text-(--cq-text-tertiary)"
            />
            <span aria-hidden="true" className="text-(--cq-text-tertiary)">
              @
            </span>
            <input
              name="handle"
              defaultValue={query}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="their-handle"
              className="cq-body min-w-0 flex-1 bg-transparent text-(--cq-text-primary) outline-none"
            />
          </span>
        </label>
        <button type="submit" className={buttonClassName("primary")}>
          Find
        </button>
      </form>

      {query.length === 0 ? null : card === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {valid
            ? `No Q Card at @${query}. Check the spelling with them.`
            : "A handle is 3 to 30 lowercase letters, digits or hyphens."}
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-find-result={card.handle}>
          <QCard
            name={card.name}
            descriptor={cardDescriptor(
              card.subjectType,
              publicExternalFields(card.fields),
            )}
            handle={card.handle}
            displayUrl={displayUrlFor(card.handle)}
            href={`/@${card.handle}`}
            qrSvg={qrSvg(`${origin}/@${card.handle}`)}
          />
          <div>
            <Link
              href={`/@${card.handle}`}
              className={buttonClassName("secondary")}
            >
              Open their page
            </Link>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
