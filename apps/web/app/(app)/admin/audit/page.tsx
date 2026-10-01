import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { searchAdminAudit } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { fieldControlClassName } from "@capital-q/ui/input";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { auditFiltersFrom } from "@/features/admin/audit-filters";
import { ROLE_WORDS, when, words } from "@/features/admin/words";

export const metadata: Metadata = { title: "Audit · Admin" };

const ACTOR_WORDS: Readonly<Record<string, string>> = {
  human: "Person",
  q: "Q",
  capital_q_system: "Capital Q",
  connected_system: "Connected system",
  platform_admin: "Admin",
};

const control = `${fieldControlClassName} h-11 cq-body-sm lg:h-10`;

export default async function AdminAuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await adminContext();
  if (context === null || !context.can("audit.read")) notFound();
  const params = await searchParams;
  const filters = auditFiltersFrom(params);
  const cursor = params["cursor"];
  const page = await searchAdminAudit(context.session, {
    ...filters,
    ...(cursor === undefined ? {} : { cursor }),
    limit: 50,
  }).catch(() => null);
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "cursor" && entry[1] !== undefined && entry[1] !== "",
    ),
  );
  const next = page?.nextCursor ?? null;
  return (
    <PageSection
      id="audit"
      title="Audit"
      description="Who acted, under whose authority, on what. Q always acts under a person's authority; admin actions show the role held."
    >
      <div className="flex flex-col gap-4">
        <form
          method="get"
          action="/admin/audit"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              Source
            </span>
            <select
              name="source"
              defaultValue={params["source"] ?? ""}
              className={control}
            >
              <option value="">All</option>
              <option value="TENANT">People and Q</option>
              <option value="PLATFORM">Admin console</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              Action starts with
            </span>
            <input
              name="action"
              defaultValue={params["action"] ?? ""}
              placeholder="e.g. account."
              className={control}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              Resource id
            </span>
            <input
              name="resourceId"
              defaultValue={params["resourceId"] ?? ""}
              className={control}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              Outcome
            </span>
            <select
              name="outcome"
              defaultValue={params["outcome"] ?? ""}
              className={control}
            >
              <option value="">Any</option>
              <option value="SUCCEEDED">Succeeded</option>
              <option value="FAILED">Failed</option>
              <option value="DENIED">Denied</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">From</span>
            <input
              type="date"
              name="from"
              defaultValue={params["from"] ?? ""}
              className={control}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              Before
            </span>
            <input
              type="date"
              name="to"
              defaultValue={params["to"] ?? ""}
              className={control}
            />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className={buttonClassName("secondary")}>
              Filter
            </button>
            <a
              href={`/admin/audit/audit.csv?${query.toString()}`}
              className={buttonClassName("quiet")}
              download
            >
              Download CSV
            </a>
          </div>
        </form>
        {page === null ? (
          <ErrorState
            title="The audit log couldn't load"
            description="Check the filters and try again."
          />
        ) : page.rows.length === 0 ? (
          <EmptyState
            compact
            title="No entries"
            description="Nothing matches these filters."
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {page.rows.map((row, index) => (
              <li
                key={`${row.at}-${row.resourceId}-${String(index)}`}
                className="flex flex-col gap-0.5 py-3"
              >
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {words(row.actionType)} · {words(row.outcome)}
                  {row.breakGlass ? " · Break-glass" : ""}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {ACTOR_WORDS[row.actorType] ?? words(row.actorType)}
                  {row.actorName === null ? "" : ` ${row.actorName}`}
                  {row.actorRole === null
                    ? ""
                    : ` (${ROLE_WORDS[row.actorRole] ?? row.actorRole})`}
                  {row.authorityName !== null && row.actorType === "q"
                    ? ` for ${row.authorityName}`
                    : ""}{" "}
                  · {words(row.resourceType)} {row.resourceId} · {when(row.at)}
                </span>
                {row.reason === null ? null : (
                  <span className="cq-caption text-(--cq-text-primary)">
                    &ldquo;{row.reason}&rdquo;
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {next === null ? null : (
          <Link
            href={`/admin/audit?${new URLSearchParams([...query.entries(), ["cursor", next]]).toString()}`}
            className={`${buttonClassName("secondary")} self-start`}
          >
            Older entries
          </Link>
        )}
      </div>
    </PageSection>
  );
}
