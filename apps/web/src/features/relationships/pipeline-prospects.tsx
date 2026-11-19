"use client";

import type { PipelineProspect } from "@capital-q/contracts";
import { Badge } from "@capital-q/ui/badge";
import { Globe, ICON_SIZE, Lock } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { groupedAmount, IMPORT_STAGE_WORDS } from "./pipeline-import-model";
import { formatDay } from "@/components/date-format";

/**
 * Private prospects (decision 106, gap 7): the rows an organisation kept
 * from its imports because the counterpart is not on Capital Q. Its own
 * list, read only by its own members: never a canonical company or
 * investor, never shown to anyone it names. A null list: unavailable.
 */
export function PipelineProspects({
  side,
  prospects,
}: {
  readonly side: "INVESTOR" | "COMPANY";
  readonly prospects: readonly PipelineProspect[] | null;
}) {
  const t = useT();
  if (prospects === null) {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-state="unavailable"
      >
        {t("Your private prospects couldn't be read just now.")}
      </p>
    );
  }
  if (prospects.length === 0) {
    return (
      <p
        className="cq-body-sm rounded-(--cq-radius-md) bg-(--cq-surface-strong) px-4 py-3 text-(--cq-text-secondary)"
        data-prospects-empty
      >
        {side === "INVESTOR"
          ? t(
              "No private prospects yet. Companies in an imported file that aren't on Capital Q are kept here.",
            )
          : t(
              "No private prospects yet. Investors in an imported file that aren't on Capital Q are kept here.",
            )}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-tertiary)">
        <Lock size={ICON_SIZE.compact} aria-hidden="true" />
        {side === "INVESTOR"
          ? t("Only your firm sees this list.")
          : t("Only your company sees this list.")}
      </p>
      <ul
        className="flex flex-col divide-y divide-(--cq-border-subtle) overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
        data-prospects
      >
        {prospects.map((prospect) => (
          <li
            key={`${prospect.importId}:${String(prospect.rowNumber)}`}
            className="flex flex-col gap-1.5 px-4 py-3"
            data-prospect
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="cq-body font-medium break-words text-(--cq-text-primary)">
                {prospect.name}
              </span>
              {prospect.stageLabel === null ? null : (
                <Badge tone="neutral">
                  {prospect.stage !== null && prospect.stage !== "UNKNOWN"
                    ? t(IMPORT_STAGE_WORDS[prospect.stage])
                    : prospect.stageLabel}
                </Badge>
              )}
            </div>
            <div className="cq-body-sm flex flex-wrap gap-x-4 gap-y-1 text-(--cq-text-secondary)">
              {prospect.website === null ? null : (
                <span className="inline-flex items-center gap-1 break-all">
                  <Globe size={ICON_SIZE.compact} aria-hidden="true" />
                  {prospect.website}
                </span>
              )}
              {prospect.contactName === null ? null : (
                <span>{prospect.contactName}</span>
              )}
              {prospect.amount === null ? null : (
                <span className="cq-numeric">
                  {prospect.currency === null
                    ? groupedAmount(prospect.amount)
                    : `${prospect.currency} ${groupedAmount(prospect.amount)}`}
                </span>
              )}
              {prospect.priority === null ? null : (
                <span>{t(`Priority: ${prospect.priority}`)}</span>
              )}
              {prospect.source === null ? null : (
                <span>{t(`Source: ${prospect.source}`)}</span>
              )}
            </div>
            <p className="cq-caption text-(--cq-text-tertiary)">
              {t(
                `From ${prospect.fileName}, ${formatDay(prospect.importedAt)}`,
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
