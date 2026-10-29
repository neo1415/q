import type { ReactNode } from "react";
import Link from "next/link";

import { ActivitySettingsRow } from "@/features/organisation/activity-settings-row";

import type {
  BillingAccountPlanDto,
  MyEtiquetteGuideDto,
  MyOrganisationDto,
  QDailyPreferences,
  QLanguagePreference,
  QPersonality,
  QPreferenceLearningDto,
} from "@capital-q/contracts";

import { SignOutButton } from "@/features/auth";
import { ProfileImageEditor } from "@/features/profile/profile-image-editor";
import { QControl } from "@/features/q/control/q-control";
import { QSection } from "@/features/q/q-section";
import { teamWords } from "@/features/team/team-words";

import { AccountToastProvider } from "./account-kit";
import { AccountColumn, AccountHead, SRow } from "./account-layout";
import { accountButton } from "./account-styles";
import { PreferenceLearningSwitch } from "./preference-learning";
import {
  DailyRows,
  GoogleRow,
  LanguageButton,
  ListeningChoice,
  MotionChoice,
  NotificationRows,
  PersonalityChoice,
  QEmailRow,
  SoundChoice,
  SpeakingGuide,
  ThemeCards,
  VoiceChoice,
  WakeRow,
} from "./settings-controls";
import { SettingsJumpIndex } from "./settings-index";

const SECTIONS = [
  { id: "profile", label: "Your profile" },
  { id: "account", label: "Account" },
  { id: "security", label: "Security" },
  { id: "team", label: "Team" },
  { id: "appearance", label: "Appearance" },
  { id: "q", label: "Q" },
  { id: "speaking", label: "How Q speaks for you" },
  { id: "notifications", label: "Notifications" },
  { id: "connections", label: "Connections" },
  { id: "billing", label: "Plan and billing" },
  { id: "privacy", label: "Privacy" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const ROLE_WORD = {
  OWNER: "an owner",
  ADMIN: "an admin",
  MEMBER: "a member",
} as const;

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/u)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Settings (R28; chosen design "One page with an index", 2026-10-21):
 * every section on one page, an index beside it that jumps, and each row
 * saying what it does in a sentence. "Your profile" comes first.
 *
 * Per-device choices (theme, Q motion, sounds, Q's voice, listening, wake
 * word) are kept by the browser; what Capital Q keeps is read by the route
 * (app/(app)/settings) and handed in here, or handed in as fixtures by
 * /dev/account-review. Connections read their own status after the page
 * opens. Every control here does something; none is decoration.
 */
export type SettingsViewProps = {
  /** This page in the person's chosen language. */
  readonly t: (english: string) => string;
  readonly email: string | null;
  readonly person: {
    readonly userId: string;
    readonly displayName: string | null;
    readonly headline: string | null;
  } | null;
  readonly avatar: string | null;
  readonly personality: QPersonality;
  readonly language: QLanguagePreference;
  readonly languageName: string | null;
  readonly daily: QDailyPreferences | null;
  readonly plan: BillingAccountPlanDto | null;
  readonly canBrand: boolean;
  readonly speaking: MyEtiquetteGuideDto | null;
  readonly acting: MyOrganisationDto | null;
  readonly learning: QPreferenceLearningDto | null;
  /** Two-step verification, from the Auth server; null when unknown. */
  readonly twoStep?: boolean | null | undefined;
  /** The Google connect round trip's outcome, from the query string. */
  readonly google?: string | undefined;
  readonly reconnect?: boolean | undefined;
  /** Design review only: the photo sheet, open on arrival. */
  readonly review?: { readonly photoSheet?: boolean } | undefined;
};

export function SettingsView({
  t,
  email,
  person,
  avatar,
  personality,
  language,
  languageName,
  daily,
  plan,
  canBrand,
  speaking,
  acting,
  learning,
  twoStep = null,
  google,
  reconnect,
  review,
}: SettingsViewProps) {
  const name = person?.displayName ?? null;
  const words = acting === null ? null : teamWords(acting.kind);

  const group = (id: SectionId, title: string, body: ReactNode) => (
    <QControl key={id} id={`section.${id}`} kind="SECTION">
      <section
        id={id}
        aria-labelledby={`${id}-heading`}
        className="scroll-mt-6"
      >
        <h2
          id={`${id}-heading`}
          className="m-0 mt-[30px] mb-2.5 text-[17px] font-semibold text-(--cq-text-primary)"
        >
          {title}
        </h2>
        <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-1">
          {body}
        </div>
      </section>
    </QControl>
  );

  return (
    <AccountToastProvider>
      <AccountColumn className="max-w-[calc(1080px+4rem)]">
        <QSection id="settings" kind="SETTINGS" label="settings">
          <AccountHead title={t("Settings")} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-7">
            <SettingsJumpIndex
              label={t("Settings sections")}
              sections={SECTIONS.map((section) => ({
                id: section.id,
                label: t(section.label),
              }))}
            />
            <div className="max-w-[820px] min-w-0 [&>*:first-child_h2]:mt-0">
              {group(
                "profile",
                t("Your profile"),
                <div className="flex flex-wrap items-center gap-4 py-3.5 sm:flex-nowrap">
                  <div className="relative shrink-0">
                    <span className="block size-14 overflow-hidden rounded-full border border-(--cq-border) bg-(--cq-surface-subtle)">
                      {avatar === null ? (
                        <span
                          role="img"
                          aria-label={name ?? t("Your photo")}
                          className="grid size-full place-items-center text-lg font-semibold text-(--cq-text-secondary)"
                        >
                          {initials(name ?? email ?? "?")}
                        </span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
                        <img
                          src={avatar}
                          alt={name ?? ""}
                          className="size-full object-cover"
                        />
                      )}
                    </span>
                    {person === null ? null : (
                      <span className="absolute -end-1.5 -bottom-1.5">
                        <ProfileImageEditor
                          subjectType="PERSON"
                          subjectId={person.userId}
                          kind="AVATAR"
                          label="profile photo"
                          hasImage={avatar !== null}
                          previewUrl={avatar}
                          previewName={name ?? email ?? ""}
                          compact
                          initiallyOpen={review?.photoSheet === true}
                        />
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-[58%] flex-1 flex-col gap-0.5 sm:min-w-0">
                    <b className="text-[15px] font-medium text-(--cq-text-primary)">
                      {name ?? t("Your name isn't set yet")}
                    </b>
                    <span className="text-[13px] text-(--cq-text-secondary)">
                      {person?.headline ??
                        t(
                          "What investors and founders see about you, your photo and your words.",
                        )}
                    </span>
                  </div>
                  <Link
                    href="/profile"
                    className={accountButton("secondary", "sm")}
                    data-settings-open-profile
                  >
                    {t("Open your profile")}
                  </Link>
                </div>,
              )}

              {group(
                "account",
                t("Account"),
                <>
                  <SRow
                    title={t("Name")}
                    description={t("What Q should call you.")}
                  >
                    <span className="text-sm text-(--cq-text-secondary)">
                      {name ?? t("Not set yet")}
                    </span>
                    <Link
                      href="/profile#you"
                      className={accountButton("quiet", "sm")}
                    >
                      {t("Edit")}
                    </Link>
                  </SRow>
                  <SRow title={t("Email")} description={t("Used to sign in.")}>
                    <span className="text-sm break-all text-(--cq-text-secondary)">
                      {email ?? t("Not available")}
                    </span>
                  </SRow>
                  <SRow title={t("Password")}>
                    <Link
                      href="/auth/update-password"
                      className={accountButton("secondary", "sm")}
                    >
                      {t("Change password")}
                    </Link>
                  </SRow>
                  <SRow
                    title={t("Sign out")}
                    description={t("On this device.")}
                  >
                    <SignOutButton />
                  </SRow>
                </>,
              )}

              {group(
                "security",
                t("Security"),
                <SRow
                  title={t("Two-step verification")}
                  description={
                    twoStep === true
                      ? t(
                          "On. Signing in also asks for a code from your authenticator app.",
                        )
                      : twoStep === false
                        ? t(
                            "Off. Add a code from an authenticator app to every sign-in.",
                          )
                        : t(
                            "Add a code from an authenticator app to every sign-in.",
                          )
                  }
                >
                  <Link
                    href="/settings/security"
                    className={accountButton("secondary", "sm")}
                    data-settings-two-step
                  >
                    {twoStep === true ? t("Manage") : t("Turn on")}
                  </Link>
                </SRow>,
              )}

              {group(
                "team",
                t("Team"),
                <>
                  <SRow
                    title={acting?.name ?? t("Your team")}
                    description={
                      acting === null || words === null
                        ? t("Set up when Q onboards you.")
                        : acting.memberCount <= 1
                          ? t(words.soloLine(acting.name))
                          : t(
                              `You are ${ROLE_WORD[acting.role]}. ${acting.role === "MEMBER" ? words.member : words.admin}`,
                            )
                    }
                  >
                    <Link
                      href="/settings/team"
                      className={accountButton("secondary", "sm")}
                    >
                      {acting !== null && acting.memberCount <= 1
                        ? t("Invite your team")
                        : t("Open your team")}
                    </Link>
                  </SRow>
                  <ActivitySettingsRow />
                </>,
              )}

              {group(
                "appearance",
                t("Appearance"),
                <>
                  <ThemeCards />
                  <SRow
                    title={t("Q motion")}
                    description={t("How much Q's light moves.")}
                  >
                    <MotionChoice />
                  </SRow>
                  <SRow
                    title={t("Sounds")}
                    description={t(
                      "Small sounds when Q wakes, listens, works and has a result. Never while Q speaks.",
                    )}
                  >
                    <SoundChoice />
                  </SRow>
                  {canBrand ? (
                    <SRow
                      title={t("Brand")}
                      description={t(
                        "Black and gold or blue, for everyone. Admins only.",
                      )}
                    >
                      <Link
                        href="/admin/brand"
                        className={accountButton("secondary", "sm")}
                      >
                        {t("Customise")}
                      </Link>
                    </SRow>
                  ) : null}
                  {canBrand ? (
                    <SRow
                      title={t("How Q conducts business")}
                      description={t(
                        "The house guide for everyone. Admins only.",
                      )}
                    >
                      <Link
                        href="/admin/etiquette"
                        className={accountButton("secondary", "sm")}
                      >
                        {t("Open")}
                      </Link>
                    </SRow>
                  ) : null}
                </>,
              )}

              {group(
                "q",
                "Q",
                <>
                  <PersonalityChoice initial={personality} />
                  <SRow
                    title={t("Language")}
                    description={t("Written and spoken in this language.")}
                  >
                    <LanguageButton initial={language} current={languageName} />
                  </SRow>
                  <SRow
                    title={t("Q's voice")}
                    description={t(
                      "How Q sounds when you talk out loud, on this device.",
                    )}
                  >
                    <VoiceChoice />
                  </SRow>
                  <WakeRow />
                  <SRow
                    title={t("Listening sounds")}
                    description={t(
                      "On live voice: small reactions while you talk, and a short line while an answer takes a moment.",
                    )}
                  >
                    <ListeningChoice />
                  </SRow>
                </>,
              )}

              {group(
                "speaking",
                t("How Q speaks for you"),
                speaking === null ? (
                  <SRow
                    title={t("Your guide")}
                    description={t(
                      "Your guide couldn't load. Reload in a moment.",
                    )}
                  />
                ) : (
                  <SpeakingGuide initial={speaking} />
                ),
              )}

              {group(
                "notifications",
                t("Notifications"),
                <>
                  <NotificationRows />
                  <DailyRows initial={daily} />
                </>,
              )}

              {group(
                "connections",
                t("Connections"),
                <>
                  <GoogleRow outcome={google} reconnect={reconnect} />
                  <QEmailRow />
                </>,
              )}

              {group(
                "billing",
                t("Plan and billing"),
                <>
                  <SRow
                    title={
                      plan === null
                        ? t("Your plan")
                        : t(`${plan.plan.name} plan`)
                    }
                    description={
                      plan === null
                        ? t(
                            "Your plan couldn't load. Nothing is charged either way.",
                          )
                        : plan.source === "LAUNCH_DEFAULT"
                          ? t("Free while Capital Q launches.")
                          : plan.plan.description
                    }
                  >
                    <Link
                      href="/settings/plan"
                      className={accountButton("secondary", "sm")}
                    >
                      {t("Change plan")}
                    </Link>
                  </SRow>
                  <SRow
                    title={t("Usage this month")}
                    description={t("Conversations, research and rehearsals.")}
                  >
                    <Link
                      href="/settings/usage"
                      className={accountButton("quiet", "sm")}
                    >
                      {t("See usage")}
                    </Link>
                  </SRow>
                  <SRow
                    title={t("Billing")}
                    description={t("Invoices and payment method.")}
                  >
                    <Link
                      href="/settings/plan"
                      className={accountButton("quiet", "sm")}
                    >
                      {t("Manage billing")}
                    </Link>
                  </SRow>
                </>,
              )}

              {group(
                "privacy",
                t("Privacy"),
                <>
                  <PreferenceLearningSwitch initial={learning} layout="row" />
                  <SRow
                    title={t("What Q remembers")}
                    description={t(
                      "Things you told Q, corrections you made, and what was mentioned in passing.",
                    )}
                  >
                    <Link
                      href="/settings/memory"
                      className={accountButton("secondary", "sm")}
                    >
                      {t("Open")}
                    </Link>
                  </SRow>
                </>,
              )}
            </div>
          </div>
        </QSection>
      </AccountColumn>
    </AccountToastProvider>
  );
}
