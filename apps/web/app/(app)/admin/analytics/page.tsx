import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminAnalyticsSettings } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { AnalyticsSettingsForm } from "@/features/admin/analytics-settings-form";
import { when } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Analytics privacy · Admin") };
}

/**
 * Q Workspace §8: who may see whom when investors look at companies. The
 * defaults are the Product Specification §6.7; anything beyond it is
 * marked. Enforcement is in the database projection, so a change here
 * takes effect at once, without a deploy.
 */
export default async function AdminAnalyticsSettingsPage() {
  const t = await serverT();
  const context = await adminContext();
  if (context === null || !context.can("analytics_settings.read")) notFound();
  const current = await getAdminAnalyticsSettings(context.session).catch(
    () => null,
  );
  return (
    <PageSection
      id="analytics-settings"
      title={t("Analytics privacy")}
      description={t(
        "What founders see when investors view their company, and what Q and notifications may use. The defaults follow the product specification §6.7; anything beyond it is marked. Every change names who and why.",
      )}
    >
      {current === null ? (
        <ErrorState
          title={t("Settings couldn't load")}
          description={t("Try again in a moment.")}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <AnalyticsSettingsForm
            initial={current.settings}
            version={current.version}
            canWrite={context.can("analytics_settings.write")}
          />
          {current.history.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h2 className="cq-body font-medium text-(--cq-text-primary)">
                {t("Changes")}
              </h2>
              <ul className="flex flex-col gap-1">
                {current.history.map((change) => (
                  <li
                    key={change.at}
                    className="cq-caption text-(--cq-text-secondary)"
                  >
                    {t(when(change.at))} {t("by")}{" "}
                    {t(change.actorName ?? "an admin")}:{" "}
                    {change.changed.join(", ")} · {t(change.reason)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </PageSection>
  );
}
