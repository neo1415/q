import { redirect } from "next/navigation";

import { crmTarget } from "@/features/relationships/hub-view";

/**
 * `/crm` (owner directive 2026-10-15 §D): the CRM's own address, an alias.
 * The workspace stays on its established routes (`/relationships` for the
 * Hub and its records, `/results` for Reports), so every existing deep
 * link, Q route and download keeps working; this only forwards to them.
 */
export default async function CrmPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
} = {}) {
  redirect(crmTarget((await searchParams) ?? {}));
}
