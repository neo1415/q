import { redirect } from "next/navigation";

import { capitalTarget } from "@/features/relationships/hub-view";

/**
 * `/capital` (owner 2026-10-16: "the stuff in Capital would be like a tab
 * in CRM"): Capital is the CRM's Capital tab now. This address forwards
 * there with its tab, round and plan horizon kept, so every saved link,
 * Q round card and spoken "open Capital" still lands on the same content.
 */
export default async function CapitalPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
} = {}) {
  redirect(capitalTarget((await searchParams) ?? {}));
}
