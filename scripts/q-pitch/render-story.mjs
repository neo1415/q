#!/usr/bin/env node
/**
 * Q Story pre-render (plan 2026-10-21 §1, Narrator): every beat, rendered
 * once with ElevenLabs text-to-speech WITH TIMESTAMPS, stored as static
 * audio plus word alignment under
 * apps/web/public/story-media/<voiceId>/beat-NN.{mp3,json} and an
 * index.json the web host reads to know the render exists.
 *
 * The words are the sealed beat table's (packages/q-pitch/src/story), with
 * the beat's v3 audio tags in place; each render's character alignment is
 * turned into one timing per verbatim word, and a render whose audio does
 * not spell the script is refused (nothing is written for it).
 *
 * Budget (owner): $3 total. The script counts characters before any call,
 * refuses more than --max-chars (default 7000, about one full take), and
 * writes the count and the estimated cost into index.json.
 *
 *   pnpm exec turbo run build --filter=@capital-q/q-pitch
 *   NODE_USE_ENV_PROXY=1 ELEVENLABS_API_KEY=... node scripts/q-pitch/render-story.mjs [--dry-run]
 *     [--beats 1,2,3] [--voice EXAVITQu4vr4xnSDxMaL] [--model eleven_v3]
 *     [--usd-per-1k 0.30] [--max-chars 7000]
 *
 * The key is read from ELEVENLABS_API_KEY or ELEVEN_LABS_API_KEY (the
 * same names packages/config resolveElevenLabsApiKey accepts) and is never
 * printed or written.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pitch = await import(
  path.join(root, "packages/q-pitch/dist/index.js")
).catch(() => {
  console.error(
    "Build the package first: pnpm exec turbo run build --filter=@capital-q/q-pitch",
  );
  process.exit(1);
});
const {
  STORY_BEATS,
  STORY_VERSION,
  BeatAlignmentSchema,
  ElevenLabsAlignmentSchema,
  renderText,
  wordsFromCharacters,
} = pitch;

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}
const dryRun = process.argv.includes("--dry-run");
// Q's own voice ("Sarah", apps/q-api elevenlabs-speak VOICE_IDS.FEMALE).
const voice = option("voice", "EXAVITQu4vr4xnSDxMaL");
// v3 is the model that honours audio tags. The conversational variant is
// what Q's live replies use; the with-timestamps endpoint is tried with it
// first and with the plain v3 model if it is refused.
const models = option("model", "eleven_v3_conversational,eleven_v3").split(",");
const usdPer1k = Number(option("usd-per-1k", "0.30"));
const maxChars = Number(option("max-chars", "7000"));
const only = option("beats", null);
const beats = STORY_BEATS.filter(
  (beat) => only === null || only.split(",").map(Number).includes(beat.n),
);
if (!/^[A-Za-z0-9]{8,40}$/u.test(voice)) throw new Error("not a voice id");

const texts = beats.map((beat) => ({ beat, text: renderText(beat) }));
const chars = texts.reduce((sum, { text }) => sum + text.length, 0);
const estimate = (chars / 1000) * usdPer1k;
console.log(
  `Q Story ${STORY_VERSION}: ${String(beats.length)} beats, ${String(chars)} characters, about $${estimate.toFixed(2)} at $${String(usdPer1k)}/1k`,
);
if (dryRun) {
  for (const { beat, text } of texts) console.log(`${beat.id}  ${text}`);
  process.exit(0);
}
if (chars > maxChars) {
  console.error(
    `Refused: ${String(chars)} characters is over --max-chars ${String(maxChars)} (budget guard).`,
  );
  process.exit(1);
}
const key = [process.env.ELEVENLABS_API_KEY, process.env.ELEVEN_LABS_API_KEY]
  .map((value) => value?.trim())
  .find((value) => value !== undefined && value.length > 0);
if (key === undefined || key.startsWith("disabled")) {
  console.error(
    "No ElevenLabs key (ELEVENLABS_API_KEY / ELEVEN_LABS_API_KEY). The story plays on fixture timings until a render exists.",
  );
  process.exit(1);
}

const outDir = path.join(root, "apps/web/public/story-media", voice);
await mkdir(outDir, { recursive: true });
const indexPath = path.join(outDir, "index.json");
const previous = await readFile(indexPath, "utf8")
  .then((raw) => JSON.parse(raw))
  .catch(() => ({ beats: {} }));

async function render(text, model) {
  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps`,
  );
  url.searchParams.set("output_format", "mp3_44100_128");
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: model,
      // Q's own settings (v3 takes stability 0, 0.5 or 1: "Natural").
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return { ok: false, status: response.status, detail };
  }
  return { ok: true, body: await response.json() };
}

let spentChars = 0;
let model = models[0];
const rendered = { ...previous.beats };
for (const { beat, text } of texts) {
  let result = await render(text, model);
  if (!result.ok && result.status === 400 && models.length > 1) {
    const next = models[models.indexOf(model) + 1];
    if (next !== undefined) {
      console.warn(`${model} refused (${result.detail}); trying ${next}`);
      model = next;
      result = await render(text, model);
    }
  }
  if (!result.ok) {
    console.error(
      `${beat.id}: ElevenLabs ${String(result.status)} ${result.detail}`,
    );
    process.exitCode = 1;
    break;
  }
  spentChars += text.length;
  const characters = ElevenLabsAlignmentSchema.parse(
    result.body.alignment ?? result.body.normalized_alignment,
  );
  // Throws when the audio does not spell the script: nothing is written.
  const words = wordsFromCharacters(beat, characters);
  const durationMs = Math.round(
    (characters.character_end_times_seconds.at(-1) ?? 0) * 1000,
  );
  const alignment = BeatAlignmentSchema.parse({
    beat: beat.n,
    voice,
    durationMs,
    words,
  });
  await writeFile(
    path.join(outDir, `${beat.id}.mp3`),
    Buffer.from(result.body.audio_base64, "base64"),
  );
  await writeFile(
    path.join(outDir, `${beat.id}.json`),
    `${JSON.stringify(alignment)}\n`,
  );
  rendered[beat.id] = { chars: text.length, durationMs, model };
  console.log(
    `${beat.id}  ${String(text.length)} chars  ${String(durationMs)} ms`,
  );
}

const totalChars = Object.values(rendered).reduce((s, b) => s + b.chars, 0);
await writeFile(
  indexPath,
  `${JSON.stringify(
    {
      version: STORY_VERSION,
      voice,
      model,
      beats: rendered,
      complete: STORY_BEATS.every((beat) => rendered[beat.id] !== undefined),
      ledger: {
        thisRunChars: spentChars,
        totalChars,
        usdPer1kEstimate: usdPer1k,
        thisRunUsdEstimate: Number(((spentChars / 1000) * usdPer1k).toFixed(2)),
      },
    },
    null,
    2,
  )}\n`,
);
console.log(
  `This run: ${String(spentChars)} characters, about $${((spentChars / 1000) * usdPer1k).toFixed(2)}.`,
);
