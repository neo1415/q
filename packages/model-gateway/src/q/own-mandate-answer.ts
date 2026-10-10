/**
 * "What is my mandate?" answered by code from the prepared `get_investor_mandate`
 * result (K6, live 2026-10-10: the recall cost a NORMAL_DIALOGUE round of
 * 8.4 s to say what was already in hand). The mandate is the person's own
 * declared record, so composing it is a read of that record, not a judgement:
 * no model, no tool. An undeclared field is stated as not stated; unknown is
 * never written as "any" or as zero.
 */

type Constraint = {
  readonly dimension?: string;
  readonly operator?: string;
  readonly value?: unknown;
  readonly isHardExclusion?: boolean;
};
type Preference = {
  readonly vocabularyCode?: string;
  readonly canonicalCode?: string;
  readonly isExclusion?: boolean;
};
type Mandate = {
  readonly status?: string;
  readonly cheque?: {
    readonly currency?: string;
    readonly min?: string;
    readonly typical?: string;
    readonly max?: string;
  } | null;
  readonly stage?: {
    readonly minStageCode?: string | null;
    readonly maxStageCode?: string | null;
  };
  readonly constraints?: readonly Constraint[];
  readonly taxonomyPreferences?: readonly Preference[];
};
type MandateRead = {
  readonly displayName?: string;
  readonly mandates?: readonly Mandate[];
};

const RECALL =
  /\b(?:what(?:'s|s| is| are| was)|tell me|show|remind me|recall|summari[sz]e|list|give me|read (?:me )?back)\b[^?.!]*\bmy\s+(?:(?:investment|declared|current)\s+)?(?:mandate|thesis|investment criteria|criteria|sectors|stages|cheque(?: size| range)?|check size|geography|exclusions)\b/iu;
// A question that needs judgement or a change, never a plain recall.
const NOT_RECALL =
  /\b(?:fit|fits|match|matches|suit|suits|compare|against|versus|vs|should|why|how|improve|better|score|rank|change|update|set|edit|add|remove|delete|replace|company|companies|founder|investor)\b/iu;

/** True for a short, plain request to read the person's own mandate back. */
export function asksForOwnMandate(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 160 &&
    RECALL.test(trimmed) &&
    !NOT_RECALL.test(trimmed)
  );
}

const words = (code: string): string => code.toLowerCase().replace(/_/g, " ");

function codesOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const read = value as { kind?: unknown; values?: unknown; text?: unknown };
  if (read.kind === "codes" && Array.isArray(read.values)) {
    return read.values.filter((v): v is string => typeof v === "string");
  }
  if (read.kind === "text" && typeof read.text === "string") return [read.text];
  return [];
}

const SECTOR_VOCABULARIES = new Set(["industry", "product_category"]);

/**
 * The mandate as plain sentences; null when nothing at all is declared (the
 * model path then answers as before).
 */
export function ownMandateAnswer(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const read = data as MandateRead;
  const mandate = read.mandates?.[0];
  if (mandate === undefined) return null;
  const constraints = mandate.constraints ?? [];
  const prefs = mandate.taxonomyPreferences ?? [];

  const isExcluding = (c: Constraint): boolean =>
    c.isHardExclusion === true ||
    c.operator === "NOT_IN" ||
    c.operator === "NEQ";
  const included = (dimension: string): string[] =>
    constraints
      .filter((c) => c.dimension === dimension && !isExcluding(c))
      .flatMap((c) => codesOf(c.value));
  const excludedBy = (dimension: string): string[] =>
    constraints
      .filter((c) => c.dimension === dimension && isExcluding(c))
      .flatMap((c) => codesOf(c.value));
  const prefIn = (vocab: (v: string) => boolean): string[] =>
    prefs
      .filter(
        (p) =>
          p.isExclusion !== true &&
          typeof p.canonicalCode === "string" &&
          vocab(p.vocabularyCode ?? ""),
      )
      .map((p) => p.canonicalCode as string);
  const unique = (list: string[]): string[] => [...new Set(list)].map(words);

  const sectors = unique([
    ...included("sector"),
    ...prefIn((v) => SECTOR_VOCABULARIES.has(v)),
  ]);
  const geography = unique([
    ...included("geography.country"),
    ...prefIn((v) => v === "geography"),
  ]);
  const role = unique(included("investment_role"));
  const stageCodes = unique(included("stage"));
  const exclusions = unique([
    ...excludedBy("sector"),
    ...excludedBy("geography.country"),
    ...excludedBy("business.attribute"),
    ...excludedBy("red_flag"),
    ...prefs
      .filter(
        (p) => p.isExclusion === true && typeof p.canonicalCode === "string",
      )
      .map((p) => p.canonicalCode as string),
  ]);

  const stage = mandate.stage ?? {};
  const stageLine =
    stage.minStageCode != null || stage.maxStageCode != null
      ? stage.minStageCode === stage.maxStageCode
        ? words(stage.minStageCode ?? "not stated")
        : `${words(stage.minStageCode ?? "not stated")} to ${words(stage.maxStageCode ?? "not stated")}`
      : stageCodes.length > 0
        ? stageCodes.join(", ")
        : null;

  const cheque = mandate.cheque ?? null;
  let chequeLine: string | null = null;
  if (
    cheque !== null &&
    typeof cheque.currency === "string" &&
    (cheque.min !== undefined ||
      cheque.max !== undefined ||
      cheque.typical !== undefined)
  ) {
    const range =
      cheque.min !== undefined && cheque.max !== undefined
        ? `${cheque.currency} ${cheque.min} to ${cheque.max}`
        : cheque.min !== undefined
          ? `from ${cheque.currency} ${cheque.min}`
          : cheque.max !== undefined
            ? `up to ${cheque.currency} ${cheque.max}`
            : null;
    const typical =
      cheque.typical === undefined
        ? null
        : `typically ${cheque.currency} ${cheque.typical}`;
    chequeLine = [range, typical].filter((p) => p !== null).join(", ");
  }

  const rows: [string, string | null][] = [
    ["Sectors", sectors.length > 0 ? sectors.join(", ") : null],
    ["Stages", stageLine],
    ["Geography", geography.length > 0 ? geography.join(", ") : null],
    ["Cheque size", chequeLine],
    ["Role", role.length > 0 ? role.join(", ") : null],
    ["Exclusions", exclusions.length > 0 ? exclusions.join(", ") : null],
  ];
  if (rows.every(([, value]) => value === null)) return null;
  const draft =
    mandate.status === "DRAFT" ? " It is still a draft, so it may change." : "";
  const lines = rows.map(
    ([label, value]) => `- ${label}: ${value ?? "not stated yet"}`,
  );
  const count = read.mandates?.length ?? 0;
  const more =
    count > 1 ? ` You have ${count} mandates; this is the first.` : "";
  const whose = read.displayName ? ` for ${read.displayName}` : "";
  return `Here is the mandate you have declared${whose}.${draft}${more}\n\n${lines.join("\n")}\n\nAnything marked not stated yet is open, not a limit. Tell me what to add or change and I will prepare it for your approval.`;
}
