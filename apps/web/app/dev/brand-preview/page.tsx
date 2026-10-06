import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Button } from "@capital-q/ui/button";
import { Chip } from "@capital-q/ui/chip";
import { EmptyState, InlineNotice } from "@capital-q/ui/states";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { composeBrandStyle } from "@/features/brand-theme/brand-compose";
import { brandPreset } from "@/features/brand-theme/brand-presets";
import { BrandStyle } from "@/features/brand-theme/brand-style";
import { HomeScreen } from "@/features/home/home-screen";

export const metadata: Metadata = {
  title: "Brand preview",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The real app shell, Q page and dock under a brand preset, signed out,
 * for the K3 contrast review and screenshots (ADR 0051). Development only.
 *
 * `?preset=black_gold|classic_blue` picks the preset; `?view=q` shows the
 * Q page (the dock hides there, as on /home), `?view=dock` an ordinary
 * page with the dock over it. Light or dark follows the theme switch.
 */
export default async function BrandPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A production build serves it only for a local screenshot run
  // (CQ_DEV_PREVIEW=1 at `next start`); deployed builds never set it.
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const preset = brandPreset(one(params["preset"]));
  const view = one(params["view"]) === "dock" ? "dock" : "q";
  const css = composeBrandStyle({ presetKey: preset.key, primaryHex: null });
  return (
    <AppShell context={{ scope: "unset" }} qConnected={false}>
      <BrandStyle css={css} />
      {view === "q" ? (
        <>
          {/* On /home the dock steps aside for the page; here, by hand. */}
          <style>{"[data-q-dock]{display:none}"}</style>
          <HomeScreen />
        </>
      ) : (
        <PageContainer width="content">
          <PageHeader
            title="Relationships"
            description="Who you are talking to, and what happens next."
          />
          <PageSection
            id="today"
            title="Today"
            description="Two replies waiting and one meeting to confirm."
          >
            <div className="flex flex-col gap-4">
              <InlineNotice tone="info" title="Q drafted two replies">
                Read them before anything is sent.
              </InlineNotice>
              <div className="flex flex-wrap gap-2">
                <Chip>Fintech</Chip>
                <Chip>Seed</Chip>
                <Chip>Lagos</Chip>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Review replies</Button>
                <Button variant="secondary">Open schedule</Button>
              </div>
              <EmptyState
                title="No meetings this week"
                description="Q will suggest times when a conversation is ready."
              />
            </div>
          </PageSection>
        </PageContainer>
      )}
    </AppShell>
  );
}
