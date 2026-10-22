#!/usr/bin/env node
/**
 * Q Story media: content-hashed file names (immutable caching). Each beat's
 * audio and alignment are renamed `beat-NN.<sha256:10>.{mp3,json}` and
 * index.json lists the names under `files`, so a re-render gets new names
 * and a cached old clip can never play against a new script. index.json
 * itself keeps its name (it is the one file fetched fresh).
 *
 *   node scripts/q-pitch/hash-story-media.mjs [--voice EXAVITQu4vr4xnSDxMaL]
 *
 * Idempotent: an already hashed beat is re-hashed from its current file.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const at = process.argv.indexOf("--voice");
const voice = at === -1 ? "EXAVITQu4vr4xnSDxMaL" : process.argv[at + 1];
if (!/^[A-Za-z0-9]{8,40}$/u.test(voice ?? ""))
  throw new Error("not a voice id");
const dir = path.join(root, "apps/web/public/story-media", voice);

const indexPath = path.join(dir, "index.json");
const index = JSON.parse(await readFile(indexPath, "utf8"));
const names = await readdir(dir);
const files = {};
for (const id of Object.keys(index.beats).sort()) {
  const entry = {};
  for (const ext of ["mp3", "json"]) {
    const current = names.find((name) =>
      new RegExp(`^${id}(?:\\.[0-9a-f]{10})?\\.${ext}$`, "u").test(name),
    );
    if (current === undefined) throw new Error(`${id}.${ext} missing`);
    const bytes = await readFile(path.join(dir, current));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
    const next = `${id}.${hash}.${ext}`;
    if (next !== current)
      await rename(path.join(dir, current), path.join(dir, next));
    entry[ext === "mp3" ? "audio" : "alignment"] = next;
  }
  files[id] = entry;
}
index.files = files;
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`hashed ${String(Object.keys(files).length)} beats in ${dir}`);
