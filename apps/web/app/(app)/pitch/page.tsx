import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { PitchGrid } from "@/features/pitch/pitch-grid";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Pitch & media" };

export const dynamic = "force-dynamic";

/**
 * Pitch & media (CQ-WEB-023, VID; ADR 0022): every live video the
 * founder's company has, as a grid, each opening its own page to publish,
 * name, choose who may watch, replace, preview or delete it.
 *
 * The person's own company is resolved on the server from their founder
 * journey; the screen then reads and changes the pitch through the API
 * under their session. Anyone without a company sees the way to start
 * one, not an upload control: there is nothing an upload could belong to.
 */
export default async function PitchPage() {
  const context = await resolveOwnContext();
  return (
    <PageContainer>
      <PageHeader
        title="Pitch & media"
        description="Portrait, under three minutes."
      />
      {context.kind === "FOUNDER" ? (
        <PitchGrid companyId={context.companyId} />
      ) : context.kind === "NONE" && context.unavailable === true ? (
        // Not known to have no company: Capital Q did not answer.
        <EmptyState
          title="Your pitch couldn't load."
          description="Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link href="/pitch" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      ) : context.kind === "INVESTOR" ? (
        // An investor has no pitch to make; they watch them (R30 #16).
        <EmptyState
          title="Pitches are made by founders."
          description="As an investor you watch them: every discoverable company's pitch plays in Discover."
          action={
            <Link href="/discover" className={buttonClassName("secondary")}>
              Go to Discover
            </Link>
          }
        />
      ) : (
        <EmptyState
          title="A pitch belongs to a company."
          description="Set up your company with Q first; the pitch comes after, once there is something for investors to see."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Get set up
            </Link>
          }
        />
      )}
    </PageContainer>
  );
}
