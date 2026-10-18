#!/usr/bin/env node
/**
 * Writes docs/flagship/<slug>/video/captions.srt from the plan's script.
 *
 * Timings are estimates at 2.5 spoken words per second (the same rate
 * render.mjs budgets with), with a short pause after each sentence. Retime
 * against the real Tavus render in post; the words must not change, because
 * they are the script that was reviewed.
 *
 *   node scripts/seed/flagship/tavus/captions.mjs kuuza songscribe
 *   node scripts/seed/flagship/tavus/captions.mjs --all
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FLAGSHIP = resolve(here, "../../../../docs/flagship");
const WORDS_PER_SECOND = 2.5;
const LEAD_IN = 0.3;
const SENTENCE_PAUSE = 0.2;
const MAX_WORDS = 12;
const MAX_LINE = 42;

const args = process.argv.slice(2);
const slugs = args.includes("--all")
  ? readdirSync(FLAGSHIP).filter((d) =>
      existsSync(join(FLAGSHIP, d, "video", "plan.json")),
    )
  : args.filter((a) => !a.startsWith("--"));

/** Splits a sentence into cues of at most MAX_WORDS, preferring commas. */
function cues(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const out = [];
  let current = [];
  for (const [i, word] of words.entries()) {
    current.push(word);
    const left = words.length - i - 1;
    const atComma = /[,:;]$/.test(word) && current.length >= 5 && left >= 3;
    if (current.length >= MAX_WORDS || atComma) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    // Fold a tiny tail into the previous cue rather than flash two words.
    if (current.length < 3 && out.length > 0)
      out[out.length - 1].push(...current);
    else out.push(current);
  }
  return out;
}

function wrap(words) {
  const text = words.join(" ");
  if (text.length <= MAX_LINE) return text;
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const bBest = words.slice(best).join(" ").length;
    const aBest = words.slice(0, best).join(" ").length;
    if (Math.max(a, b) < Math.max(aBest, bBest)) best = i;
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

for (const slug of slugs) {
  const plan = JSON.parse(
    readFileSync(join(FLAGSHIP, slug, "video", "plan.json"), "utf8"),
  );
  const raw = plan.script.trim().match(/[^.!?]+[.!?]+/g) ?? [plan.script];
  // A one- or two-word sentence ("Hello.") rides with the next one.
  const sentences = [];
  let carry = "";
  for (const s of raw) {
    const joined = `${carry} ${s.trim()}`.trim();
    if (joined.split(/\s+/).length < 3) carry = joined;
    else {
      sentences.push(joined);
      carry = "";
    }
  }
  if (carry) sentences.push(carry);
  let t = LEAD_IN;
  let n = 0;
  const blocks = [];
  for (const sentence of sentences) {
    for (const cue of cues(sentence.trim())) {
      const end = t + cue.length / WORDS_PER_SECOND;
      blocks.push(`${++n}\n${stamp(t)} --> ${stamp(end)}\n${wrap(cue)}\n`);
      t = end;
    }
    t += SENTENCE_PAUSE;
  }
  const file = join(FLAGSHIP, slug, "video", "captions.srt");
  writeFileSync(file, `${blocks.join("\n")}`);
  console.log(`${slug}: ${n} cues, ends ≈${t.toFixed(1)} s → ${file}`);
}
