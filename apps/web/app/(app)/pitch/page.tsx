import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { PitchUpload } from "@/features/pitch/pitch-upload";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Your pitch" };

export const dynamic = "force-dynamic";

/**
 * The founder's pitch (CQ-WEB-023; doc 17 §35).
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
        title="Your pitch"
        description="A short video investors watch before they read anything else. Portrait, under three minutes, in your own words."
      />
      {context.kind === "FOUNDER" ? (
        <PitchUpload companyId={context.companyId} />
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
