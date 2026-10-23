import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";

import { PageContainer } from "@/components/app-shell/page-container";
import { tourOptions } from "@/features/q-pitch/atlas";
import { qPitchEnabled } from "@/features/q-pitch/flag";
import { tourStartFor } from "@/features/q-pitch/tour-start";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Q Pitch" };
export const dynamic = "force-dynamic";

/**
 * Q Pitch entry: start the v7 story (owner, 21 Oct; the v5 premiere,
 * two-minute cut and Feature Atlas are retired), in one of its three cuts,
 * the owner approved for an audience (22 Oct). Behind CQ_Q_PITCH_TOUR, for
 * any signed-in account (owner, 23 Oct). Starting is a full page load into
 * the layout-mounted host; the story plays its own fictional data and
 * reads nothing of the viewer's. Nothing here grants access to anything.
 */
export default async function QPitchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  if (!qPitchEnabled()) notFound();
  if ((await searchParams)["start"] === "1") redirect(tourStartFor());
  const options = tourOptions(new Date().toISOString());
  return (
    <PageContainer width="reading">
      <QSection id="q-pitch" kind="PITCH" label={t("the Capital Q tour")}>
        <h1 className="cq-title-xl text-(--cq-text-primary)">{t("Q Pitch")}</h1>
        <p className="mt-3 cq-body text-(--cq-text-secondary)">
          {t(
            "Q tells the Capital Q story in its own voice. What it shows of the product uses fictional demonstration data, labelled as such. You can pause, go back, skip, start over or ask a question at any point, by voice or by typing.",
          )}
        </p>
        <p className="mt-2 cq-body-sm text-(--cq-text-secondary)">
          {t(
            'You can also ask Q from any page: "Hey Q, pitch yourself", or "pitch yourself to investors" or "to founders".',
          )}
        </p>

        <h2 className="mt-8 cq-title text-(--cq-text-primary)">
          {t("Who is it for?")}
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
                  {option.length}
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
