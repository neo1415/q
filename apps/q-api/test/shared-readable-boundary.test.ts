import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR 0078 (owner decision 99, "shared means readable"): a highly
 * confidential document a founder shared with one investor is readable by
 * that investor's Q through the chat read tools only. The share lookup
 * must never feed ranking, discovery, recommendation features, retrieval
 * or knowledge/memory writes, so it may be called from exactly one place:
 * the chat tools' document reads in the Q API composition. A new caller
 * is a new disclosure path and needs its own decision.
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx|mts)$/u.test(entry.name)) out.push(path);
  }
  return out;
}

const all = ["apps", "packages"].flatMap((top) =>
  readdirSync(join(ROOT, top), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return sources(join(ROOT, top, entry.name, "src"));
      } catch {
        return [];
      }
    }),
);

const using = (pattern: RegExp) =>
  all
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(ROOT, path))
    .sort();

describe("shared means readable stays on the chat read path (ADR 0078)", () => {
  it("only the Q API's chat document reads ask for a share", () => {
    expect(using(/\bqReadableShare\b/u)).toEqual([
      // Named in its comment only (the port it is given).
      "apps/q-api/src/composition/material-documents.ts",
      "apps/q-api/src/main.ts",
      "packages/permissions/src/application/data-room.ts",
    ]);
    const main = readFileSync(join(ROOT, "apps/q-api/src/main.ts"), "utf8");
    expect(main.match(/\bsharedGrant:/gu)?.length).toBe(1);
  });

  it("no ranking, discovery, retrieval or memory code reads shared material", () => {
    const leaks = using(
      /\bsharedUnder\b|\bqReadableShare\b|\bsharedGrant\b/u,
    ).filter((path) =>
      /^packages\/(discovery|q-knowledge|q-memory|q-embeddings|q-firewall|founder-onboarding|companies|investors)\//u.test(
        path,
      ),
    );
    expect(leaks).toEqual([]);
  });
});
