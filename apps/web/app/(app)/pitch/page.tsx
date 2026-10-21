import type { Metadata } from "next";
import Link from "next/link";

import { getCompanyProfile } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, InlineNotice } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { listPitchMediaAction } from "@/features/pitch/pitch-actions";
import { PitchMain } from "@/features/pitch/pitch-main";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";
import { WorkHeader, workSideOf } from "@/features/work/work-header";

export const metadata: Metadata = { title: "Pitch & media" };

export const dynamic = "force-dynamic";

/**
 * Pitch & media (CQ-WEB-023, VID; ADR 0022; chosen design 2026-10-21,
 * "Main pitch with chapters"): the company's main pitch with its chapters
 * from Q's reading of the transcript, who can watch it, the other videos,
 * and what Q heard, for the founder to confirm. Each video still opens its
 * own page to replace, preview or delete it.
 *
 * The person's own company is resolved on the server from their founder
 * journey; the screen then reads and changes the pitch through the API
 * under their session. Anyone without a company sees the way to start
 * one, not an upload control: there is nothing an upload could belong to.
 */
async function FounderPitch({ companyId }: { readonly companyId: string }) {
  const t = await serverT();
  const session = await apiSession();
  const [videos, profile] = await Promise.all([
    listPitchMediaAction(companyId),
    session === null
      ? Promise.resolve(null)
      : getCompanyProfile(session, companyId).catch(() => null),
  ]);
  if (!videos.ok) {
    return (
      <InlineNotice tone="warning" title={t("Your videos couldn't load")}>
        {t(videos.message)}
      </InlineNotice>
    );
  }
  return (
    <PitchMain
      companyId={companyId}
      companyName={profile?.canonicalName ?? null}
      videos={videos.value}
      sections={
        profile === null ? null : (profile.overview?.pitchSections ?? [])
      }
    />
  );
}

export default async function PitchPage() {
  const t = await serverT();
  const context = await resolveOwnContext();
  return (
    <PageContainer>
      <QSection
        id="pitch"
        kind="PITCH"
        refs={
          context.kind === "FOUNDER"
            ? [{ kind: "COMPANY", id: context.companyId }]
            : []
        }
        label={t("your pitch and media")}
      >
        <WorkHeader view="pitch" side={workSideOf(context)} />
        {context.kind === "FOUNDER" ? (
          <FounderPitch companyId={context.companyId} />
        ) : context.kind === "NONE" && context.unavailable === true ? (
          // Not known to have no company: Capital Q did not answer.
          <EmptyState
            title={t("Your pitch couldn't load.")}
            description={t(
              "Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment.",
            )}
            action={
              <Link href="/pitch" className={buttonClassName("secondary")}>
                {t("Try again")}
              </Link>
            }
          />
        ) : context.kind === "INVESTOR" ? (
          // An investor has no pitch to make; they watch them (R30 #16).
          <EmptyState
            title={t("Pitches are made by founders.")}
            description={t(
              "As an investor you watch them: every discoverable company's pitch plays in Discover.",
            )}
            action={
              <Link href="/discover" className={buttonClassName("secondary")}>
                {t("Go to Discover")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t("A pitch belongs to a company.")}
            description={t(
              "Set up your company with Q first; the pitch comes after, once there is something for investors to see.",
            )}
            action={
              <Link href="/home" className={buttonClassName("secondary")}>
                {t("Get set up")}
              </Link>
            }
          />
        )}
      </QSection>
    </PageContainer>
  );
}
