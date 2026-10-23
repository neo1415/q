/* eslint-disable no-console -- a developer CLI whose whole purpose is to report what it wrote */
/**
 * `node --import ../../scripts/dev-env.mjs src/dev/sync-voice-catalog.ts`
 * (run from apps/q-api). DEV ONLY.
 *
 * Writes the persona voice catalog (src/voice/persona-voices/catalog-data.ts)
 * from every voice the ElevenLabs account behind ELEVENLABS_API_KEY can use:
 * the library voices added to it plus ElevenLabs' premade ones. The picker
 * reads only that file, so re-run this after adding or removing voices in
 * ElevenLabs, review the diff, and commit it. Ported from Kuuza's
 * app/scripts/sync_voice_catalog.py.
 *
 *   --from <catalog.json>   build from an exported catalog (Kuuza's
 *                           voice_catalog.json shape) instead of the API
 *   --source <label>        where an exported catalog came from (kept in the file)
 *   --shared <a,b,...>      2026-10-23: also merge the shared Voice Library's
 *                           most-used voices for these accent labels (both
 *                           genders) into the committed catalog. A library
 *                           voice speaks by id on Q's key without being added
 *                           to the account (checked 2026-10-23), so no slot
 *                           is used and nothing in the account changes
 *   --dry-run               print the counts, write nothing
 *
 * The key is read from the environment and sent only to ElevenLabs; it is
 * never printed and never written. Voice ids and labels are public.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveElevenLabsApiKey } from "@capital-q/config/q-api";

import type { CatalogVoice } from "../voice/persona-voices/catalog.js";
import {
  CATALOG_SOURCE,
  CATALOG_VOICES,
} from "../voice/persona-voices/catalog-data.js";

const OUT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../voice/persona-voices/catalog-data.ts",
);

/**
 * Q's own voices (elevenlabs-speak.ts VOICE_IDS) never voice a persona:
 * the person Q plays must never sound like Q.
 */
const Q_OWN_VOICES = new Set(["EXAVITQu4vr4xnSDxMaL", "onwK4e9ZLuTAKqWW03F9"]);

/** ElevenLabs age labels to the persona age groups. */
const AGE: Readonly<Record<string, CatalogVoice["ageGroup"]>> = {
  young: "young_adult",
  young_adult: "young_adult",
  middle_aged: "middle_aged",
  old: "senior",
  senior: "senior",
};

type Raw = Record<string, unknown>;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** One API voice (v2 /voices) or one exported record, as a catalog row. */
function record(raw: Raw): CatalogVoice | null {
  const id = typeof raw.voice_id === "string" ? raw.voice_id : raw.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9]{8,40}$/u.test(id)) return null;
  const labels =
    raw.labels !== null && typeof raw.labels === "object"
      ? (raw.labels as Raw)
      : raw;
  const verified = Array.isArray(raw.verified_languages)
    ? raw.verified_languages
    : [];
  const age = AGE[text(labels.age ?? raw.age_group)] ?? null;
  return {
    id,
    name: typeof raw.name === "string" ? raw.name.slice(0, 80) : id,
    category: text(raw.category) || "unknown",
    language: text(labels.language) || "en",
    accent: text(labels.accent),
    gender: text(labels.gender),
    ageGroup: age,
    verifiedLanguages: [
      ...new Set(
        verified
          .map((entry: unknown) =>
            typeof entry === "string"
              ? text(entry)
              : entry !== null && typeof entry === "object"
                ? text((entry as Raw).language)
                : "",
          )
          .filter((language: string) => language.length > 0),
      ),
    ].sort(),
  };
}

async function fromApi(apiKey: string): Promise<Raw[]> {
  const voices: Raw[] = [];
  let token: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("page_size", "100");
    if (token !== undefined) url.searchParams.set("next_page_token", token);
    const response = await fetch(url, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(
        `ElevenLabs refused the voice list (${String(response.status)})`,
      );
    }
    const body = (await response.json()) as Raw;
    if (Array.isArray(body.voices)) voices.push(...(body.voices as Raw[]));
    if (body.has_more !== true || typeof body.next_page_token !== "string") {
      return voices;
    }
    token = body.next_page_token;
  }
  return voices;
}

/** Library voices that would not sound like someone in a business meeting. */
const UNFIT =
  /sinister|seductive|sensual|hissing|whisper|meditat|asmr|villain|horror|creepy|cartoon|child|kid|sultry|erotic|dark/iu;

/** Per accent and gender, the library's most-used voices (public ids). */
const SHARED_PER_GENDER = 6;

async function fromShared(
  apiKey: string,
  accents: readonly string[],
): Promise<Raw[]> {
  const voices: Raw[] = [];
  for (const accent of accents) {
    for (const gender of ["male", "female"]) {
      const url = new URL("https://api.elevenlabs.io/v1/shared-voices");
      url.searchParams.set("page_size", String(SHARED_PER_GENDER));
      url.searchParams.set("accent", accent);
      url.searchParams.set("gender", gender);
      url.searchParams.set("sort", "usage_character_count_1y");
      const response = await fetch(url, {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(
          `ElevenLabs refused the shared voices (${String(response.status)})`,
        );
      }
      const body = (await response.json()) as Raw;
      const found = Array.isArray(body.voices) ? (body.voices as Raw[]) : [];
      console.log(`shared ${accent}/${gender}: ${String(found.length)}`);
      // Shared voices carry their labels at the top level. A persona is a
      // professional in a meeting: character, ASMR and villain voices out.
      voices.push(
        ...found
          .filter(
            (voice) =>
              !UNFIT.test(`${String(voice.name)} ${String(voice.descriptive)}`),
          )
          .map((voice) => ({ ...voice, category: "shared" })),
      );
    }
  }
  return voices;
}

function render(voices: readonly CatalogVoice[], source: string): string {
  const rows = voices.map((voice) => `  ${JSON.stringify(voice)},`).join("\n");
  return `// GENERATED by src/dev/sync-voice-catalog.ts — do not edit by hand.
// Source: ${source}. Public voice ids and labels only; no secrets.
import type { CatalogVoice } from "./catalog.js";

export const CATALOG_SOURCE =
  ${JSON.stringify(source)};

// One voice per line, so a re-sync's diff reads voice by voice.
// prettier-ignore
export const CATALOG_VOICES: readonly CatalogVoice[] = [
${rows}
];
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf("--from");
  const from = fromIndex === -1 ? undefined : args[fromIndex + 1];
  const dryRun = args.includes("--dry-run");
  const sharedIndex = args.indexOf("--shared");
  if (sharedIndex !== -1) {
    const accents = (args[sharedIndex + 1] ?? "")
      .split(",")
      .map((accent) => accent.trim())
      .filter((accent) => accent.length > 0);
    const apiKey = resolveElevenLabsApiKey(process.env);
    if (apiKey === undefined || apiKey.startsWith("disabled")) {
      throw new Error("ELEVENLABS_API_KEY is not set (or is disabled)");
    }
    const known = new Set(CATALOG_VOICES.map((voice) => voice.id));
    const added = (await fromShared(apiKey, accents))
      .map(record)
      .filter((voice): voice is CatalogVoice => voice !== null)
      .filter((voice) => !Q_OWN_VOICES.has(voice.id) && !known.has(voice.id))
      .filter(
        (voice, index, all) => all.findIndex((v) => v.id === voice.id) === index,
      );
    const merged = [...CATALOG_VOICES, ...added].sort((a, b) =>
      `${a.language}|${a.accent}|${a.id}`.localeCompare(
        `${b.language}|${b.accent}|${b.id}`,
      ),
    );
    const base = CATALOG_SOURCE.replace(/; shared library .*$/u, "");
    const source = `${base}; shared library (${accents.join(", ")}), ${new Date().toISOString().slice(0, 10)}`;
    console.log(
      `${String(added.length)} shared voices added, ${String(merged.length)} in all`,
    );
    for (const voice of added) {
      console.log(
        `  + ${voice.language}/${voice.accent}/${voice.gender}/${String(voice.ageGroup)} ${voice.name}`,
      );
    }
    if (dryRun) return;
    writeFileSync(OUT, render(merged, source));
    console.log(`wrote ${OUT}`);
    return;
  }
  let raws: Raw[];
  let source: string;
  if (from !== undefined) {
    raws = JSON.parse(readFileSync(from, "utf8")) as Raw[];
    const sourceIndex = args.indexOf("--source");
    const label =
      sourceIndex === -1
        ? "exported catalog"
        : (args[sourceIndex + 1] ?? "exported catalog");
    source = `${label}, ${new Date().toISOString().slice(0, 10)}`;
  } else {
    const apiKey = resolveElevenLabsApiKey(process.env);
    if (
      apiKey === undefined ||
      apiKey.length === 0 ||
      apiKey.startsWith("disabled")
    ) {
      throw new Error(
        "ELEVENLABS_API_KEY (or ELEVEN_LABS_API_KEY) is not set (or is a disabled test value)",
      );
    }
    raws = await fromApi(apiKey);
    source = `ElevenLabs account, ${new Date().toISOString().slice(0, 10)}`;
  }
  const voices = raws
    .map(record)
    .filter((voice): voice is CatalogVoice => voice !== null)
    .filter((voice) => !Q_OWN_VOICES.has(voice.id))
    .sort((a, b) =>
      `${a.language}|${a.accent}|${a.id}`.localeCompare(
        `${b.language}|${b.accent}|${b.id}`,
      ),
    );
  console.log(`${String(voices.length)} voices (${source})`);
  if (dryRun) return;
  writeFileSync(OUT, render(voices, source));
  console.log(`wrote ${OUT}`);
}

await main();
