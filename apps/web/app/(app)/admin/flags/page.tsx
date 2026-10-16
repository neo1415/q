import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminFlags } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { FlagToggle } from "@/features/admin/flag-controls";
import { flagName } from "@/features/admin/flag-names";
import { when } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Kill switches · Admin" };

export default async function AdminFlagsPage() {
  const t = await serverT();

  const context = await adminContext();
  if (context === null || !context.can("flags.read")) notFound();
  const flags = await getAdminFlags(context.session)
    .then((result) => result.rows)
    .catch(() => null);
  return (
    <PageSection
      id="flags"
      title={t("Kill switches")}
      description={t(
        "Stop what Q does on its own, platform-wide, at once. Every change names who and why.",
      )}
    >
      {flags === null ? (
        <ErrorState
          title={t("Switches couldn't load")}
          description={t("Try again in a moment.")}
        />
      ) : (
        <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {flags.map((flag) => (
            <li
              key={flag.key}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="cq-body font-medium text-(--cq-text-primary)">
                  {t(flagName(flag.key))} · {flag.enabled ? t("On") : t("Off")}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {t(flag.description)}
                </span>
                {flag.history.length === 0 ? null : (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {flag.history.map((event) => (
                      <li
                        key={event.at}
                        className="cq-caption text-(--cq-text-secondary)"
                      >
                        {event.enabled ? t("Turned on") : t("Turned off")}{" "}
                        {t(when(event.at))} {t("by")}{" "}
                        {t(event.actorName ?? "an admin")}: {t(event.reason)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {context.can("flags.write") ? (
                <FlagToggle flagKey={flag.key} enabled={flag.enabled} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
