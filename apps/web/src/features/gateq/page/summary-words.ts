import { money } from "@/features/capital/money";

/**
 * A fact's summary as frozen. Dossiers frozen before 2026-10-16 wrote an
 * amount as "360000 USD"; it reads as the currency and grouped digits, the
 * way newer ones are written. Nothing else is changed.
 */
export function summaryWords(summary: string): string {
  const legacy = /^(\d+(?:\.\d{1,2})?) ([A-Z]{3})$/u.exec(summary.trim());
  return legacy?.[1] === undefined || legacy[2] === undefined
    ? summary
    : money(legacy[1], legacy[2]);
}
