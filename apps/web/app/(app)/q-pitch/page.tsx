import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";

import { PageContainer } from "@/components/app-shell/page-container";
import { resolveOwnContext } from "@/features/q/context";
import { atlasChapters, tourOptions } from "@/features/q-pitch/atlas";
import { qPitchEnabled } from "@/features/q-pitch/flag";
import { resolveTourSubject } from "@/features/q-pitch/subject";
import { QSection } from "@/features/q/q-section";

export const metadata: Metadata = { title: "Q Pitch" };
export const dynamic = "force-dynamic";

/**
 * Q Pitch entry (owner request, 15 Oct): choose the premiere, the
 * two-minute version or a Feature Atlas chapter. Behind CQ_Q_PITCH_TOUR,
 * role-aware, and honest about what is certified. Starting a tour is a full
 * page load into the layout-mounted host, which admits only fictional demo
 * accounts; nothing here grants access to anything.
 */
export default async function QPitchPage() {
  if (!qPitchEnabled()) notFound();
  const context = await resolveOwnContext();
  const now = new Date().toISOString();

  if (context.kind !== "INVESTOR") {
    return (
      <PageContainer width="reading">
        <QSection id="q-pitch" kind="PITCH" label="the Capital Q tour">
          <h1 className="cq-title-xl text-(--cq-text-primary)">Q Pitch</h1>
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
  const chapters = atlasChapters(now);
  return (
    <PageContainer width="reading">
      <QSection id="q-pitch" kind="PITCH" label="the Capital Q tour">
        <h1 className="cq-title-xl text-(--cq-text-primary)">Q Pitch</h1>
        <p className="mt-3 cq-body text-(--cq-text-secondary)">
          Q guides you through the real app. These are internal rehearsals of a
          draft script on demonstration data. You can pause, go back, skip or
          ask a question at any point.
        </p>
        <p className="mt-2 cq-body-sm text-(--cq-text-secondary)">
          {subject === null
            ? "No subject company is set, or it is not visible to you."
            : `Subject company: ${subject.name}, as its founder has made it visible to you.`}
        </p>

        <h2 className="mt-8 cq-title text-(--cq-text-primary)">Guided tours</h2>
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
                  scenes certified in a browser
                </p>
              </div>
              {/* A full load: the layout-mounted host reads the address once. */}
              <a href={option.href} className={buttonClassName("primary")}>
                Start
              </a>
            </li>
          ))}
        </ul>

        <h2 className="mt-8 cq-title text-(--cq-text-primary)">
          Feature Atlas
        </h2>
        <p className="mt-2 cq-body-sm text-(--cq-text-secondary)">
          Start at any chapter. Chapters marked internal show code-verified
          behaviour without a browser receipt yet.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {chapters.map((chapter) => (
            <li
              key={chapter.chapterId}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="cq-body text-(--cq-text-primary)">
                {chapter.title}
                <span className="ml-2 cq-body-sm text-(--cq-text-secondary)">
                  {chapter.standing === "CERTIFIED"
                    ? "Certified"
                    : "Internal only"}
                </span>
              </span>
              <a href={chapter.href} className={buttonClassName("secondary")}>
                Open
              </a>
            </li>
          ))}
        </ul>
      </QSection>
    </PageContainer>
  );
}
