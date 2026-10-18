import type { Metadata } from "next";

import { getQPreferenceLearning, listQMemory } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionAccessToken } from "@/auth/session";
import { QMemoryList } from "@/features/settings/q-memory-list";
import { PreferenceLearningSwitch } from "@/features/settings/preference-learning";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "What Q remembers" };
export const dynamic = "force-dynamic";

/**
 * What Q remembers about the person (ADR 0012; founder live 2026-09-29):
 * read under their own session, from the Q API, and theirs to correct.
 */
export default async function QMemoryPage() {
  const t = await serverT();
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const read =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : await listQMemory({ baseUrl: qApiBaseUrl, accessToken }).catch(
          () => null,
        );
  const learning =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : await getQPreferenceLearning({
          baseUrl: qApiBaseUrl,
          accessToken,
        }).catch(() => null);
  return (
    <PageContainer width="reading" className="flex flex-col gap-6">
      <QSection id="memory" kind="MEMORY" label={t("what Q remembers")}>
        <PageHeader
          title={t("What Q remembers")}
          description={t(
            "Q uses this in every conversation. Forget anything wrong.",
          )}
        />
        <PreferenceLearningSwitch initial={learning} />
        {read === null ? (
          <p
            className="cq-body text-(--cq-text-secondary)"
            data-state="unavailable"
          >
            {t("Q's memory couldn't be read just now. Reload in a moment.")}
          </p>
        ) : (
          <QMemoryList items={read.items} />
        )}
      </QSection>
    </PageContainer>
  );
}
