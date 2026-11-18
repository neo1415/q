import Link from "next/link";

import type {
  AdminSitePageSummaryDto,
  SitePageKind,
} from "@capital-q/contracts";

/**
 * Every page the content editor holds (decision 107), grouped as a visitor
 * meets them: the landing page's sections in order, then pricing, the FAQ
 * and the legal pages. Each row says plainly whether it is live, waiting
 * for a lawyer, or has changes not yet published.
 */

const GROUPS: readonly {
  readonly kind: SitePageKind;
  readonly title: string;
  readonly note: string;
}[] = [
  {
    kind: "landing-section",
    title: "Home page",
    note: "Sections of the landing page, in the order they appear.",
  },
  { kind: "pricing", title: "Pricing", note: "Plans, prices and perks." },
  { kind: "faq", title: "FAQ", note: "Questions people ask, with answers." },
  {
    kind: "legal",
    title: "Legal",
    note: "Live only after you confirm a lawyer approved the text.",
  },
];

function statusOf(page: AdminSitePageSummaryDto): {
  label: string;
  tone: "live" | "review" | "draft";
} {
  if (page.status === "PUBLISHED") {
    return page.unpublishedChanges
      ? { label: "Live, with draft changes", tone: "live" }
      : { label: "Live", tone: "live" };
  }
  if (page.status === "DRAFT_PENDING_LEGAL_REVIEW") {
    return { label: "Waiting for legal review", tone: "review" };
  }
  return {
    label: page.status === "UNPUBLISHED" ? "Taken down" : "Draft",
    tone: "draft",
  };
}

export function ContentIndex({
  pages,
  hrefOf = (slug) => `/admin/content/${slug}`,
}: {
  readonly pages: readonly AdminSitePageSummaryDto[];
  readonly hrefOf?: (slug: string) => string;
}) {
  return (
    <div className="flex flex-col gap-10">
      {GROUPS.map((group) => {
        const rows = pages.filter((page) => page.kind === group.kind);
        if (rows.length === 0) return null;
        return (
          <section
            key={group.kind}
            aria-labelledby={`cms-${group.kind}`}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id={`cms-${group.kind}`}
                className="cq-title-sm text-(--cq-text-primary)"
              >
                {group.title}
              </h2>
              <p className="cq-caption text-(--cq-text-tertiary)">
                {group.note}
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle) overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)">
              {rows.map((page) => {
                const status = statusOf(page);
                return (
                  <li key={page.slug}>
                    <Link
                      href={hrefOf(page.slug)}
                      data-page={page.slug}
                      className="group flex min-h-16 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                          {page.title}
                        </span>
                        <span className="cq-caption truncate text-(--cq-text-tertiary)">
                          {page.summary === "" ? page.slug : page.summary}
                        </span>
                      </span>
                      {page.lawyerNotes > 0 ? (
                        <span className="cq-caption text-(--cq-text-secondary)">
                          {page.lawyerNotes === 1
                            ? "1 lawyer note"
                            : `${String(page.lawyerNotes)} lawyer notes`}
                        </span>
                      ) : null}
                      <span className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-secondary)">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${
                            status.tone === "live"
                              ? "bg-(--cq-positive)"
                              : status.tone === "review"
                                ? "bg-(--cq-warning)"
                                : "bg-(--cq-text-tertiary)"
                          }`}
                        />
                        {status.label}
                        {page.publishedVersion === null
                          ? ""
                          : `, version ${String(page.publishedVersion)}`}
                      </span>
                      <span
                        aria-hidden="true"
                        className="text-(--cq-text-tertiary) transition-transform duration-(--cq-motion-fast) group-hover:translate-x-0.5"
                      >
                        ›
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
