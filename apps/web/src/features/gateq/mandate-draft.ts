import type { InvestorMandateDto } from "@capital-q/contracts";

/**
 * GateQ B2 (owner, 13 Nov: "Draft my GateQ rules with Q" from the investor's
 * authorised mandate). Their active Capital Q mandate, read as them, written
 * out in plain words for the rules editor -- the same text the deterministic
 * mandate reader already turns into DRAFT rules. Nothing is published from
 * it: the investor sees and can edit every word before Q drafts, then
 * reviews each proposed rule and publishes a version themselves.
 *
 * Only what the mandate states; nothing guessed. Codes are said as words
 * (an ISO country as its name, a sector code as its words).
 */
const STAGE_WORDS: Readonly<Record<string, string>> = {
  pre_seed: "pre-seed",
  seed: "seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
  growth: "growth",
};

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function words(vocabulary: string, code: string): string {
  if (/^[A-Z]{2}$/u.test(code) && /geo|country|region/iu.test(vocabulary)) {
    return countryNames?.of(code) ?? code;
  }
  return code.replace(/[_-]+/gu, " ").trim();
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

export function mandateDraftText(mandate: InvestorMandateDto): string {
  const lines: string[] = [];
  const from = mandate.minStageCode;
  const to = mandate.maxStageCode;
  const stage = (code: string | null) =>
    code === null ? null : (STAGE_WORDS[code] ?? code.replace(/_/gu, " "));
  if (from !== null && to !== null && from !== to) {
    lines.push(`We invest from ${stage(from)} to ${stage(to)} stage.`);
  } else if (from !== null || to !== null) {
    lines.push(`We invest at ${stage(from ?? to)} stage.`);
  }
  const range = mandate.chequeRange;
  if (range !== null) {
    const amount = (value: string | undefined) =>
      value === undefined
        ? null
        : `${range.currency} ${Number(value).toLocaleString("en-US")}`;
    const min = amount(range.min);
    const max = amount(range.max);
    if (min !== null && max !== null) {
      lines.push(`Our cheque is ${min} to ${max}.`);
    } else if (amount(range.typical) !== null) {
      lines.push(`Our typical cheque is ${amount(range.typical) ?? ""}.`);
    }
  }
  const byVocabulary = new Map<string, { in: string[]; out: string[] }>();
  for (const preference of mandate.taxonomyPreferences) {
    const entry = byVocabulary.get(preference.vocabularyCode) ?? {
      in: [],
      out: [],
    };
    (preference.isExclusion ? entry.out : entry.in).push(
      words(preference.vocabularyCode, preference.canonicalCode),
    );
    byVocabulary.set(preference.vocabularyCode, entry);
  }
  for (const [vocabulary, entry] of byVocabulary) {
    const what = vocabulary.replace(/[_-]+/gu, " ");
    if (entry.in.length > 0) lines.push(`${what}: ${list(entry.in)}.`);
    if (entry.out.length > 0)
      lines.push(`We do not invest in ${list(entry.out)}.`);
  }
  const thesis = mandate.rawMandateText?.trim() ?? "";
  if (thesis.length > 0) lines.push(thesis);
  return lines.join("\n").slice(0, 20_000);
}
