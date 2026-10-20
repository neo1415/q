"use client";

import Link from "next/link";
import { useState } from "react";

import { Flag } from "@capital-q/ui/icons";

import {
  READINESS_STATUSES,
  type ReadinessDto,
  type ReadinessEvidenceLine,
} from "@capital-q/contracts";

import { AskQChips } from "@/features/capital/ask-q-chips";
import { QControl } from "@/features/q/control/q-control";
import { crmButton, CrmSheet, QLine } from "@/features/relationships/crm-kit";

import { ReadinessStatusBadge } from "./readiness-status";
import { useT } from "@/features/i18n/language";

/**
 * Readiness (Q.03): what could stop the raise, then each pillar as a row
 * with its status in words and the evidence behind it (design:
 * docs/design/2026-10-07/founder-readiness). No score and no percentage:
 * the tally counts pillars by word. Not shared yet is neutral. Founder-
 * private, said on the section itself.
 */

const TRUTH_WORDS: Readonly<Record<string, string>> = {
  VERIFIED: "Verified",
  USER_CLAIM: "Your claim",
  ESTIMATE: "Estimate",
  Q_INFERENCE: "Q's inference",
  UNKNOWN: "Unknown",
};

const EVIDENCE_WORDS: Readonly<Record<string, string>> = {
  NO_EVIDENCE: "no evidence",
  SELF_REPORTED: "self-reported",
  DOCUMENT_SUPPORTED: "document supported",
  MULTI_SOURCE_SUPPORTED: "several sources",
  EXTERNALLY_VERIFIED: "externally verified",
  PLATFORM_VERIFIED: "verified on Capital Q",
};

function evidenceTag(line: ReadinessEvidenceLine): string {
  if (line.truthClass === null) return line.note ?? "";
  const truth = TRUTH_WORDS[line.truthClass] ?? line.truthClass;
  const status =
    line.evidenceStatus === null
      ? null
      : (EVIDENCE_WORDS[line.evidenceStatus] ?? line.evidenceStatus);
  return [truth, status, line.note].filter((part) => part !== null).join(" · ");
}

export function PrivateNote() {
  const t = useT();
  return (
    <span className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-tertiary)">
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
        <rect
          x="1"
          y="5"
          width="8"
          height="6"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M3 5V3.5a2 2 0 0 1 4 0V5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
      {t("Only your team sees this")}
    </span>
  );
}

export function ReadinessTally({
  readiness,
}: {
  readonly readiness: ReadinessDto;
}) {
  const t = useT();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("Pillars by status")}>
      {READINESS_STATUSES.map((status) => {
        const count = readiness.pillars.filter(
          (pillar) => pillar.status === status,
        ).length;
        return count === 0 ? null : (
          <li key={status}>
            <ReadinessStatusBadge status={status} count={count} />
          </li>
        );
      })}
    </ul>
  );
}

export function ReadinessSection({
  readiness,
}: {
  readonly readiness: ReadinessDto;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const pillar = readiness.pillars.find((entry) => entry.pillar === open);
  const onFile = readiness.pillars.filter(
    (entry) => entry.status === "STRONG" || entry.status === "DEVELOPING",
  ).length;
  return (
    <div className="flex flex-col gap-3.5" data-readiness>
      {/* The words carry the status; the shapes repeat it (design
          2026-10-20: each area says on file, developing or missing). */}
      <ReadinessTally readiness={readiness} />

      <QControl id="list.pillars" kind="LIST">
        <ul
          aria-label={t("Readiness by pillar")}
          className="grid grid-cols-2 gap-2.5 lg:grid-cols-4"
        >
          {readiness.pillars.map((entry) => {
            const missing =
              entry.status === "GAP" || entry.status === "UNKNOWN";
            return (
              <li key={entry.pillar}>
                <button
                  type="button"
                  onClick={() => setOpen(entry.pillar)}
                  className={`cq-crm-lift flex min-h-[120px] w-full flex-col gap-2 rounded-(--cq-radius-lg) border p-3.5 text-start focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) ${missing ? "border-dashed border-(--cq-border) bg-(--cq-surface-subtle)" : "border-(--cq-border-subtle) bg-(--cq-surface-raised)"}`}
                  data-readiness-pillar={entry.pillar}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <b className="font-semibold text-(--cq-text-primary)">
                      {t(entry.label)}
                    </b>
                    <ReadinessStatusBadge status={entry.status} />
                  </span>
                  <span className="text-[13px] text-(--cq-text-secondary)">
                    {t(entry.summary)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </QControl>

      <QLine
        small={t(
          "Q's reading of what you shared. No score is given, and nothing missing is counted against you.",
        )}
      >
        {t(
          `${String(onFile)} of ${String(readiness.pillars.length)} areas are strong or developing.`,
        )}
      </QLine>

      {readiness.blockers.length === 0 ? null : (
        <QControl id="section.risks" kind="SECTION">
          <section
            aria-labelledby="stop-raise-heading"
            className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
          >
            <h3
              id="stop-raise-heading"
              className="text-[13px] font-medium text-(--cq-text-secondary)"
            >
              {t("What could stop your raise")}
            </h3>
            <QControl id="list.risks" kind="LIST">
              <ol className="flex flex-col gap-2">
                {readiness.blockers.map((blocker) => (
                  <li
                    key={blocker.id}
                    data-q-item
                    className="flex items-start gap-2.5 text-sm text-(--cq-text-primary)"
                  >
                    <Flag
                      size={15}
                      aria-hidden="true"
                      className="mt-0.5 flex-none text-(--cq-text-secondary)"
                    />
                    <span>
                      {blocker.title}{" "}
                      <span className="text-(--cq-text-secondary)">
                        {blocker.why}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </QControl>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href="/relationships?view=capital&tab=action-plan"
                className={crmButton("secondary")}
              >
                {t("Open the action plan")}
              </Link>
              <AskQChips
                asks={[
                  {
                    label: "Ask Q about this",
                    prompt:
                      "What could stop my raise, and what fixes each one?",
                  },
                ]}
              />
            </div>
          </section>
        </QControl>
      )}
      {readiness.uncertainty.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-xs text-(--cq-text-tertiary)">
          {readiness.uncertainty.slice(0, 3).map((line) => (
            <li key={line}>{t(line)}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-(--cq-text-tertiary)">
        Rules {readiness.rulesVersion.replace("readiness-rules/", "")} ·
        revision {readiness.revision} · recomputed every time you open this
        page.
      </p>

      {pillar === undefined ? null : (
        <CrmSheet
          open
          onOpenChange={(next) => {
            if (!next) setOpen(null);
          }}
          title={t(pillar.label)}
          sub={t(pillar.summary)}
        >
          <ReadinessStatusBadge status={pillar.status} />
          <div className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4">
            <h4 className="text-[13px] font-medium text-(--cq-text-secondary)">
              {t("Evidence")}
            </h4>
            {pillar.evidence.length === 0 ? (
              <p className="text-sm text-(--cq-text-secondary)">
                {t("Nothing on record yet.")}
              </p>
            ) : (
              <ul className="flex flex-col">
                {pillar.evidence.map((line, index) => (
                  <li
                    key={`${line.label}-${String(index)}`}
                    className="flex justify-between gap-3 border-t border-(--cq-border-subtle) py-2 text-sm first:border-t-0"
                  >
                    <span className="text-(--cq-text-primary)">
                      {t(line.label)}
                    </span>
                    <span className="shrink-0 rounded-full bg-(--cq-surface-strong) px-2 py-0.5 text-xs text-(--cq-text-secondary)">
                      {t(evidenceTag(line))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4">
            <h4 className="text-[13px] font-medium text-(--cq-text-secondary)">
              {t("What would move it")}
            </h4>
            {pillar.improve.length === 0 ? (
              <p className="text-sm text-(--cq-text-secondary)">
                {t("Nothing expected is missing here.")}
              </p>
            ) : (
              <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-(--cq-text-secondary)">
                {pillar.improve.map((line) => (
                  <li key={line}>{t(line)}</li>
                ))}
              </ul>
            )}
          </div>
        </CrmSheet>
      )}
    </div>
  );
}
