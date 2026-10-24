import type { Metadata } from "next";

import {
  getMyEtiquetteGuide,
  getMyPlan,
  getQDailyPreferences,
  getQPreferenceLearning,
} from "@capital-q/api-client";
import { languageInfo } from "@capital-q/q-core/language";

import { getSessionUser } from "@/auth/session";
import { adminContext } from "@/features/admin/admin-context";
import { machineUiText } from "@/features/i18n/machine";
import { translate, uiLanguageOf } from "@/features/i18n/messages";
import { deviceLanguages } from "@/features/i18n/server";
import {
  loadProfileImages,
  loadProfilePage,
} from "@/features/profile/profile-data";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
  resolveQStanding,
} from "@/features/q/context";
import { SettingsView } from "@/features/settings/settings-view";
import { loadMyOrganisations } from "@/features/team/load-organisations";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings (R28; chosen design "One page with an index", 2026-10-21):
 * every section on one page, an index beside it that jumps, and each row
 * saying what it does in a sentence. "Your profile" comes first.
 *
 * Per-device choices (theme, Q motion, sounds, Q's voice, listening, wake
 * word) are kept by the browser; Q's personality, language, The Q Daily,
 * the guide, notification email, plan and learning consent are kept by
 * Capital Q and read in parallel as the page renders. Connections read
 * their own status after the page opens. Every control here does
 * something; none is decoration.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const google = params["google"];
  const [session, billingSession, context] = await Promise.all([
    qApiSession(),
    apiSession(),
    resolveOwnContext(),
  ]);
  const [
    standing,
    daily,
    user,
    plan,
    admin,
    speaking,
    mine,
    learning,
    profile,
  ] = await Promise.all([
    resolveQStanding(),
    session === null
      ? Promise.resolve(null)
      : getQDailyPreferences(session).catch(() => null),
    getSessionUser(),
    billingSession === null
      ? Promise.resolve(null)
      : getMyPlan(billingSession).catch(() => null),
    adminContext().catch(() => null),
    billingSession === null
      ? Promise.resolve(null)
      : getMyEtiquetteGuide(billingSession).catch(() => null),
    loadMyOrganisations(),
    session === null
      ? Promise.resolve(null)
      : getQPreferenceLearning(session).catch(() => null),
    loadProfilePage(billingSession, context).catch(() => null),
  ]);
  const person = profile?.person ?? null;
  const images =
    person === null
      ? null
      : await loadProfileImages(billingSession, "PERSON", person.userId);
  const acting = mine.find((organisation) => organisation.active) ?? null;
  // Any language: this page in their chosen language.
  const pageLanguage = uiLanguageOf(
    standing?.language,
    await deviceLanguages(),
  );
  await machineUiText(pageLanguage);
  const t = (english: string) => translate(pageLanguage, english);
  const canBrand = admin?.can("flags.write") === true;
  const language = standing?.language ?? "AUTO";
  return (
    <SettingsView
      t={t}
      email={user?.email ?? null}
      person={person}
      avatar={images?.avatar?.url ?? null}
      personality={standing?.personality ?? "AUTO"}
      language={language}
      languageName={
        language === "AUTO"
          ? null
          : (languageInfo(language)?.nativeName ?? language)
      }
      daily={daily}
      plan={plan}
      canBrand={canBrand}
      speaking={speaking}
      acting={acting}
      learning={learning}
      google={typeof google === "string" ? google : undefined}
      reconnect={params["reconnect"] === "google"}
    />
  );
}
