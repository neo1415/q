import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";

import { PageContainer } from "@/components/app-shell/page-container";
import { resolveOwnContext } from "@/features/q/context";
import { tourOptions } from "@/features/q-pitch/atlas";
import { qPitchEnabled } from "@/features/q-pitch/flag";
import { tourStartFor } from "@/features/q-pitch/tour-start";
import { resolveTourSubject } from "@/features/q-pitch/subject";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Q Pitch" };
export const dynamic = "force-dynamic";

/**
 * Q Pitch entry: start the v7 story (owner, 21 Oct; the v5 premiere,
 * two-minute cut and Feature Atlas are retired). Behind CQ_Q_PITCH_TOUR,
 * role-aware, and honest about what is certified. Starting a tour is a full
 * page load into the layout-mounted host, which admits only fictional demo
 * accounts; nothing here grants access to anything.
 */
export default async function QPitchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  if (!qPitchEnabled()) notFound();
  const context = await resolveOwnContext();
  if ((await searchParams)["start"] === "1") {
    const start = tourStartFor(context.kind);
    if (start !== null) redirect(start);
  }
  const now = new Date().toISOString();

  if (context.kind !== "INVESTOR") {
    return (
      <PageContainer width="reading">
        <QSection id="q-pitch" kind="PITCH" label={t("the Capital Q tour")}>
          <h1 className="cq-title-xl text-(--cq-text-primary)">
            {t("Q Pitch")}
          </h1>
          <p className="mt-3 cq-body text-(--cq-text-secondary)">
            {context.kind === "FOUNDER"
              ? "The guided tour is written for an investor workspace today. A founder edition has not been built yet, so there is nothing to start here."
              : "The guided tour needs an investor workspace."}
          </p>
        </QSection>
      </PageContainer>
    );
  }

  const subject = await resolveTourSubject();
  const options = tourOptions(now);
  return (
    <PageContainer width="reading">
      <QSection id="q-pitch" kind="PITCH" label={t("the Capital Q tour")}>
        <h1 className="cq-title-xl text-(--cq-text-primary)">{t("Q Pitch")}</h1>
        <p className="mt-3 cq-body text-(--cq-text-secondary)">
          {t(
            "Q tells the Capital Q story over the real app, in its own voice. It is an internal rehearsal on demonstration data until the owner approves it. You can pause, go back, skip or ask a question at any point.",
          )}
        </p>
        <p className="mt-2 cq-body-sm text-(--cq-text-secondary)">
          {subject === null
            ? "No subject company is set, or it is not visible to you."
            : `Subject company: ${subject.name}, as its founder has made it visible to you.`}
        </p>

        <h2 className="mt-8 cq-title text-(--cq-text-primary)">
          {t("Guided tours")}
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {options.map((option) => (
            <li
              key={option.key}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-(--cq-border-subtle) pb-3"
            >
              <div>
                <p className="cq-body font-medium text-(--cq-text-primary)">
                  {option.title}
                </p>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {option.length} · {option.certifiedScenes} of {option.scenes}{" "}
                  product moments certified in a browser
                </p>
              </div>
              {/* A full load: the layout-mounted host reads the address once. */}
              <a href={option.href} className={buttonClassName("primary")}>
                {t("Start")}
              </a>
            </li>
          ))}
        </ul>
      </QSection>
    </PageContainer>
  );
}
