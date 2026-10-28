"use client";

import {
  describeFigurePeriod,
  localFigureOf,
  type LocalFigureProvenance,
} from "@capital-q/founder-onboarding/local-figures/provenance";

import { useT, useUiLanguage } from "@/features/i18n/language";

/**
 * Owner decision 2026-10-28: a figure Capital Q's code read from the
 * founder's own highly confidential financial document, offered to keep,
 * change or refuse. The note says where it came from, for which period,
 * and that no model read the document. Provenance, never a badge.
 */

export function localFigureProvenance(suggestion: {
  readonly sourceRefs: readonly {
    readonly sourceType: string;
    readonly sourceId: string;
  }[];
}): LocalFigureProvenance | null {
  return localFigureOf(suggestion.sourceRefs);
}

function periodWords(figure: LocalFigureProvenance, language: string): string {
  const { period } = figure;
  if (period.granularity === "MONTH") {
    const [year = 0, month = 1] = period.key.split("-").map(Number);
    try {
      return new Intl.DateTimeFormat(language, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, 1)));
    } catch {
      return describeFigurePeriod(period);
    }
  }
  return describeFigurePeriod(period);
}

export function LocalFigureNote({
  figure,
}: {
  readonly figure: LocalFigureProvenance;
}) {
  const t = useT();
  const language = useUiLanguage();
  return (
    <span
      className="block cq-caption text-(--cq-text-secondary)"
      data-local-figure={figure.measure}
    >
      {t("From your financial document")} · {periodWords(figure, language)}
      {" · "}
      {t("Read by Capital Q's code. No model saw this document.")}
    </span>
  );
}
