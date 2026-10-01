import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { searchAdminOrganisations } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { SearchForm } from "@/features/admin/search-form";
import { words } from "@/features/admin/words";

export const metadata: Metadata = { title: "Organisations · Admin" };

export default async function AdminOrganisationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly q?: string | undefined }>;
}) {
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
      title="Organisations"
      description="Companies, investment firms and other organisations on Capital Q."
    >
      <div className="flex flex-col gap-4">
        <SearchForm
          action="/admin/organisations"
          value={q}
          label="Search organisations"
          placeholder="Organisation name"
        />
        {rows === null ? (
          <ErrorState
            title="Organisations couldn't load"
            description="Try again in a moment."
          />
        ) : q.length < 2 ? (
          <EmptyState
            compact
            title="Search for an organisation"
            description="Type at least 2 characters."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            title="No organisations match"
            description={`Nothing found for "${q}".`}
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
                    {words(row.type)} · {row.country ?? "Country not stated"} ·{" "}
                    {row.members} active members
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
