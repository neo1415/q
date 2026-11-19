import type {
  PipelineImportCounts,
  PipelineImportField,
  PipelineImportMapping,
  PipelineImportPreview,
  PipelineImportPreviewRow,
  PipelineImportResolution,
  PipelineImportStage,
  RelationshipMySideSummary,
  RelationshipSidePriority,
  RelationshipSideStage,
} from "@capital-q/contracts";

/**
 * The CRM import screen's reading of a prepared import (decision 106):
 * plain words for each field and stage, the column choices, the rows by
 * how they matched, and the person's choices for the rows Capital Q could
 * not settle alone. Pure; the screen and its tests share it.
 */

/**
 * A pipeline row's own-side line (decision 106 gaps): the reader's own
 * stage, priority and deal owner, each already in the reader's words
 * (`t`). Null when the side set none of them.
 */
export function mySideWords(
  mine: RelationshipMySideSummary | undefined,
  t: (english: string) => string,
): string | null {
  if (mine === undefined) return null;
  const parts = [
    mine.stage !== null
      ? t(SIDE_STAGE_WORDS[mine.stage])
      : (mine.stageLabel ?? null),
    mine.priority === null
      ? null
      : t(`${PRIORITY_WORDS[mine.priority]} priority`),
    mine.ownerName,
  ].filter((part): part is string => part !== null && part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Where a column can go, in the person's words, in the order offered. */
export const FIELD_WORDS: Readonly<Record<PipelineImportField, string>> = {
  counterpartName: "Name (company or investor)",
  website: "Website",
  stage: "Stage",
  stageDate: "Stage date",
  addedOn: "Date added",
  lastContactOn: "Last contact",
  contactName: "Contact name",
  contactEmail: "Contact email",
  contactTitle: "Contact title",
  owner: "Deal owner",
  source: "Source or introducer",
  amount: "Cheque or ticket size",
  currency: "Currency",
  valuation: "Valuation",
  round: "Round",
  sector: "Sector",
  location: "Location",
  priority: "Priority or tier",
  notes: "Notes",
  nextStep: "Next step",
  nextStepDue: "Next step due",
  passReason: "Pass reason",
  tags: "Tags",
};

export const IMPORT_STAGE_WORDS: Readonly<Record<PipelineImportStage, string>> =
  {
    RESEARCH: "Research",
    CONTACTED: "Contacted",
    MEETING: "Meeting",
    DILIGENCE: "Diligence",
    TERM_SHEET: "Term sheet",
    COMMITTED: "Committed",
    CLOSED: "Closed",
    PASSED: "Passed",
    PAUSED: "Paused",
    UNKNOWN: "Stage unclear",
  };

export const SIDE_STAGE_WORDS: Readonly<Record<RelationshipSideStage, string>> =
  {
    RESEARCH: "Research",
    CONTACTED: "Contacted",
    MEETING: "Meeting",
    DILIGENCE: "Diligence",
    TERM_SHEET: "Term sheet",
    COMMITTED: "Committed",
    CLOSED: "Closed",
    PASSED: "Passed",
    PAUSED: "Paused",
  };

export const PRIORITY_WORDS: Readonly<
  Record<RelationshipSidePriority, string>
> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

/** The value a column's choice carries when it is not imported. */
export const NOT_IMPORTED = "";

/** Each column's field, from the mapping ({field: column}). */
export function fieldByColumn(
  mapping: PipelineImportMapping,
): Readonly<Record<string, PipelineImportField>> {
  const out: Record<string, PipelineImportField> = {};
  for (const [field, column] of Object.entries(mapping) as [
    PipelineImportField,
    string | undefined,
  ][]) {
    if (column !== undefined) out[column] = field;
  }
  return out;
}

/**
 * The mapping with one column's choice changed. A field takes one column:
 * choosing a field another column held frees that column ("Not imported").
 */
export function assignColumn(
  mapping: PipelineImportMapping,
  column: string,
  field: PipelineImportField | typeof NOT_IMPORTED,
): Partial<Record<PipelineImportField, string>> {
  const next: Partial<Record<PipelineImportField, string>> = {};
  for (const [key, value] of Object.entries(mapping) as [
    PipelineImportField,
    string | undefined,
  ][]) {
    if (value === undefined || value === column || key === field) continue;
    next[key] = value;
  }
  if (field !== NOT_IMPORTED) next[field] = column;
  return next;
}

/** Whether the mapping can be read: one column must name the counterpart. */
export function mappingReady(
  mapping: Partial<Record<PipelineImportField, string>>,
): mapping is PipelineImportMapping {
  return typeof mapping.counterpartName === "string";
}

export function sameMapping(
  a: Partial<Record<PipelineImportField, string>>,
  b: Partial<Record<PipelineImportField, string>>,
): boolean {
  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
  ]) as Set<PipelineImportField>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

export type RowGroups = {
  readonly matched: readonly PipelineImportPreviewRow[];
  readonly ambiguous: readonly PipelineImportPreviewRow[];
  readonly new: readonly PipelineImportPreviewRow[];
  readonly invalid: readonly PipelineImportPreviewRow[];
};

export function groupRows(
  rows: readonly PipelineImportPreviewRow[],
): RowGroups {
  return {
    matched: rows.filter((row) => row.match === "MATCHED"),
    ambiguous: rows.filter((row) => row.match === "AMBIGUOUS"),
    new: rows.filter((row) => row.match === "NEW"),
    invalid: rows.filter((row) => row.match === "INVALID"),
  };
}

/** Why a row cannot be imported, in plain words. */
export function invalidReason(
  row: PipelineImportPreviewRow,
  side: "INVESTOR" | "COMPANY",
): string {
  return row.name === null
    ? side === "INVESTOR"
      ? "This row has no company name."
      : "This row has no investor name."
    : "This row can't be read.";
}

/**
 * The person's choice for an ambiguous row: one of its candidates, keep
 * it private, or skip it. A row with no choice is skipped (Capital Q never
 * picks between two real organisations on anyone's behalf).
 */
export type RowChoice = string | "KEEP_PRIVATE" | "SKIP";

export function resolutionsOf(
  choices: Readonly<Record<number, RowChoice>>,
  preview: Pick<PipelineImportPreview, "rows">,
): PipelineImportResolution[] {
  const ambiguous = new Map(
    preview.rows
      .filter((row) => row.match === "AMBIGUOUS")
      .map((row) => [row.rowNumber, row]),
  );
  const out: PipelineImportResolution[] = [];
  for (const [key, choice] of Object.entries(choices)) {
    const row = ambiguous.get(Number(key));
    if (row === undefined) continue;
    const valid =
      choice === "KEEP_PRIVATE" ||
      choice === "SKIP" ||
      row.candidates.some((candidate) => candidate.id === choice);
    if (valid) out.push({ rowNumber: row.rowNumber, choice });
  }
  return out.sort((a, b) => a.rowNumber - b.rowNumber);
}

/** How many rows the approval brings into the pipeline. */
export function importedCount(
  counts: PipelineImportCounts,
  resolutions: readonly PipelineImportResolution[],
): { readonly linked: number; readonly kept: number } {
  const chosen = resolutions.filter(
    (one) => one.choice !== "SKIP" && one.choice !== "KEEP_PRIVATE",
  ).length;
  const keptAmbiguous = resolutions.filter(
    (one) => one.choice === "KEEP_PRIVATE",
  ).length;
  return {
    linked: counts.matched + chosen,
    kept: counts.new + keptAmbiguous,
  };
}

/** The relationship page of a counterpart the import linked. */
export function linkHref(
  side: "INVESTOR" | "COMPANY",
  counterpartId: string,
): string {
  return side === "INVESTOR"
    ? `/relationships/company/${encodeURIComponent(counterpartId)}`
    : `/relationships/investor/${encodeURIComponent(counterpartId)}`;
}

/** Files the screen offers; the server's own reader decides. */
export const IMPORT_ACCEPT = ".csv,.xlsx,text/csv";

export function importFileProblem(file: {
  readonly name: string;
  readonly size: number;
}): string | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) {
    return "Choose a CSV or an Excel (.xlsx) file.";
  }
  if (file.size > 10 * 1024 * 1024) {
    return "That file is larger than 10 MB. Export fewer columns or rows.";
  }
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** "250000" as "250,000", exact (no float). */
export function groupedAmount(amount: string): string {
  const [whole = "", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
