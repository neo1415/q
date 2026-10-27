"use client";

import { useReducedMotion } from "motion/react";

import { FileText } from "@capital-q/ui/icons";

/**
 * A document dropped in while talking, as it is read (owner 2026-10-27:
 * "you can even see like a skeleton of the document itself being read").
 *
 * One compact card: the file's name, where it is (uploading, reading,
 * done), and a few placeholder lines that resolve into what Q found, or
 * into "nothing new" when the reading added nothing. The body has a fixed
 * height in every stage, so the stage does not jump when it resolves.
 * Reduced motion keeps the placeholder lines still.
 */

export type DocumentReadingStage =
  "UPLOADING" | "READING" | "DONE" | "NOTHING_NEW";

export type DocumentFinding = {
  readonly label: string;
  readonly value: string;
};

export type DocumentReadingCardProps = {
  readonly fileName: string;
  readonly stage: DocumentReadingStage;
  /** What the reading found, not confirmed yet; shown once it is DONE. */
  readonly found?: readonly DocumentFinding[] | undefined;
  /** Overrides the person's motion preference (tests). */
  readonly reducedMotion?: boolean | undefined;
};

export const DOCUMENT_READING_STAGE_LABELS: Readonly<
  Record<DocumentReadingStage, string>
> = {
  UPLOADING: "Uploading",
  READING: "Reading",
  DONE: "Done",
  NOTHING_NEW: "Nothing new",
};

/** Widths of the placeholder lines: a paragraph's shape, not a bar chart. */
const SKELETON_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-2/3"] as const;
/** At most this many findings fit the card's fixed body. */
const MAX_SHOWN = 3;

export function DocumentReadingCard({
  fileName,
  stage,
  found = [],
  reducedMotion,
}: DocumentReadingCardProps) {
  const preferReduced = useReducedMotion() === true;
  const still = reducedMotion ?? preferReduced;
  const working = stage === "UPLOADING" || stage === "READING";
  const shown = found.slice(0, MAX_SHOWN);
  const more = found.length - shown.length;

  return (
    <div
      className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3 text-start"
      data-document-reading={stage}
      aria-busy={working}
    >
      <div className="flex items-center gap-3">
        <FileText
          size={18}
          aria-hidden="true"
          className="flex-none text-(--cq-text-secondary)"
        />
        <span className="cq-body min-w-0 flex-1 truncate text-(--cq-text-primary)">
          {fileName}
        </span>
        <span
          role="status"
          aria-live="polite"
          className="cq-caption flex-none text-(--cq-text-secondary)"
          data-document-reading-stage
        >
          {DOCUMENT_READING_STAGE_LABELS[stage]}
        </span>
      </div>
      {/* Fixed height in every stage: resolving never moves the stage. */}
      <div className="h-20 overflow-hidden" data-document-reading-body>
        {working ? (
          <div
            aria-hidden="true"
            className="flex flex-col gap-2.5 pt-1"
            data-document-reading-skeleton={still ? "still" : "moving"}
          >
            {SKELETON_WIDTHS.map((width) => (
              <span
                key={width}
                className={
                  still
                    ? `block h-3 rounded-sm bg-(--cq-stage-surface) ${width}`
                    : `cq-skeleton h-3 rounded-sm ${width}`
                }
                data-skeleton-line
              />
            ))}
          </div>
        ) : stage === "NOTHING_NEW" || shown.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Nothing new for your setup.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-document-reading-found>
            {shown.map((item) => (
              <li
                key={`${item.label}:${item.value}`}
                className="cq-body-sm truncate text-(--cq-text-primary)"
              >
                <span className="text-(--cq-text-secondary)">
                  {item.label} ·{" "}
                </span>
                {item.value}
              </li>
            ))}
            {more > 0 ? (
              <li className="cq-caption text-(--cq-text-secondary)">
                and {String(more)} more, to confirm
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}
