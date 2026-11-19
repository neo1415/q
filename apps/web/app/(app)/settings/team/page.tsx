import type { Metadata } from "next";

import { TeamSection } from "@/features/team/team-section";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

/**
 * Settings → Team (G1/G2; chosen design "Invite first", 2026-10-21). Also
 * Organisation → Members; both render the same screen and reads.
 */
export default function TeamSettingsPage() {
  return <TeamSection />;
}
