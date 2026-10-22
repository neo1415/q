import type { Metadata } from "next";

import {
  CAPITAL_Q_PITCH,
  pitchSectionAnchor,
  type PitchSection,
} from "@capital-q/q-pitch";
import { ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import { PitchRail } from "@/features/q-pitch/founder/pitch-rail";
import { QSection } from "@/features/q/q-section";

export const metadata: Metadata = { title: "Capital Q, presented by Q" };

/**
 * Capital Q itself, on the owner's fourteen-section template (founder
 * track, step two). Static and the same for every viewer: it is Capital
 * Q's own pitch, drawn from the product sources, with nothing private and
 * nothing about the viewer. Honest by construction (`capital-q-pitch.ts`
 * and its tests): pre-seed, bootstrapping, the raise as the founders'
 * claim, no traction or team size.
 *
 * Each section is a native <details> the tour opens and lights while Q
 * speaks about it (`fdr.02.pitch.<key>`); read alone, every part opens by
 * hand and the index jumps to it.
 */

const STANDING_WORDS: Readonly<
  Record<PitchSection["standing"], string | null>
> = {
  DOCUMENTED: null,
  FOUNDER_CLAIM: "The founders' own claim, not verified",
  NOT_KNOWN: "Not provided, so not stated",
};

/** A source path as a reader would name it. */
function sourceName(source: string): string {
  const [path = "", ...rest] = source.split(" ");
  const detail = rest.join(" ");
  const names: readonly (readonly [RegExp, string])[] = [
    [/PADL/u, "Product architecture decision log"],
    [/PRODUCT_SPECIFICATION/u, "Product specification"],
    [/GateQ_Product_Feature/u, "GateQ specification"],
    [/LANDING-PROMISES/u, "Capital Q landing page"],
    [/INVESTIQ-METHODOLOGY/u, "InvestIQ methodology"],
    [/qa-bank/u, "Q's investor Q&A (what is not known)"],
    [/Recommendation_Architecture/u, "Recommendation architecture"],
  ];
  const name = names.find(([pattern]) => pattern.test(path))?.[1];
  if (name === undefined) return source;
  return detail.length > 0 ? `${name}, ${detail}` : name;
}

export default function CapitalQPitchPage() {
  const sections = CAPITAL_Q_PITCH.map((section) => ({
    key: section.key,
    title: section.title,
    anchor: pitchSectionAnchor(section.key),
  }));
  return (
    <PageContainer>
      <QSection id="capital-q-pitch" kind="PITCH" label="the Capital Q pitch">
        <header className="flex max-w-3xl flex-col gap-4 pb-10 sm:pb-14">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Presented by Q, on the template every founder&rsquo;s overview uses
          </p>
          <h1 className="cq-display text-(--cq-text-primary)">Capital Q</h1>
          <p className="text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] leading-snug font-[family-name:var(--cq-font-editorial)] text-(--cq-text-primary)">
            Investment intelligence for private capital: fewer months of
            searching, more time understanding the right opportunities.
          </p>
          <p className="cq-body text-(--cq-text-secondary)">
            Pre-seed and bootstrapping. Every statement below is drawn from
            Capital Q&rsquo;s own product sources; what isn&rsquo;t known is
            said, not estimated.
          </p>
        </header>
        <div className="cq-qp-board">
          <PitchRail sections={sections} />
          <div className="flex min-w-0 flex-col border-t border-(--cq-border-subtle)">
            {CAPITAL_Q_PITCH.map((section, index) => (
              <details
                key={section.key}
                id={`pitch-${section.key}`}
                className="cq-qp-section group border-b border-(--cq-border-subtle)"
                data-qp-anchor={pitchSectionAnchor(section.key)}
                data-pitch-section={section.key}
              >
                <summary className="grid min-h-16 cursor-pointer grid-cols-[2.25rem_1fr_auto] items-baseline gap-x-3 py-4 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)">
                  <span
                    className="cq-body-sm text-(--cq-text-tertiary) tabular-nums"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <h2 className="cq-title-sm text-(--cq-text-primary)">
                    {section.title}
                  </h2>
                  <ChevronDown
                    size={ICON_SIZE.regular}
                    aria-hidden="true"
                    className="cq-qp-caret row-span-2 self-center text-(--cq-text-tertiary)"
                  />
                  <span className="cq-body col-start-2 mt-1 text-(--cq-text-secondary)">
                    {section.summary}
                  </span>
                </summary>
                <div className="flex flex-col gap-4 pb-6 ps-[3rem]">
                  <ul className="cq-qp-points flex max-w-[68ch] flex-col gap-3 ps-5">
                    {section.points.map((point) => (
                      <li
                        key={point}
                        className="cq-body text-(--cq-text-primary)"
                      >
                        {point}
                      </li>
                    ))}
                  </ul>
                  {STANDING_WORDS[section.standing] === null ? null : (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      {STANDING_WORDS[section.standing]}
                    </p>
                  )}
                  <p className="cq-caption text-(--cq-text-tertiary)">
                    From: {section.sources.map(sourceName).join("; ")}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </QSection>
    </PageContainer>
  );
}
