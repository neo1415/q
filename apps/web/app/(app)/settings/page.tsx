import type { Metadata } from "next";

import {
  getMyEtiquetteGuide,
  getMyPlan,
  getQDailyPreferences,
} from "@capital-q/api-client";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionUser } from "@/auth/session";
import { adminContext } from "@/features/admin/admin-context";
import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { SignOutButton } from "@/features/auth";
import { GmailConnection } from "@/features/integrations/gmail-connection";
import { QEmailAddress } from "@/features/integrations/q-email-address";
import { QMotionToggle } from "@/features/q-aperture";
import { SoundSetting } from "@/features/q-sound/sound-setting";
import { DailySetting } from "@/features/daily/daily-setting";
import { MyGuide } from "@/features/etiquette/my-guide";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
  resolveQStanding,
} from "@/features/q/context";
import { PersonalitySetting } from "@/features/settings/personality-setting";
import {
  RowLink,
  SettingRow,
  SettingsCard,
  SettingsIndex,
} from "@/features/settings/settings-ui";
import {
  ListeningSetting,
  VoiceSetting,
} from "@/features/settings/voice-setting";
import { PushSetting } from "@/features/work/push-setting";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "q", label: "Q" },
  { id: "speaking", label: "How Q speaks for you" },
  { id: "notifications", label: "Notifications" },
  { id: "connections", label: "Connections" },
  { id: "billing", label: "Plan and billing" },
  { id: "privacy", label: "Privacy" },
] as const;

/**
 * Settings (R28; P5 redesign): one card per group, an index beside them.
 *
 * Per-device choices (theme, Q motion, Q's voice, listening sounds) are kept
 * by the browser; Q's personality, The Q Daily and the plan are kept by
 * Capital Q and read in parallel as the page renders. Connections (BIZ-007:
 * Google) read their own status after the page opens. Notifications (AUTO):
 * a push on this device and email for what needs them; in-app notices
 * always show. Every control here does something; none is decoration.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const google = params["google"];
  // Who Q is with them is kept by Capital Q, so it follows them to every
  // device (founder direction 2026-09-30).
  const [session, billingSession] = await Promise.all([
    qApiSession(),
    apiSession(),
  ]);
  const [standing, daily, user, context, plan, admin, speaking] =
    await Promise.all([
      resolveQStanding(),
      // DAILY: how The Q Daily comes; null when the Q API could not be asked.
      session === null
        ? Promise.resolve(null)
        : getQDailyPreferences(session).catch(() => null),
      getSessionUser(),
      resolveOwnContext(),
      billingSession === null
        ? Promise.resolve(null)
        : getMyPlan(billingSession).catch(() => null),
      adminContext().catch(() => null),
      // ADR 0050: their own guide to how Q speaks for them.
      billingSession === null
        ? Promise.resolve(null)
        : getMyEtiquetteGuide(billingSession).catch(() => null),
    ]);
  const organisation =
    context.kind === "NONE"
      ? null
      : {
          name: context.label,
          role: context.kind === "FOUNDER" ? "Founder" : "Investor",
        };
  const canBrand = admin?.can("flags.write") === true;
  return (
    <PageContainer>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsIndex sections={SECTIONS} />
        <div className="flex max-w-(--cq-layout-reading) min-w-0 flex-col gap-4">
          <SettingsCard id="account" title="Account">
            <SettingRow term="Profile" hint="What investors and founders see">
              <RowLink href="/profile">Edit profile</RowLink>
            </SettingRow>
            <SettingRow
              term="Organisation"
              hint={
                organisation === null
                  ? "Set up when Q onboards you"
                  : `You are here as ${organisation.role.toLowerCase()}`
              }
            >
              <span className="cq-body-sm text-(--cq-text-secondary)">
                {organisation?.name ?? "Not set yet"}
              </span>
            </SettingRow>
            <SettingRow term="Email">
              <span className="cq-body-sm break-all text-(--cq-text-secondary)">
                {user?.email ?? "Not available"}
              </span>
            </SettingRow>
            <SettingRow term="Password">
              <RowLink href="/auth/update-password">Change</RowLink>
            </SettingRow>
            <SettingRow term="This device" hint="Ends your session here">
              <SignOutButton />
            </SettingRow>
          </SettingsCard>

          <SettingsCard
            id="appearance"
            title="Appearance"
            description="How Capital Q looks on this device."
          >
            <SettingRow term="Theme">
              <ThemeToggle />
            </SettingRow>
            <SettingRow term="Q motion" hint="How much Q's light moves">
              <QMotionToggle size="touch" />
            </SettingRow>
            <SettingRow term="Sounds" hint="Q's small sounds on this device">
              <SoundSetting />
            </SettingRow>
            {canBrand ? (
              <SettingRow
                term="Brand"
                hint="Black and gold or blue, for everyone · admins only"
              >
                <RowLink href="/admin/brand">Customise</RowLink>
              </SettingRow>
            ) : null}
            {canBrand ? (
              <SettingRow
                term="How Q conducts business"
                hint="The house guide for everyone · admins only"
              >
                <RowLink href="/admin/etiquette">Open</RowLink>
              </SettingRow>
            ) : null}
          </SettingsCard>

          <SettingsCard
            id="q"
            title="Q"
            description="How Q sounds and works with you."
          >
            <SettingRow term="Voice">
              <VoiceSetting />
            </SettingRow>
            <SettingRow term="Listening sounds">
              <ListeningSetting />
            </SettingRow>
            <SettingRow term="Personality">
              <PersonalitySetting initial={standing?.personality ?? "AUTO"} />
            </SettingRow>
            <SettingRow term="The Q Daily" hint="Your morning newspaper">
              {daily === null ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  These choices couldn&apos;t load. Reload in a moment.
                </p>
              ) : (
                <DailySetting initial={daily} />
              )}
            </SettingRow>
            <SettingRow
              term="Outreach and stand-in"
              hint="What Q may do on your behalf"
            >
              <RowLink href="/work">Open</RowLink>
            </SettingRow>
          </SettingsCard>

          {/* ETIQUETTE block (ADR 0050) */}
          <SettingsCard
            id="speaking"
            title="How Q speaks for you"
            description="Your guide to how Q writes and talks to investors and founders for you."
          >
            {speaking === null ? (
              <SettingRow term="Your guide">
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  Your guide couldn&apos;t load. Reload in a moment.
                </p>
              </SettingRow>
            ) : (
              <MyGuide initial={speaking} />
            )}
          </SettingsCard>

          <SettingsCard
            id="notifications"
            title="Notifications"
            description="In-app notices always show."
          >
            <div className="px-5 py-4">
              <PushSetting />
            </div>
          </SettingsCard>

          {/* meetfix-57: "Settings → Connections", where Q's reconnect link lands. */}
          <SettingsCard id="connections" title="Connections">
            <SettingRow term="Google" hint="Gmail, Calendar and Meet">
              <GmailConnection
                outcome={typeof google === "string" ? google : undefined}
                reconnect={params["reconnect"] === "google"}
              />
            </SettingRow>
            <SettingRow term="Your Q email address">
              <QEmailAddress />
            </SettingRow>
          </SettingsCard>

          {/* BILLING block (ADR 0034) */}
          <SettingsCard id="billing" title="Plan and billing">
            <SettingRow
              term="Plan"
              hint={
                plan === null
                  ? "Open Billing to see your plan"
                  : plan.source === "LAUNCH_DEFAULT"
                    ? `${plan.plan.name} · free while Capital Q launches`
                    : plan.plan.name
              }
            >
              <RowLink href="/settings/billing">Billing</RowLink>
            </SettingRow>
            <SettingRow term="Allowances" hint="What your plan includes">
              <RowLink href="/settings/plan">Open</RowLink>
            </SettingRow>
            <SettingRow term="Usage" hint="What Q used for you this month">
              <RowLink href="/settings/usage">Usage</RowLink>
            </SettingRow>
          </SettingsCard>
          {/* end BILLING block */}

          <SettingsCard id="privacy" title="Privacy">
            <SettingRow
              term="What Q remembers"
              hint="See, correct or forget it"
            >
              <RowLink href="/settings/memory">Review</RowLink>
            </SettingRow>
          </SettingsCard>
        </div>
      </div>
    </PageContainer>
  );
}
