"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { Q_VIEW_VERDICT_LABELS } from "@capital-q/contracts";
import { Check, FileText, ICON_SIZE, Plus } from "@capital-q/ui/icons";
import { buttonClassName } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";

import { ProfileUnicornAssessment } from "../material/fit-panel-slot";
import type { PitchProfileSection } from "../pitch-profile";
import { RaiseFact } from "../raise-fact";
import { useProfileTab } from "../profile-tabs";
import { useBrief } from "./brief-context";
import type { KeyNumber } from "./model";
import { BriefGrid, ClaimLine, Hatch, QReadCard } from "./parts";
import { FitCard, ScoresCard } from "./scores-fit";
import { SectionTrack } from "./section-track";

/**
 * The Overview as the decision brief (profile option 1): Q's read, marked
 * not verified; the key numbers the deck states, as the founder's claims;
 * the company section by section, where a gap becomes a question; and, on
 * the rail, the scores with their evidence range and the fit with the
 * reader's mandate. The owner sees the same sections with their own gaps
 * to fill, and no investor-only parts.
 */
export function OverviewBrief({
  companyId,
  companyName,
  sections,
  numbers,
  own,
  investor,
  scoresSlot = null,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly sections: readonly PitchProfileSection[];
  readonly numbers: readonly KeyNumber[];
  readonly own: boolean;
  readonly investor: boolean;
  /** Lane iq's own scores, in place of the brief's card. */
  readonly scoresSlot?: ReactNode;
}) {
  const t = useT();
  const brief = useBrief();
  const params = useSearchParams();
  // Owner and investor read the same sections; only the words differ.
  const tab = useProfileTab();
  // Q opens a section from anywhere with `?tab=overview&sub=<key>`.
  const sub =
    tab === null || tab === "overview"
      ? (params?.get("sub")?.toLowerCase() ?? null)
      : null;
  const askedAt =
    sub === null ? -1 : sections.findIndex((s) => s.sectionKey === sub);
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (askedAt < 0) return;
    top.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [askedAt]);

  const provided = sections.filter((s) => s.provided).length;
  const gaps = sections.length - provided;
  const view = investor ? (brief?.qView ?? null) : null;

  const main = (
    <>
      {view === null ? null : (
        <QReadCard>
          <p>
            <b>{Q_VIEW_VERDICT_LABELS[view.verdict]}.</b> {view.summary}
          </p>
          {view.mainRisk === null ? null : (
            <p className="qual">{view.mainRisk}</p>
          )}
        </QReadCard>
      )}
      {numbers.length === 0 ? null : (
        <div data-profile-key-facts>
          <div className="cq-brief-row" style={{ marginBottom: 10 }}>
            <b className="cq-brief-title">{t("Key numbers")}</b>
            <span className="cq-brief-label">
              {own
                ? t("From your deck, as you state them")
                : t("From the deck, founder’s claims")}
            </span>
          </div>
          <dl className="cq-brief-kv">
            {numbers.map((number) => (
              <div key={number.label}>
                <dt className="cq-brief-label">{number.label}</dt>
                <dd className="m-0">
                  <b>
                    {number.raise === undefined ? (
                      number.value
                    ) : (
                      <RaiseFact words={number.raise} />
                    )}
                  </b>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <section
        ref={top}
        className="cq-brief-card"
        aria-labelledby="pitch-profile-title"
        data-pitch-profile={own ? "owner" : "reader"}
      >
        <div className="cq-brief-row">
          <h2 id="pitch-profile-title" className="cq-brief-title m-0">
            {own
              ? t("Your profile, section by section")
              : t("Section by section")}
          </h2>
          <div className="cq-brief-legend" data-pitch-profile-summary>
            <span>
              <i data-k="ok" aria-hidden="true" />
              {provided}{" "}
              {sections.every((s) => !s.provided || s.status === "PRESENT")
                ? "in the deck"
                : "provided"}
            </span>
            <span>
              <i data-k="gap" aria-hidden="true" />
              {gaps} not provided
            </span>
          </div>
        </div>
        <SectionTrack
          sections={sections.map((s) => ({
            key: s.sectionKey,
            label: s.label,
            gap: !s.provided,
          }))}
          label={`${companyName}'s profile, section by section`}
          initial={askedAt >= 0 ? askedAt : 0}
          render={(index) => {
            const section = sections[index];
            return section === undefined ? null : (
              <SectionDetail
                section={section}
                companyName={companyName}
                own={own}
                investor={investor}
              />
            );
          }}
        />
      </section>
      {investor ? <ProfileUnicornAssessment /> : null}
    </>
  );
  return (
    <div data-profile-overview>
      <BriefGrid
        main={main}
        rail={
          investor ? (
            <>
              {scoresSlot ?? <ScoresCard companyName={companyName} />}
              <FitCard companyId={companyId} companyName={companyName} />
            </>
          ) : null
        }
      />
    </div>
  );
}

/** Where a provided section's words come from, in words. */
function sourceTag(section: PitchProfileSection): string {
  if (section.status === "PRESENT") return "In the deck";
  if (section.facts.some((fact) => fact.source.includes("Pitch video")))
    return "Said in the pitch";
  return "Founder’s answer";
}

function SectionDetail({
  section,
  companyName,
  own,
  investor,
}: {
  readonly section: PitchProfileSection;
  readonly companyName: string;
  readonly own: boolean;
  readonly investor: boolean;
}) {
  const t = useT();
  const brief = useBrief();
  if (section.provided) {
    const facts = section.facts.filter((f) => f.value !== null).slice(0, 4);
    const where = section.pages[0];
    return (
      <>
        <h4>
          {section.label}
          {section.status === "CONTRADICTORY" ? (
            <span className="cq-brief-tag" data-tone="gap">
              <Hatch />
              {t("Numbers disagree")}
            </span>
          ) : (
            <span
              className="cq-brief-tag"
              data-tone={section.status === "PRESENT" ? "positive" : "claim"}
            >
              <FileText size={ICON_SIZE.compact} aria-hidden="true" />
              {t(sourceTag(section))}
              {where === undefined ? "" : `, slide ${String(where)}`}
            </span>
          )}
        </h4>
        {section.summary === null ? null : <p>{section.summary}</p>}
        {facts.length === 0 ? null : (
          <dl className="cq-brief-secfacts">
            {facts.map((fact) => (
              <div key={fact.key} className="flex gap-1">
                <dt>{fact.label}</dt>
                <dd className="m-0">
                  <b>{fact.value}</b>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <ClaimLine>
          {own
            ? t("Your own words; investors see them as your claim")
            : t("Founder’s claim, not verified")}
        </ClaimLine>
      </>
    );
  }
  const added = brief?.hasGap(section.sectionKey) ?? false;
  return (
    <>
      <h4>
        {section.label}
        <span className="cq-brief-tag" data-tone="gap">
          <Hatch />
          {t("Not provided")}
        </span>
      </h4>
      <p data-muted="">
        {own
          ? "Not in your deck yet. It stays unknown to investors until you add it."
          : `The deck doesn’t cover this. It stays unknown, and doesn’t count against ${companyName}.`}
      </p>
      {own && section.prompt !== undefined ? (
        <div>
          <Link
            href={section.prompt.href}
            className={buttonClassName("secondary", "compact")}
            data-profile-section-prompt={section.key}
          >
            <Plus size={ICON_SIZE.compact} aria-hidden="true" />
            {section.prompt.label}
          </Link>
        </div>
      ) : investor && brief !== null && section.gapQuestion !== null ? (
        <div>
          {added ? (
            <span className="cq-brief-tag" data-tone="positive" data-gap-added>
              <Check size={ICON_SIZE.compact} aria-hidden="true" />
              {t("Added to your questions")}
            </span>
          ) : (
            <button
              type="button"
              className={buttonClassName("secondary", "compact")}
              onClick={() =>
                brief.addGap(
                  section.sectionKey,
                  section.label,
                  section.gapQuestion ?? "",
                )
              }
              data-gap-question={section.sectionKey}
            >
              <Plus size={ICON_SIZE.compact} aria-hidden="true" />
              {t("Add to your questions")}
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
