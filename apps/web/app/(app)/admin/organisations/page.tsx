import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { searchAdminOrganisations } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { SearchForm } from "@/features/admin/search-form";
import { words } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Organisations · Admin" };

export default async function AdminOrganisationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly q?: string | undefined }>;
}) {
  const t = await serverT();

  const context = await adminContext();
  if (context === null || !context.can("accounts.read")) notFound();
  const q = ((await searchParams).q ?? "").trim();
  const rows =
    q.length < 2
      ? []
      : await searchAdminOrganisations(context.session, q)
          .then((result) => result.rows)
          .catch(() => null);
  return (
    <PageSection
      id="organisations"
      title={t("Organisations")}
      description={t(
        "Companies, investment firms and other organisations on Capital Q.",
      )}
    >
      <div className="flex flex-col gap-4">
        <SearchForm
          action="/admin/organisations"
          value={q}
          label={t("Search organisations")}
          placeholder={t("Organisation name")}
        />
        {rows === null ? (
          <ErrorState
            title={t("Organisations couldn't load")}
            description={t("Try again in a moment.")}
          />
        ) : q.length < 2 ? (
          <EmptyState
            compact
            title={t("Search for an organisation")}
            description={t("Type at least 2 characters.")}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            title={t("No organisations match")}
            description={t(`Nothing found for "${q}".`)}
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {rows.map((row) => (
              <li key={row.organisationId}>
                <Link
                  href={`/admin/organisations/${row.organisationId}`}
                  className="flex min-h-11 flex-col gap-0.5 py-3 hover:bg-(--cq-surface-subtle)"
                >
                  <span className="cq-body text-(--cq-text-primary)">
                    {row.name}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {t(words(row.type))} ·{" "}
                    {row.country ?? t("Country not stated")} · {row.members}{" "}
                    {t("active members")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageSection>
  );
}
