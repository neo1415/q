#!/usr/bin/env node
/**
 * Q Story pictures (plan §3, #3 #7 #16 #22): curated once from Pexels and
 * stored as static files with their credit, so playback never fetches a
 * picture and never calls Pexels. Re-run only to change the selection.
 *
 *   PEXELS_API=... NODE_USE_ENV_PROXY=1 node scripts/q-pitch/curate-story-pictures.mjs
 *
 * Writes apps/web/public/story-media/pictures/<n>.jpg and
 * packages/q-pitch/src/story/pictures.ts (number, file, alt, credit).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const key = process.env.PEXELS_API ?? process.env.PEXELS_API_KEY;
if (!key || key.startsWith("disabled")) {
  console.error("PEXELS_API is not set");
  process.exit(1);
}

// Number → search. 1-12 the montage, 13 the desk at night, 14-17 the
// founder's years, 18-20 the established business.
const WANTED = [
  [1, "stock market trading screens", "Markets"],
  [2, "factory production line workers", "A factory floor"],
  [3, "science laboratory research", "A laboratory"],
  [4, "farm field harvest africa", "A farm"],
  [5, "city skyline aerial", "A city"],
  [6, "design studio team", "A studio"],
  [7, "shipping port containers", "A port"],
  [8, "solar panels field", "Solar energy"],
  [9, "small shop owner", "A shop"],
  [10, "hospital clinic medical", "A clinic"],
  [11, "software developers office", "A software team"],
  [12, "market vendor street", "A market"],
  [13, "laptop desk night dark", "A desk at night"],
  [14, "workshop craftsman building", "Years of building"],
  [15, "counting money cash hands", "Their own money in"],
  [16, "small team office meeting payroll", "Payroll day"],
  [17, "shop customer handshake", "A first customer"],
  [18, "warehouse logistics", "Logistics"],
  [19, "retail store interior", "Retail"],
  [20, "industrial factory exterior", "An established business"],
];

const outDir = path.join(root, "apps/web/public/story-media/pictures");
await mkdir(outDir, { recursive: true });
const used = new Set();
const entries = [];
for (const [n, query, alt] of WANTED) {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "8");
  url.searchParams.set("orientation", "landscape");
  const response = await fetch(url, { headers: { Authorization: key } });
  if (!response.ok) throw new Error(`Pexels ${response.status} for ${query}`);
  const body = await response.json();
  const photo = body.photos.find((p) => !used.has(p.id));
  if (!photo) throw new Error(`No photo for ${query}`);
  used.add(photo.id);
  const src = `${photo.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=750`;
  const image = await fetch(src);
  if (!image.ok) throw new Error(`Image ${image.status} for ${query}`);
  const file = `${String(n).padStart(2, "0")}.jpg`;
  await writeFile(
    path.join(outDir, file),
    Buffer.from(await image.arrayBuffer()),
  );
  entries.push({
    n,
    file: `/story-media/pictures/${file}`,
    alt,
    photographer: photo.photographer,
    source: photo.url,
  });
  console.log(n, photo.id, photo.photographer);
}

const ts = `/**
 * Q Story pictures, curated from Pexels by
 * scripts/q-pitch/curate-story-pictures.mjs (generated: do not edit by hand).
 * Free to use with credit; the credit shows under each picture on screen.
 * Static files only: the story never fetches a picture while it plays.
 */
export type StoryPicture = {
  readonly n: number;
  readonly file: string;
  readonly alt: string;
  readonly photographer: string;
  readonly source: string;
};

export const STORY_PICTURES: readonly StoryPicture[] = ${JSON.stringify(entries, null, 2)};

/** Pictures 1-12 tile the montage (#7). */
export const MONTAGE_PICTURES = STORY_PICTURES.filter((p) => p.n <= 12);

export function storyPicture(n: number): StoryPicture | null {
  return STORY_PICTURES.find((p) => p.n === n) ?? null;
}
`;
await writeFile(path.join(root, "packages/q-pitch/src/story/pictures.ts"), ts);
console.log("wrote", entries.length, "pictures");
