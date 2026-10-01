import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { searchAdminAccounts } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { SearchForm } from "@/features/admin/search-form";
import { when } from "@/features/admin/words";

export const metadata: Metadata = { title: "Accounts · Admin" };

export default async function AdminAccountsPage({
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
      : await searchAdminAccounts(context.session, q)
          .then((result) => result.rows)
          .catch(() => null);
  return (
    <PageSection
      id="accounts"
      title="Accounts"
      description="Search by name, email or handle. Private chats are never shown here."
    >
      <div className="flex flex-col gap-4">
        <SearchForm
          action="/admin/accounts"
          value={q}
          label="Search accounts"
          placeholder="Name, email or handle"
        />
        {rows === null ? (
          <ErrorState
            title="Accounts couldn't load"
            description="Try again in a moment."
          />
        ) : q.length < 2 ? (
          <EmptyState
            compact
            title="Search for an account"
            description="Type at least 2 characters."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            title="No accounts match"
            description={`Nothing found for "${q}".`}
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {rows.map((row) => (
              <li key={row.userId}>
                <Link
                  href={`/admin/accounts/${row.userId}`}
                  className="flex min-h-11 flex-col gap-0.5 py-3 hover:bg-(--cq-surface-subtle)"
                >
                  <span className="cq-body text-(--cq-text-primary)">
                    {row.name ?? "Unnamed member"}
                    {row.suspended ? " · Suspended" : ""}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {[
                      row.email,
                      row.organisations.join(", "),
                      `joined ${when(row.createdAt)}`,
                    ]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
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
