// Writes the synthetic evidence files for the three showcase companies
// (Tensorgate, Halyard Security, Nixo) and the five compact packs (MedTrail,
// Mizan, Ajopot, Watchly, Maji Loop) into scripts/seed/evidence/out/<company>/
// (gitignored), and checks or rewrites the committed manifests.
//
//   node scripts/seed/evidence/generate.mjs                 write files, check manifests
//   node scripts/seed/evidence/generate.mjs --write-manifest  also rewrite manifests
//
// Local and offline: no upload, no database, no network, no model call.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildManifest,
  FIXTURE_KEYS,
  loadFixture,
  MANIFEST_DIR,
} from "./documents.mjs";
import {
  buildCompactManifest,
  COMPACT_KEYS,
  loadCompactFixture,
} from "./compact.mjs";
import { loadPdfLib, renderCompany } from "./render.mjs";

const OUT = new URL("./out/", import.meta.url).pathname;
const writeManifest = process.argv.includes("--write-manifest");
const pdfLib = await loadPdfLib();
let stale = 0;

const packs = [
  ...FIXTURE_KEYS.map((key) => ({
    key,
    fx: loadFixture(key),
    build: buildManifest,
  })),
  ...COMPACT_KEYS.map((key) => ({
    key,
    fx: loadCompactFixture(key),
    build: buildCompactManifest,
  })),
];
for (const { key, fx, build } of packs) {
  const { docs, files } = await renderCompany(fx, pdfLib);
  const dir = join(OUT, key);
  mkdirSync(dir, { recursive: true });
  for (const { doc, bytes } of files)
    writeFileSync(join(dir, doc.fileName), bytes);
  const manifest = `${JSON.stringify(build(fx, docs), null, 2)}\n`;
  writeFileSync(join(dir, "manifest.json"), manifest);
  const committed = join(MANIFEST_DIR, `${key}.json`);
  if (writeManifest) {
    mkdirSync(MANIFEST_DIR, { recursive: true });
    writeFileSync(committed, manifest);
  } else {
    let current;
    try {
      current = readFileSync(committed, "utf8");
    } catch {
      current = "";
    }
    if (current !== manifest) {
      stale += 1;
      console.error(
        `manifest out of date: ${committed} (run with --write-manifest)`,
      );
    }
  }
  console.log(`${key}: ${files.length} files in ${dir}`);
}
if (stale > 0) process.exit(1);
