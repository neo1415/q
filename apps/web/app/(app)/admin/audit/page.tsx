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
import { serverT } from "@/features/i18n/server";

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
  const t = await serverT();

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
      title={t("Audit")}
      description={t(
        "Who acted, under whose authority, on what. Q always acts under a person's authority; admin actions show the role held.",
      )}
    >
      <div className="flex flex-col gap-4">
        <form
          method="get"
          action="/admin/audit"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              {t("Source")}
            </span>
            <select
              name="source"
              defaultValue={params["source"] ?? ""}
              className={control}
            >
              <option value="">{t("All")}</option>
              <option value="TENANT">{t("People and Q")}</option>
              <option value="PLATFORM">{t("Admin console")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              {t("Action starts with")}
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
              {t("Resource id")}
            </span>
            <input
              name="resourceId"
              defaultValue={params["resourceId"] ?? ""}
              className={control}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              {t("Outcome")}
            </span>
            <select
              name="outcome"
              defaultValue={params["outcome"] ?? ""}
              className={control}
            >
              <option value="">{t("Any")}</option>
              <option value="SUCCEEDED">{t("Succeeded")}</option>
              <option value="FAILED">{t("Failed")}</option>
              <option value="DENIED">{t("Denied")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              {t("From")}
            </span>
            <input
              type="date"
              name="from"
              defaultValue={params["from"] ?? ""}
              className={control}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="cq-caption text-(--cq-text-secondary)">
              {t("Before")}
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
              {t("Filter")}
            </button>
            <a
              href={`/admin/audit/audit.csv?${query.toString()}`}
              className={buttonClassName("quiet")}
              download
            >
              {t("Download CSV")}
            </a>
          </div>
        </form>
        {page === null ? (
          <ErrorState
            title={t("The audit log couldn't load")}
            description={t("Check the filters and try again.")}
          />
        ) : page.rows.length === 0 ? (
          <EmptyState
            compact
            title={t("No entries")}
            description={t("Nothing matches these filters.")}
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {page.rows.map((row, index) => (
              <li
                key={`${row.at}-${row.resourceId}-${String(index)}`}
                className="flex flex-col gap-0.5 py-3"
              >
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {t(words(row.actionType))} · {t(words(row.outcome))}
                  {row.breakGlass ? " · Break-glass" : ""}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {t(ACTOR_WORDS[row.actorType] ?? words(row.actorType))}
                  {row.actorName === null ? "" : t(` ${row.actorName}`)}
                  {row.actorRole === null
                    ? ""
                    : t(` (${ROLE_WORDS[row.actorRole] ?? row.actorRole})`)}
                  {row.authorityName !== null && row.actorType === "q"
                    ? t(` for ${row.authorityName}`)
                    : ""}{" "}
                  · {t(words(row.resourceType))} {row.resourceId} ·{" "}
                  {t(when(row.at))}
                </span>
                {row.reason === null ? null : (
                  <span className="cq-caption text-(--cq-text-primary)">
                    &ldquo;{t(row.reason)}&rdquo;
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
            {t("Older entries")}
          </Link>
        )}
      </div>
    </PageSection>
  );
}
