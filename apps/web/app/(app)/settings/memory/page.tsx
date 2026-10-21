import type { Metadata } from "next";

import { getQPreferenceLearning, listQMemory } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";
import { AccountToastProvider } from "@/features/settings/account-kit";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { QMemoryList } from "@/features/settings/q-memory-list";
import { PreferenceLearningSwitch } from "@/features/settings/preference-learning";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "What Q remembers" };
export const dynamic = "force-dynamic";

/**
 * What Q remembers about the person (ADR 0012; founder live 2026-09-29;
 * chosen design "Grouped, forget in place", 2026-10-21): read under their
 * own session, from the Q API, and theirs to correct or forget.
 */
export default async function QMemoryPage() {
  const t = await serverT();
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const session =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : { baseUrl: qApiBaseUrl, accessToken };
  const [read, learning] =
    session === null
      ? [null, null]
      : await Promise.all([
          listQMemory(session).catch(() => null),
          getQPreferenceLearning(session).catch(() => null),
        ]);
  return (
    <AccountToastProvider>
      <AccountColumn>
        <QSection id="memory" kind="MEMORY" label={t("what Q remembers")}>
          <AccountHead
            title={t("What Q remembers")}
            back={{ href: "/settings", label: t("Settings") }}
            sub={t(
              "What Q keeps about you and how you work. Correct anything, or tell Q to forget it.",
            )}
          />
          <PreferenceLearningSwitch initial={learning} />
          {read === null ? (
            <p
              className="mt-4 text-[15px] text-(--cq-text-secondary)"
              data-state="unavailable"
            >
              {t("Q's memory couldn't be read just now. Reload in a moment.")}
            </p>
          ) : (
            <QMemoryList items={read.items} />
          )}
        </QSection>
      </AccountColumn>
    </AccountToastProvider>
  );
}
