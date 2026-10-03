import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { getQDailyPreferences } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { GmailConnection } from "@/features/integrations/gmail-connection";
import { QEmailAddress } from "@/features/integrations/q-email-address";
import { QMotionToggle } from "@/features/q-aperture";
import { DailySetting } from "@/features/daily/daily-setting";
import { qApiSession, resolveQStanding } from "@/features/q/context";
import { PersonalitySetting } from "@/features/settings/personality-setting";
import { VoiceSetting } from "@/features/settings/voice-setting";
import { PushSetting } from "@/features/work/push-setting";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (R28): how Capital Q looks and how Q behaves on this device.
 *
 * Every choice here is a per-device preference the browser keeps (theme,
 * Q motion, Q's voice). Connected accounts (BIZ-007: Gmail) read their own status after
 * the page opens; Q's personality and The Q Daily are kept by Capital Q
 * and read in parallel as the page renders. Notifications (AUTO): a push on this device and email
 * for what needs them; in-app notices always show. The page offers no
 * switch that does nothing.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const google = (await searchParams)["google"];
  // Who Q is with them is kept by Capital Q, so it follows them to every
  // device (founder direction 2026-09-30).
  const session = await qApiSession();
  const [standing, daily] = await Promise.all([
    resolveQStanding(),
    // DAILY: how The Q Daily comes; null when the Q API could not be asked.
    session === null
      ? Promise.resolve(null)
      : getQDailyPreferences(session).catch(() => null),
  ]);
  return (
    <PageContainer width="reading">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-10">
        <PageSection id="appearance" title="Appearance">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Theme">
              <ThemeToggle />
            </SettingRow>
            <SettingRow term="Q motion">
              <QMotionToggle size="touch" />
            </SettingRow>
          </dl>
        </PageSection>

        <PageSection id="voice" title="Q's voice">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Voice">
              <VoiceSetting />
            </SettingRow>
            <SettingRow term="Personality">
              <PersonalitySetting initial={standing?.personality ?? "AUTO"} />
            </SettingRow>
          </dl>
        </PageSection>

        <PageSection id="notifications" title="Notifications">
          <PushSetting />
        </PageSection>

        <PageSection id="q-work" title="Q's work">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Outreach and stand-in">
              <Link
                href="/work"
                className={buttonClassName("secondary", "compact")}
              >
                Open
              </Link>
            </SettingRow>
          </dl>
        </PageSection>

        <PageSection id="q-daily" title="The Q Daily">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Your newspaper">
              {daily === null ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  These choices couldn&apos;t load. Reload in a moment.
                </p>
              ) : (
                <DailySetting initial={daily} />
              )}
            </SettingRow>
          </dl>
        </PageSection>
        {/* BILLING block (ADR 0034) */}
        <PageSection id="plan" title="Plan">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Your plan and usage">
              <Link
                href="/settings/plan"
                className={buttonClassName("secondary", "compact")}
              >
                Open
              </Link>
            </SettingRow>
            <SettingRow term="What Q used for you">
              <Link
                href="/settings/usage"
                className={buttonClassName("secondary", "compact")}
              >
                Usage
              </Link>
            </SettingRow>
          </dl>
        </PageSection>
        {/* end BILLING block */}

        <PageSection id="memory" title="Q's memory">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="What Q remembers">
              <Link
                href="/settings/memory"
                className={buttonClassName("secondary", "compact")}
              >
                Review
              </Link>
            </SettingRow>
          </dl>
        </PageSection>

        <PageSection id="connected-accounts" title="Connected accounts">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Gmail">
              <GmailConnection
                outcome={typeof google === "string" ? google : undefined}
              />
            </SettingRow>
            <SettingRow term="Your Q email address">
              <QEmailAddress />
            </SettingRow>
          </dl>
        </PageSection>
      </div>
    </PageContainer>
  );
}

function SettingRow({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40">
        {term}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
