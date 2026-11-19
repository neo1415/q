import type { Metadata } from "next";

import { ActivitySection } from "@/features/organisation/activity-section";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

/**
 * Settings → Activity: who did what for the person's active organisation,
 * for its admins and owners. Also Organisation → Activity log; both render
 * the same screen and reads.
 */
export default async function ActivityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ActivitySection params={await searchParams} />;
}
