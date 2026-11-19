import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAdminOrganisations } from "@capital-q/api-client";
import type { AdminOrganisationRowDto } from "@capital-q/contracts";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import {
  AdminDataTable,
  viewFrom,
  type AdminTableColumn,
} from "@/features/admin/data-table";
import { when, words } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Organisations · Admin") };
}

const columns = (
  t: (english: string) => string,
): readonly AdminTableColumn<AdminOrganisationRowDto>[] => [
  {
    id: "name",
    label: "Name",
    sort: { asc: "name_asc", desc: "name_desc" },
    cell: (row) => row.name,
  },
  { id: "type", label: "Type", cell: (row) => t(words(row.type)) },
  { id: "country", label: "Country", cell: (row) => row.country ?? "—" },
  {
    id: "members",
    label: "Active members",
    numeric: true,
    cell: (row) => String(row.members),
  },
  {
    id: "created",
    label: "Created",
    sort: { asc: "oldest", desc: "newest" },
    cell: (row) => when(row.createdAt),
  },
];

/**
 * Organisations (admin design 2026-11-19 §4 T2): every company and firm,
 * newest first, on open; the search narrows the list. The API decides who
 * may read it (accounts.read); anyone else gets this route's 404.
 */
export default async function AdminOrganisationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  const context = await adminContext();
  if (context === null || !context.can("accounts.read")) notFound();
  const view = viewFrom(await searchParams);
  const page = await listAdminOrganisations(context.session, {
    ...(view.q.length > 0 ? { q: view.q } : {}),
    sort: view.sort,
    ...(view.cursor === undefined ? {} : { cursor: view.cursor }),
    limit: 25,
  }).catch(() => null);
  return (
    <PageSection
      id="organisations"
      title={t("Organisations")}
      description={t(
        "Every company and firm on Capital Q. Search by name, legal name or handle.",
      )}
    >
      <AdminDataTable
        title="Organisations"
        noun="organisations"
        basePath="/admin/organisations"
        csvPath="/admin/organisations.csv"
        columns={columns(t)}
        rows={page?.rows ?? null}
        rowKey={(row) => row.organisationId}
        rowHref={(row) => `/admin/organisations/${row.organisationId}`}
        primary={(row) => row.name}
        secondary={(row) =>
          [
            t(words(row.type)),
            row.country ?? t("Country not stated"),
            `${String(row.members)} ${t("active members")}`,
          ].join(" · ")
        }
        view={view}
        total={page?.total ?? null}
        nextCursor={page?.nextCursor ?? null}
        searchLabel="Search organisations"
        placeholder="Name, legal name or handle"
      />
    </PageSection>
  );
}
