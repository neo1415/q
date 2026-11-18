import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PipelineImportStageSchema,
  canonicalJsonStringify,
  type PipelineImportCounts,
  type PipelineImportField,
  type PipelineImportMapping,
  type PipelineImportMatchStatus,
} from "@capital-q/contracts";

import { readStage } from "./columns.js";
import type { Sheet } from "./sheet.js";
import {
  currencyOf,
  dateOf,
  domainOf,
  emailDomainOf,
  emailOf,
  moneyOf,
  nameKey,
} from "./values.js";

/**
 * One row of an imported pipeline, read deterministically through the
 * mapping. Every typed value is the importer's own claim (USER_CLAIM in
 * ADR-001 terms): it is kept on their side, never written as a verified
 * fact about the counterpart.
 */
const Text = z.string().max(4000).optional();
const Day = z.iso.date().optional();
const Decimal = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .optional();

export const ImportRowFieldsSchema = z
  .object({
    stage: PipelineImportStageSchema.optional(),
    stageLabel: z.string().max(80).optional(),
    stageDate: Day,
    addedOn: Day,
    lastContactOn: Day,
    contactName: Text,
    contactEmail: Text,
    contactTitle: Text,
    owner: Text,
    source: Text,
    /** Exact decimal string. */
    amount: Decimal,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    valuation: Decimal,
    round: Text,
    sector: Text,
    location: Text,
    priority: Text,
    notes: Text,
    nextStep: Text,
    nextStepDue: Day,
    passReason: Text,
    tags: Text,
    /** Cells that were mapped but could not be read exactly, as written. */
    unread: z.record(z.string(), z.string().max(80)).optional(),
  })
  .strict();
export type ImportRowFields = z.infer<typeof ImportRowFieldsSchema>;

export type ImportRow = {
  readonly rowNumber: number;
  readonly name: string | null;
  readonly nameKey: string | null;
  readonly domain: string | null;
  readonly fields: ImportRowFields;
};

const TEXT_MAX = 300;
const NOTES_MAX = 4000;

function clip(value: string, max: number): string {
  const text = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function readRows(
  sheet: Sheet,
  mapping: PipelineImportMapping,
): readonly ImportRow[] {
  const column = new Map<PipelineImportField, number>();
  for (const [field, header] of Object.entries(mapping) as [
    PipelineImportField,
    string | undefined,
  ][]) {
    if (header === undefined) continue;
    const index = sheet.headers.indexOf(header);
    if (index !== -1) column.set(field, index);
  }
  const excelSerial = sheet.format === "XLSX";
  return sheet.rows.map((cells, index) => {
    const cell = (field: PipelineImportField): string => {
      const at = column.get(field);
      return at === undefined ? "" : (cells[at] ?? "").trim();
    };
    const fields: Record<string, unknown> = {};
    const unread: Record<string, string> = {};
    const text = (field: PipelineImportField, max = TEXT_MAX) => {
      const value = cell(field);
      if (value !== "") fields[field] = clip(value, max);
    };
    const date = (field: PipelineImportField) => {
      const value = cell(field);
      if (value === "") return;
      const read = dateOf(value, { excelSerial });
      if (read === null) unread[field] = clip(value, 80);
      else fields[field] = read;
    };

    const label = cell("stage");
    if (label !== "") {
      fields["stageLabel"] = clip(label, 80);
      fields["stage"] = readStage(label);
    }
    date("stageDate");
    date("addedOn");
    date("lastContactOn");
    date("nextStepDue");
    text("contactName");
    const email = cell("contactEmail");
    if (email !== "") {
      const read = emailOf(email);
      if (read === null) unread["contactEmail"] = clip(email, 80);
      else fields["contactEmail"] = read;
    }
    text("contactTitle");
    text("owner");
    text("source");
    const declared = currencyOf(cell("currency"));
    const amount = cell("amount");
    if (amount !== "") {
      const money = moneyOf(amount);
      if (money === null) {
        unread["amount"] = clip(amount, 80);
        if (declared !== null) fields["currency"] = declared;
      } else {
        fields["amount"] = money.amount;
        const currency = money.currency ?? declared;
        if (currency !== null) fields["currency"] = currency;
      }
    } else if (declared !== null) {
      fields["currency"] = declared;
    }
    const valuation = cell("valuation");
    if (valuation !== "") {
      const money = moneyOf(valuation);
      if (money === null) unread["valuation"] = clip(valuation, 80);
      else fields["valuation"] = money.amount;
    }
    text("round");
    text("sector");
    text("location");
    text("priority");
    text("notes", NOTES_MAX);
    text("nextStep");
    text("passReason");
    text("tags");
    if (Object.keys(unread).length > 0) fields["unread"] = unread;

    const rawName = cell("counterpartName");
    const name = rawName === "" ? null : clip(rawName, 200);
    const key = name === null ? null : nameKey(name);
    const domain =
      domainOf(cell("website")) ??
      (typeof fields["contactEmail"] === "string"
        ? emailDomainOf(fields["contactEmail"])
        : null);
    return {
      rowNumber: index + 1,
      name,
      nameKey: key === null || key === "" ? null : key,
      domain,
      fields: ImportRowFieldsSchema.parse(fields),
    };
  });
}

// --- matching -------------------------------------------------------------

/** A canonical party an authorised search found for some row. */
export type MatchCandidate = {
  readonly id: string;
  readonly name: string;
  readonly nameKey: string;
  readonly domain: string | null;
};

export type RowMatch = {
  readonly status: PipelineImportMatchStatus;
  readonly matchedId: string | null;
  /** At most five, for the importer to choose from. */
  readonly candidates: readonly MatchCandidate[];
};

/**
 * How one row matches: a website-domain match is the strongest key (one
 * firm per domain); otherwise the name. Exactly one: MATCHED. Several:
 * AMBIGUOUS, and the importer chooses (never Capital Q). None: NEW. A row
 * with no name is INVALID.
 */
export function classifyRow(
  row: ImportRow,
  candidates: readonly MatchCandidate[],
): RowMatch {
  if (row.nameKey === null) {
    return { status: "INVALID", matchedId: null, candidates: [] };
  }
  const byDomain =
    row.domain === null
      ? []
      : candidates.filter((candidate) => candidate.domain === row.domain);
  const byName = candidates.filter(
    (candidate) => candidate.nameKey === row.nameKey,
  );
  const unique = (list: readonly MatchCandidate[]) => [
    ...new Map(list.map((candidate) => [candidate.id, candidate])).values(),
  ];
  const domainHits = unique(byDomain);
  if (domainHits.length === 1 && domainHits[0] !== undefined) {
    return {
      status: "MATCHED",
      matchedId: domainHits[0].id,
      candidates: domainHits,
    };
  }
  const hits = unique(domainHits.length > 1 ? domainHits : byName);
  if (hits.length === 1 && hits[0] !== undefined) {
    return { status: "MATCHED", matchedId: hits[0].id, candidates: hits };
  }
  if (hits.length > 1) {
    return {
      status: "AMBIGUOUS",
      matchedId: null,
      candidates: hits
        .toSorted((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1,
        )
        .slice(0, 5),
    };
  }
  return { status: "NEW", matchedId: null, candidates: [] };
}

export type ProposedRow = ImportRow & { readonly match: RowMatch };

export function countRows(
  rows: readonly { readonly match: Pick<RowMatch, "status"> }[],
): PipelineImportCounts {
  const of = (status: PipelineImportMatchStatus) =>
    rows.filter((row) => row.match.status === status).length;
  return {
    rows: rows.length,
    matched: of("MATCHED"),
    ambiguous: of("AMBIGUOUS"),
    new: of("NEW"),
    invalid: of("INVALID"),
  };
}

/**
 * What the approval binds to: the side, the file version read, the mapping
 * and every row as prepared (its values and its match). A changed byte in
 * any of them is a different proposal.
 */
export function proposalHash(input: {
  readonly party: "INVESTOR" | "COMPANY";
  readonly partyId: string;
  readonly documentVersionId: string;
  readonly mapping: PipelineImportMapping;
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly name: string | null;
    readonly domain: string | null;
    readonly fields: unknown;
    readonly status: PipelineImportMatchStatus;
    readonly matchedId: string | null;
    readonly candidateIds: readonly string[];
  }[];
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonStringify({
        v: 1,
        party: input.party,
        partyId: input.partyId,
        documentVersionId: input.documentVersionId,
        mapping: input.mapping,
        rows: input.rows.map((row) => ({
          n: row.rowNumber,
          name: row.name,
          domain: row.domain,
          fields: row.fields,
          status: row.status,
          matchedId: row.matchedId,
          candidateIds: [...row.candidateIds],
        })),
      }),
    )
    .digest("hex");
}

/**
 * A stable id for something an import writes (a stage event's fingerprint,
 * a note, a board task), so importing the same row again finds what the
 * first import wrote instead of writing it twice. Shaped as a UUID because
 * the stores key on one.
 */
export function importFingerprint(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(canonicalJsonStringify(parts))
    .digest("hex");
}

export function fingerprintUuid(fingerprint: string): string {
  const hex = fingerprint.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20, 32)}`;
}
