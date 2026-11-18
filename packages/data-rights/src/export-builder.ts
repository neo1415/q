import type { DatabaseExecutor } from "@capital-q/database";

import {
  PERSONAL_DATA_INVENTORY,
  tableIdentifier,
  type InventoryEntry,
} from "./inventory.js";
import type { DataRightsObjectRef, DataRightsStorage } from "./ports.js";
import { buildZip, type ZipEntry } from "./zip.js";

/**
 * "Download my data" (decision 107): everything the person may see as
 * theirs, one JSON file per table, plus the files they uploaded.
 *
 * Only rows the inventory's predicate names as the person's own (their
 * profile, what they wrote, what was addressed to them) are read; a row is
 * never included because it is merely ABOUT them in another party's
 * private record (an investor's notes, Q's research on a counterparty).
 * Secrets never leave: tokens, hashes, ciphertext, embeddings and device
 * keys are dropped by column name before anything is serialised.
 */

export const EXPORT_LIMITS = {
  /** Rows per table; beyond it the manifest says the table was cut short. */
  rowsPerTable: 20_000,
  /** Uploaded files included; beyond it the manifest lists them as omitted. */
  files: 200,
  /** Bytes of uploaded files in all. */
  fileBytes: 400 * 1024 * 1024,
} as const;

/** Columns that carry credentials or machine internals, never personal content. */
const SECRET_COLUMN =
  /(token|secret|ciphertext|password|code_verifier|code_hash|_hash$|^hash$|sha256|embedding|_tsv$|p256dh|^auth$|endpoint|api_key|private_key)/u;

export function exportableColumn(column: string): boolean {
  return !SECRET_COLUMN.test(column);
}

export type ExportPerson = {
  readonly userId: string;
  /** Sign-in email, lower case; null when the auth account has none. */
  readonly email: string | null;
};

export type ExportManifest = {
  readonly format: "capital-q-data-export";
  readonly version: 1;
  readonly generatedAt: string;
  readonly tables: Readonly<Record<string, number>>;
  readonly truncatedTables: readonly string[];
  readonly files: number;
  readonly omittedFiles: number;
};

/** Turns a database value into plain JSON, binary dropped. */
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return "[binary omitted]";
  return value;
}

function cleanRow(
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (exportableColumn(column)) out[column] = jsonValue(value);
  }
  return out;
}

export function exportEntries(): readonly InventoryEntry[] {
  return PERSONAL_DATA_INVENTORY.filter(
    (entry) => entry.export === true && entry.person !== undefined,
  );
}

export type CollectedExport = {
  readonly tables: ReadonlyMap<string, readonly Record<string, unknown>[]>;
  readonly truncated: readonly string[];
  readonly account: Record<string, unknown>;
  readonly files: readonly {
    readonly object: DataRightsObjectRef;
    readonly name: string;
  }[];
};

/** Reads the person's rows. Read-only; run it in a read-only transaction. */
export async function collectPersonData(
  sql: DatabaseExecutor,
  person: ExportPerson,
): Promise<CollectedExport> {
  const tables = new Map<string, Record<string, unknown>[]>();
  const truncated: string[] = [];
  for (const entry of exportEntries()) {
    const where = entry.person;
    if (where === undefined) continue;
    const present = await sql<{ present: boolean }[]>`
      select to_regclass(${entry.table}) is not null as present`;
    if (present[0]?.present !== true) continue;
    const rows = await sql<Record<string, unknown>[]>`
      select * from ${tableIdentifier(sql, entry.table)}
       where ${where.build(sql, { userId: person.userId, email: person.email ?? "" })}
       limit ${EXPORT_LIMITS.rowsPerTable + 1}`;
    if (rows.length === 0) continue;
    if (rows.length > EXPORT_LIMITS.rowsPerTable) truncated.push(entry.table);
    tables.set(
      entry.table,
      rows.slice(0, EXPORT_LIMITS.rowsPerTable).map((row) => cleanRow(row)),
    );
  }
  const account: Record<string, unknown> = { email: person.email };

  // Their own uploads: clean files only (a blocked file is never handed out).
  const documents = await sql<
    { bucket: string; key: string; name: string; id: string }[]
  >`
    select v.storage_bucket as bucket, v.storage_key as key,
           v.original_filename as name, v.id
      from evidence.document_versions v
     where v.uploaded_by_user_id = ${person.userId}
       and v.malware_scan_status = 'CLEAN'
     order by v.uploaded_at
     limit ${EXPORT_LIMITS.files + 1}`;
  const pictures = await sql<{ key: string; id: string; kind: string }[]>`
    select object_key as key, id, kind
      from core.profile_images
     where subject_type = 'PERSON' and subject_id = ${person.userId}
       and status = 'READY' and object_key is not null`;
  const files = [
    ...pictures.map((picture) => ({
      object: { bucket: "cq-profile-images", key: picture.key },
      name: `profile/${picture.kind.toLowerCase()}-${picture.id}.webp`,
    })),
    ...documents.map((document) => ({
      object: { bucket: document.bucket, key: document.key },
      name: `documents/${document.id}-${safeFileName(document.name)}`,
    })),
  ];
  return { tables, truncated, account, files };
}

export function safeFileName(name: string | null | undefined): string {
  const cleaned = (name ?? "file")
    .normalize("NFKC")
    .replace(/[\\/<>:"|?*\p{Cc}]+/gu, "_")
    .replace(/^\.+/u, "_")
    .slice(0, 120);
  return cleaned === "" ? "file" : cleaned;
}

async function readAll(
  storage: DataRightsStorage,
  object: DataRightsObjectRef,
  budget: number,
): Promise<Uint8Array | null> {
  const stream = await storage.openObjectStream(object);
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of stream.body) {
    size += part.length;
    if (size > budget) return null;
    parts.push(part);
  }
  return new Uint8Array(Buffer.concat(parts));
}

const README = `Your Capital Q data

This archive holds the personal data Capital Q keeps about you as your own:
your account and profile, what you wrote and uploaded, your conversations
with Q and what Q remembers about you, and the records of your activity.

data/<area>/<table>.json   one file per kind of record, as JSON
files/                     the documents and pictures you uploaded
manifest.json              what is included, and anything left out

Records that also belong to other people are included only where you wrote
or sent them. Another party's private notes and Q's research about other
people are not included. Passwords, tokens and other security material are
never exported.

Questions: see the Privacy Policy, section 9.
`;

/** Builds the archive. Storage reads happen here, outside any transaction. */
export async function buildExportArchive(
  collected: CollectedExport,
  storage: DataRightsStorage,
  at: Date,
): Promise<{ readonly zip: Uint8Array; readonly manifest: ExportManifest }> {
  const entries: ZipEntry[] = [];
  const counts: Record<string, number> = {};
  const encode = (value: unknown) =>
    new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  entries.push({ path: "README.txt", data: new TextEncoder().encode(README) });
  entries.push({ path: "data/account.json", data: encode(collected.account) });
  for (const [table, rows] of collected.tables) {
    const [schema, name] = table.split(".");
    counts[table] = rows.length;
    entries.push({ path: `data/${schema}/${name}.json`, data: encode(rows) });
  }
  let fileBytes = 0;
  let included = 0;
  let omitted = 0;
  for (const file of collected.files) {
    if (included >= EXPORT_LIMITS.files) {
      omitted += 1;
      continue;
    }
    const bytes = await readAll(
      storage,
      file.object,
      EXPORT_LIMITS.fileBytes - fileBytes,
    ).catch(() => null);
    if (bytes === null) {
      omitted += 1;
      continue;
    }
    fileBytes += bytes.length;
    included += 1;
    entries.push({ path: `files/${file.name}`, data: bytes });
  }
  const manifest: ExportManifest = {
    format: "capital-q-data-export",
    version: 1,
    generatedAt: at.toISOString(),
    tables: counts,
    truncatedTables: collected.truncated,
    files: included,
    omittedFiles: omitted,
  };
  entries.push({ path: "manifest.json", data: encode(manifest) });
  return { zip: buildZip(entries, at), manifest };
}
