import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { GmailConnection } from "@/features/integrations/gmail-connection";
import { QMotionToggle } from "@/features/q-aperture";
import { VoiceSetting } from "@/features/settings/voice-setting";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (R28): how Capital Q looks and how Q behaves on this device.
 *
 * Every choice here is a per-device preference the browser keeps (theme,
 * Q motion, Q's voice); nothing is fetched to render the page, so it opens
 * at once. Connected accounts (BIZ-007: Gmail) read their own status after
 * the page opens. Notifications (reminders, Q's notices) need no setting,
 * and the page offers no switch that does nothing.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const google = (await searchParams)["google"];
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
              <QMotionToggle />
            </SettingRow>
          </dl>
        </PageSection>

        <PageSection id="voice" title="Q's voice">
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Voice">
              <VoiceSetting />
            </SettingRow>
          </dl>
        </PageSection>

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
