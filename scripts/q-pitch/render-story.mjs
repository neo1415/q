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
 *     [--beats 1,2,3] [--voice pFZP5JQG7iQjIQuC4Bku] [--model eleven_v4_turbo]
 *     [--usd-per-1k 0.30] [--max-chars 7000] [--format mp3_44100_96]
 *     [--out apps/web/public/story-media] [--align-only]
 *     [--max-gap beat-26:1200]
 *
 * Timings are measured, never predicted: v3's own /with-timestamps
 * alignment drifts by up to a second around tags and pauses (measured
 * 2026-10-21 against speech-to-text: beat 31 "Weak" 1.06 s early, beat 17
 * "Go" placed before the chuckle), so every beat's audio is re-timed with
 * ElevenLabs forced alignment against its verbatim words. --align-only
 * re-times the audio already on disk without rendering (no characters
 * spent). --max-gap shortens the longest silence in a beat to the planned
 * length (ffmpeg, audio cut in the middle of the silence) before it is
 * timed: v3's [long pause] is about 2.6 s where the plan asks 1.2 s.
 *
 * The key is read from ELEVENLABS_API_KEY or ELEVEN_LABS_API_KEY (the
 * same names packages/config resolveElevenLabsApiKey accepts) and is never
 * printed or written.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const alignOnly = process.argv.includes("--align-only");
const maxGap = new Map(
  (option("max-gap", "") ?? "")
    .split(",")
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [id, ms] = entry.split(":");
      return [id, Number(ms)];
    }),
);
// The story's narrator ("Lily", the owner's pick from the voice A/B,
// 2026-10-22); apps/web story-preload STORY_VOICE reads the same folder.
const voice = option("voice", "pFZP5JQG7iQjIQuC4Bku");
// v4 turbo (owner's choice, 2026-10-22): measured on the story it performs
// the audio tags (STT hears the sighs, chuckles and laughs; no tag is read
// aloud) at half v3's credit rate. v3 conversational is the fallback if
// the with-timestamps endpoint refuses it.
const models = option(
  "model",
  "eleven_v4_turbo,eleven_v3_conversational",
).split(",");
const usdPer1k = Number(option("usd-per-1k", "0.30"));
const maxChars = Number(option("max-chars", "7000"));
const only = option("beats", null);
// Marketing narration, committed: mono mp3 kept small (owner: 64-96 kbps).
const format = option("format", "mp3_44100_96");
if (!/^mp3_\d+_\d+$/u.test(format)) throw new Error("not an mp3 output format");
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
if (dryRun || alignOnly) {
  if (alignOnly) console.log("--align-only: no characters are spent.");
}
if (dryRun) {
  for (const { beat, text } of texts) console.log(`${beat.id}  ${text}`);
  process.exit(0);
}
if (!alignOnly && chars > maxChars) {
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

const outDir = path.resolve(
  option("out", path.join(root, "apps/web/public/story-media")),
  voice,
);
await mkdir(outDir, { recursive: true });
const indexPath = path.join(outDir, "index.json");
const previous = await readFile(indexPath, "utf8")
  .then((raw) => JSON.parse(raw))
  .catch(() => ({ beats: {} }));

async function render(text, model) {
  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps`,
  );
  url.searchParams.set("output_format", format);
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

/** ElevenLabs forced alignment: the audio's timing for the verbatim text. */
async function forcedAlignment(audio, text) {
  const form = new FormData();
  form.set("file", new Blob([audio], { type: "audio/mpeg" }), "beat.mp3");
  form.set("text", text);
  const response = await fetch(
    "https://api.elevenlabs.io/v1/forced-alignment",
    { method: "POST", headers: { "xi-api-key": key }, body: form },
  );
  if (!response.ok) {
    throw new Error(
      `forced alignment ${String(response.status)} ${(await response.text()).slice(0, 300)}`,
    );
  }
  const body = await response.json();
  return {
    loss: typeof body.loss === "number" ? body.loss : null,
    characters: ElevenLabsAlignmentSchema.parse({
      characters: body.characters.map((c) => c.text),
      character_start_times_seconds: body.characters.map((c) => c.start),
      character_end_times_seconds: body.characters.map((c) => c.end),
    }),
  };
}

function audioMs(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Math.round(Number(out.trim()) * 1000);
}

/** Cuts the middle of the beat's longest inter-word silence down to `targetMs`. */
function clampGap(file, words, targetMs) {
  let at = -1;
  let gap = 0;
  for (let i = 1; i < words.length; i += 1) {
    const g = words[i].startMs - words[i - 1].endMs;
    if (g > gap) {
      gap = g;
      at = i;
    }
  }
  if (at === -1 || gap <= targetMs) return 0;
  const cut = gap - targetMs;
  const from = (words[at - 1].endMs + targetMs / 2) / 1000;
  const to = from + cut / 1000;
  const tmp = `${file}.tmp.mp3`;
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    file,
    "-af",
    `aselect='not(between(t,${from.toFixed(3)},${to.toFixed(3)}))',asetpts=N/SR/TB`,
    "-ac",
    "1",
    "-b:a",
    `${format.split("_")[2]}k`,
    tmp,
  ]);
  execFileSync("mv", [tmp, file]);
  return cut;
}

let spentChars = 0;
let model = previous.model ?? models[0];
if (!alignOnly) model = models[0];
const rendered = { ...previous.beats };
for (const { beat, text } of texts) {
  const mp3 = path.join(outDir, `${beat.id}.mp3`);
  let entryModel = rendered[beat.id]?.model ?? model;
  let entryChars = rendered[beat.id]?.chars ?? 0;
  if (!alignOnly) {
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
    entryModel = model;
    entryChars = text.length;
    await writeFile(mp3, Buffer.from(result.body.audio_base64, "base64"));
  }
  // The verbatim words, without tags: what the audio must say.
  const verbatim = beat.words.join(" ");
  let timed;
  try {
    timed = await forcedAlignment(await readFile(mp3), verbatim);
    let cutMs = 0;
    const target = maxGap.get(beat.id);
    if (target !== undefined) {
      cutMs = clampGap(
        mp3,
        wordsFromCharacters(beat, timed.characters),
        target,
      );
      if (cutMs > 0)
        timed = await forcedAlignment(await readFile(mp3), verbatim);
    }
    timed.cutMs = cutMs;
  } catch (error) {
    // No measured timing: the beat is not shipped.
    console.error(`${beat.id}: ${String(error)}`);
    if (!alignOnly) await rm(mp3, { force: true });
    process.exitCode = 1;
    break;
  }
  // Throws when the timing does not spell the script: nothing is written.
  const words = wordsFromCharacters(beat, timed.characters);
  const durationMs = audioMs(mp3);
  const alignment = BeatAlignmentSchema.parse({
    beat: beat.n,
    voice,
    durationMs,
    words,
  });
  await writeFile(
    path.join(outDir, `${beat.id}.json`),
    `${JSON.stringify(alignment)}\n`,
  );
  rendered[beat.id] = {
    chars: entryChars,
    durationMs,
    model: entryModel,
    timing: "forced-alignment",
    alignmentLoss: timed.loss === null ? null : Number(timed.loss.toFixed(3)),
    ...(timed.cutMs > 0 ? { silenceCutMs: timed.cutMs } : {}),
  };
  console.log(
    `${beat.id}  ${String(entryChars)} chars  ${String(durationMs)} ms  loss ${String(rendered[beat.id].alignmentLoss)}${timed.cutMs > 0 ? `  cut ${String(timed.cutMs)} ms` : ""}`,
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
