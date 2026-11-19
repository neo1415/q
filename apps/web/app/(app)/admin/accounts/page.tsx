import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAdminAccounts } from "@capital-q/api-client";
import type { AdminAccountRowDto } from "@capital-q/contracts";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import {
  AdminDataTable,
  viewFrom,
  type AdminTableColumn,
} from "@/features/admin/data-table";
import { when } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Accounts · Admin") };
}

const columns = (
  t: (english: string) => string,
): readonly AdminTableColumn<AdminAccountRowDto>[] => [
  {
    id: "name",
    label: "Name",
    sort: { asc: "name_asc", desc: "name_desc" },
    cell: (row) => row.name ?? t("Unnamed member"),
  },
  { id: "email", label: "Email", cell: (row) => row.email ?? "—" },
  {
    id: "organisations",
    label: "Organisations",
    cell: (row) =>
      row.organisations.length === 0 ? "—" : row.organisations.join(", "),
  },
  {
    id: "status",
    label: "Status",
    cell: (row) => (row.suspended ? t("Suspended") : t("Active")),
  },
  {
    id: "joined",
    label: "Joined",
    sort: { asc: "oldest", desc: "newest" },
    cell: (row) => when(row.createdAt),
  },
];

/**
 * Accounts (admin design 2026-11-19 §4 T2): every person on Capital Q,
 * newest first, on open; the search narrows the list. The API decides who
 * may read it (accounts.read); anyone else gets this route's 404.
 */
export default async function AdminAccountsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  const context = await adminContext();
  if (context === null || !context.can("accounts.read")) notFound();
  const view = viewFrom(await searchParams);
  const page = await listAdminAccounts(context.session, {
    ...(view.q.length > 0 ? { q: view.q } : {}),
    sort: view.sort,
    ...(view.cursor === undefined ? {} : { cursor: view.cursor }),
    limit: 25,
  }).catch(() => null);
  return (
    <PageSection
      id="accounts"
      title={t("Accounts")}
      description={t(
        "Every person on Capital Q. Search by name, email or handle. Private chats are never shown here.",
      )}
    >
      <AdminDataTable
        title="Accounts"
        noun="accounts"
        basePath="/admin/accounts"
        csvPath="/admin/accounts.csv"
        columns={columns(t)}
        rows={page?.rows ?? null}
        rowKey={(row) => row.userId}
        rowHref={(row) => `/admin/accounts/${row.userId}`}
        primary={(row) =>
          `${row.name ?? t("Unnamed member")}${row.suspended ? t(" · Suspended") : ""}`
        }
        secondary={(row) =>
          [row.email, `joined ${when(row.createdAt)}`]
            .filter((part) => part !== null && part !== "")
            .join(" · ")
        }
        view={view}
        total={page?.total ?? null}
        nextCursor={page?.nextCursor ?? null}
        searchLabel="Search accounts"
        placeholder="Name, email or handle"
      />
    </PageSection>
  );
}
