import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  buildZip,
  exportableColumn,
  INVENTORY_SCHEMAS,
  inventoryCounts,
  KEPT_AFTER_DELETION,
  PERSONAL_DATA_INVENTORY,
  safeFileName,
} from "../src/index.js";

const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
);

/** Tables the migrations leave in the application schemas (create minus drop). */
function migratedTables(): Set<string> {
  const tables = new Set<string>();
  const schemas = new Set<string>(INVENTORY_SCHEMAS);
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(
      /--[^\n]*/gu,
      "",
    );
    for (const match of sql.matchAll(
      /\b(create|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?([a-z_]+)\.([a-z_0-9]+)/giu,
    )) {
      const [, verb, schema, name] = match;
      if (
        schema === undefined ||
        name === undefined ||
        !schemas.has(schema.toLowerCase())
      )
        continue;
      const table = `${schema.toLowerCase()}.${name.toLowerCase()}`;
      if (verb?.toLowerCase() === "create") tables.add(table);
      else tables.delete(table);
    }
  }
  return tables;
}

describe("the personal-data inventory", () => {
  it("classifies every table the migrations create, once, and nothing else", () => {
    const listed = PERSONAL_DATA_INVENTORY.map((entry) => entry.table);
    expect(new Set(listed).size).toBe(listed.length);
    const migrated = migratedTables();
    expect(
      [...migrated].filter((table) => !listed.includes(table)).sort(),
    ).toEqual([]);
    expect(listed.filter((table) => !migrated.has(table)).sort()).toEqual([]);
  });

  it("gives every kept class a reason, and every retained table a period", () => {
    for (const entry of PERSONAL_DATA_INVENTORY) {
      expect(entry.why.length, entry.table).toBeGreaterThan(10);
      if (entry.class === "RETAIN")
        expect(entry.retention, entry.table).toBeDefined();
      if (entry.class === "DELETE" && entry.special === undefined) {
        expect(entry.person, entry.table).toBeDefined();
      }
      if (entry.scrub !== undefined)
        expect(entry.person, entry.table).toBeDefined();
    }
    const counts = inventoryCounts();
    expect(
      counts.DELETE + counts.ANONYMISE + counts.RETAIN + counts.NOT_PERSONAL,
    ).toBe(PERSONAL_DATA_INVENTORY.length);
    expect(KEPT_AFTER_DELETION.length).toBeGreaterThanOrEqual(4);
  });

  it("never exports credentials or machine internals", () => {
    for (const column of [
      "refresh_token_ciphertext",
      "token_hash",
      "code_verifier_ciphertext",
      "content_sha256",
      "embedding",
      "content_tsv",
      "p256dh",
      "auth",
      "endpoint",
      "token",
    ]) {
      expect(exportableColumn(column), column).toBe(false);
    }
    for (const column of [
      "content",
      "body",
      "display_name",
      "email",
      "created_at",
    ]) {
      expect(exportableColumn(column), column).toBe(true);
    }
  });

  it("keeps uploaded file names inside the archive", () => {
    expect(safeFileName("../../etc/passwd")).not.toContain("/");
    expect(safeFileName("..hidden")).not.toMatch(/^\./u);
    expect(safeFileName(null)).toBe("file");
  });
});

describe("the archive", () => {
  it("writes a ZIP whose entries read back byte for byte", () => {
    const text = "Hello, data rights.\n".repeat(50);
    const zip = Buffer.from(
      buildZip([
        { path: "README.txt", data: new TextEncoder().encode(text) },
        {
          path: "data/q_runtime/conversations.json",
          data: new TextEncoder().encode("[]\n"),
        },
      ]),
    );
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
    const compressed = zip.readUInt32LE(18);
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString()).toBe("README.txt");
    expect(
      inflateRawSync(
        zip.subarray(30 + nameLength, 30 + nameLength + compressed),
      ).toString(),
    ).toBe(text);
  });

  it("refuses paths that escape the archive or repeat", () => {
    const data = new Uint8Array([1]);
    expect(() => buildZip([{ path: "../x", data }])).toThrow("ZIP_BAD_PATH");
    expect(() => buildZip([{ path: "/abs", data }])).toThrow("ZIP_BAD_PATH");
    expect(() =>
      buildZip([
        { path: "a", data },
        { path: "a", data },
      ]),
    ).toThrow("ZIP_BAD_PATH");
  });
});
