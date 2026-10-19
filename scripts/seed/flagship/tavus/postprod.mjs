#!/usr/bin/env node
/**
 * Offline post-production for the four flagship Tavus renders.
 *
 *   node scripts/seed/flagship/tavus/postprod.mjs kuuza
 *   node scripts/seed/flagship/tavus/postprod.mjs all
 *
 * Input:  $FLAGSHIP_VIDEO_DIR/<slug>.mp4 (default /tmp/claude-0/acc/flagship/video)
 * Output: $FLAGSHIP_VIDEO_DIR/<slug>-feed.mp4, 1080x1920 (the Capital Q feed format)
 *         docs/flagship/<slug>/video/captions.final.srt (re-timed to the real speech)
 *
 * Layout (top to bottom): brand band with the company wordmark (0-200),
 * 4:5 centre crop of the presenter (200-1550), caption area (1550-1920).
 * Captions sit below the picture, so they can never cover the face. The
 * disclosure label "AI presenter · not the founder" is burned in for the
 * whole video, end card included. A 3 s brand end card with silent audio is
 * appended.
 *
 * Caption timing: the reviewed script (plan.json) is split into 6-9 word
 * cues. ffmpeg silencedetect finds the pauses in the real audio; cue times
 * map text position (by characters) onto voiced time only, so sentence ends
 * land in the presenter's real pauses. The words never change.
 *
 * No network, no provider calls: ffmpeg/ffprobe only.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FLAGSHIP = resolve(here, "../../../../docs/flagship");
const VIDEO_DIR =
  process.env.FLAGSHIP_VIDEO_DIR ?? "/tmp/claude-0/acc/flagship/video";
const WORK_DIR = join(VIDEO_DIR, ".postprod");
const FONTS_DIR = "/usr/share/fonts/opentype/inter";

const W = 1080;
const H = 1920;
const BAND = 200;
const CAM_H = 1350; // 4:5 picture
const END_CARD_SECONDS = 3;
const LABEL = "AI presenter · not the founder";

/**
 * Brand per company. Colours come from docs/flagship/<slug>/brand.json,
 * propositions and domains from research.md / storyboard.md. The wordmark is
 * set in Inter text (no logo files are used: none are licensed for reuse).
 */
const BRANDS = {
  kuuza: {
    name: "KUUZA AI",
    wordmark: [
      ["KUUZA", "#EFF6FC"],
      [" AI", "#E9273B"],
    ],
    bg: "#131313",
    accent: "#E9273B",
    text: "#EFF6FC",
    proposition: "AI simulator and coach for sales, service and communication",
    domain: "kuuza.ai",
  },
  songscribe: {
    name: "SongScribe AI",
    wordmark: [
      ["SONG", "#E63946"],
      ["SCRIBE", "#FFFFFF"],
    ],
    bg: "#0A0A0A",
    accent: "#E63946",
    text: "#FFFFFF",
    proposition: "Your story, turned into a song",
    domain: "songscribe.ai",
  },
  "capital-q": {
    name: "Capital Q",
    wordmark: [
      ["Capital", "#FBFAF7"],
      [" Q", "#66A5FF"],
    ],
    bg: "#0B0D12",
    accent: "#66A5FF",
    text: "#FBFAF7",
    proposition: "AI-native investment intelligence for private capital",
    domain: "fdncapitalpartners.com/capitalq",
  },
  "zino-aviation": {
    name: "Zino Aviation",
    wordmark: [["ZINO AVIATION", "#B59B48"]],
    bg: "#141414",
    accent: "#B59B48",
    text: "#F6F4EF",
    proposition: "Pilot-career consultancy and private-aviation advisory",
    domain: "zinoaviation.com",
  },
};

const arg = process.argv[2];
if (!arg) {
  console.error("usage: postprod.mjs <slug|all>");
  process.exit(2);
}
const slugs = arg === "all" ? Object.keys(BRANDS) : [arg];
for (const slug of slugs)
  if (!BRANDS[slug]) throw new Error(`unknown slug ${slug}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(`${cmd} failed:\n${r.stderr.slice(-3000)}`);
  return r;
}

function probe(file) {
  const r = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate",
    "-of",
    "json",
    file,
  ]);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  return {
    duration: Number(j.format.duration),
    width: v.width,
    height: v.height,
    fps: v.r_frame_rate,
  };
}

/** Voiced intervals: [0, duration] minus silences of 0.25 s or more. */
function voiced(file, duration) {
  const r = run("ffmpeg", [
    "-nostats",
    "-i",
    file,
    "-af",
    "silencedetect=noise=-35dB:d=0.25",
    "-f",
    "null",
    "-",
  ]);
  const silences = [];
  let start = null;
  for (const m of r.stderr.matchAll(/silence_(start|end): ([0-9.]+)/g)) {
    if (m[1] === "start") start = Number(m[2]);
    else if (start !== null) {
      silences.push([start, Number(m[2])]);
      start = null;
    }
  }
  if (start !== null) silences.push([start, duration]);
  const out = [];
  let t = 0;
  for (const [a, b] of silences) {
    if (a > t) out.push([t, a]);
    t = Math.max(t, b);
  }
  // Ignore a sliver of "voice" after the final pause (encoder tail).
  if (duration - t > 0.15) out.push([t, duration]);
  return out;
}

/** Maps a fraction of voiced time (0..1) to a media timestamp. */
function timeAt(segments, fraction) {
  const total = segments.reduce((s, [a, b]) => s + (b - a), 0);
  let left = fraction * total;
  for (const [a, b] of segments) {
    if (left <= b - a + 1e-9) return a + left;
    left -= b - a;
  }
  return segments.at(-1)[1];
}

/** Splits the script into 6-9 word cues, preferring punctuation breaks. */
function cueWords(script) {
  let sentences = (script.trim().match(/[^.!?]+[.!?]+/g) ?? [script]).map((s) =>
    s.trim().split(/\s+/),
  );
  // Short sentences ride with a neighbour so no cue flashes two words.
  const merged = [];
  for (const s of sentences) {
    const prev = merged.at(-1);
    if (prev && prev.length < 6) prev.push(...s);
    else merged.push([...s]);
  }
  if (merged.length > 1 && merged.at(-1).length < 6)
    merged.at(-2).push(...merged.pop());
  sentences = merged;

  const cues = [];
  for (const words of sentences) {
    const k = Math.ceil(words.length / 9);
    const size = words.length / k;
    let from = 0;
    for (let i = 1; i <= k; i++) {
      let to = i === k ? words.length : Math.round(size * i);
      if (i < k) {
        // Nudge a boundary onto a nearby comma when the cue stays 6-9 words.
        for (const d of [0, 1, -1, 2, -2]) {
          const j = to + d;
          const len = j - from;
          if (
            len >= 6 &&
            len <= 9 &&
            words.length - j >= 6 &&
            /[,:;]$/.test(words[j - 1])
          ) {
            to = j;
            break;
          }
        }
      }
      cues.push(words.slice(from, to));
      from = to;
    }
  }
  return cues;
}

/** Balanced line wrap at ~30 characters per line. */
function wrap(words, max = 30) {
  const text = words.join(" ");
  const lines = Math.max(1, Math.ceil(text.length / max));
  if (lines === 1) return [text];
  const target = text.length / lines;
  const out = [];
  let cur = [];
  for (const w of words) {
    const next = [...cur, w].join(" ");
    if (cur.length && next.length > target + 4 && out.length < lines - 1) {
      out.push(cur.join(" "));
      cur = [w];
    } else cur.push(w);
  }
  out.push(cur.join(" "));
  return out;
}

const srtStamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const assStamp = (s) => {
  const cs = Math.round(s * 100);
  const p = (n) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360_000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};
/** #RRGGBB -> ASS &HAABBGGRR (alpha 00 = opaque). */
const assColour = (hex, alpha = 0) => {
  const h = hex.replace("#", "");
  const hx = (n) => n.toString(16).toUpperCase().padStart(2, "0");
  return `&H${hx(alpha)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const assText = (s) => s.replace(/[{}]/g, "").replace(/\\/g, "");

function buildAss(brand, cues, mainSeconds, totalSeconds) {
  const box = assColour("#000000", 0x55); // ~67% opaque black
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter SemiBold,54,&H00FFFFFF,&H00FFFFFF,${box},${box},0,0,0,0,100,100,0,0,3,14,0,8,64,64,1598,1
Style: Wordmark,Inter,76,${assColour(brand.text)},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,5,0,0,0,1
Style: Label,Inter Medium,30,&H00F2F2F2,&H00FFFFFF,${assColour("#000000", 0x40)},${assColour("#000000", 0x40)},0,0,0,0,100,100,0,0,3,8,0,1,48,48,40,1
Style: EndName,Inter,104,${assColour(brand.text)},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: EndLine,Inter,52,${assColour(brand.text)},&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,96,96,0,1
Style: EndDomain,Inter SemiBold,46,${assColour(brand.accent)},&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const mark = brand.wordmark
    .map(([t, c]) => `{\\c${assColour(c)}}${assText(t)}`)
    .join("");
  ev.push(
    `Dialogue: 0,${assStamp(0)},${assStamp(mainSeconds)},Wordmark,,0,0,0,,{\\pos(${W / 2},${BAND / 2})}${mark}`,
  );
  ev.push(
    `Dialogue: 1,${assStamp(0)},${assStamp(totalSeconds + 1)},Label,,0,0,0,,{\\an1\\pos(48,1872)}${LABEL}`,
  );
  for (const c of cues) {
    ev.push(
      `Dialogue: 0,${assStamp(c.start)},${assStamp(c.end)},Caption,,0,0,0,,${c.lines.map(assText).join("\\N")}`,
    );
  }
  const e0 = assStamp(mainSeconds);
  const e1 = assStamp(totalSeconds + 1);
  ev.push(
    `Dialogue: 0,${e0},${e1},EndName,,0,0,0,,{\\pos(${W / 2},800)}${mark}`,
  );
  ev.push(
    `Dialogue: 0,${e0},${e1},EndLine,,0,0,0,,{\\an8\\pos(${W / 2},920)}${wrap(brand.proposition.split(" "), 30).map(assText).join("\\N")}`,
  );
  ev.push(
    `Dialogue: 0,${e0},${e1},EndDomain,,0,0,0,,{\\pos(${W / 2},1200)}${assText(brand.domain)}`,
  );
  return header + ev.join("\n") + "\n";
}

mkdirSync(WORK_DIR, { recursive: true });
for (const slug of slugs) {
  const brand = BRANDS[slug];
  const input = join(VIDEO_DIR, `${slug}.mp4`);
  const output = join(VIDEO_DIR, `${slug}-feed.mp4`);
  const plan = JSON.parse(
    readFileSync(join(FLAGSHIP, slug, "video", "plan.json"), "utf8"),
  );
  const info = probe(input);
  const segments = voiced(input, info.duration);
  const speechEnd = segments.at(-1)[1];

  const words = cueWords(plan.script);
  const totalChars = words.reduce((s, w) => s + w.join(" ").length + 1, 0);
  let pos = 0;
  const cues = words.map((w) => {
    const len = w.join(" ").length + 1;
    const start = timeAt(segments, pos / totalChars);
    pos += len;
    const end = timeAt(segments, pos / totalChars);
    return { words: w, start, end, lines: wrap(w) };
  });
  // A cue that opens a new sentence starts when the voice resumes after the
  // nearest real pause (within 1.2 s), so captions follow the actual delivery.
  for (let i = 1; i < cues.length; i++) {
    if (!/[.!?]$/.test(cues[i - 1].words.at(-1))) continue;
    const t = cues[i].start;
    const resume = segments
      .slice(1)
      .map(([a]) => a)
      .sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
    if (
      resume !== undefined &&
      Math.abs(resume - t) <= 1.2 &&
      resume > cues[i - 1].start + 0.8 &&
      (i + 1 >= cues.length || resume < cues[i + 1].start - 0.8)
    )
      cues[i].start = resume;
  }
  // Hold each cue through the pause until the next one starts.
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = cues[i + 1].start;
  cues.at(-1).end = Math.min(info.duration, speechEnd + 0.4);

  const srt = cues
    .map(
      (c, i) =>
        `${i + 1}\n${srtStamp(c.start)} --> ${srtStamp(c.end)}\n${c.lines.join("\n")}\n`,
    )
    .join("\n");
  writeFileSync(join(FLAGSHIP, slug, "video", "captions.final.srt"), srt);

  const mainSeconds = info.duration;
  const totalSeconds = mainSeconds + END_CARD_SECONDS;
  if (totalSeconds > 60)
    throw new Error(`${slug}: ${totalSeconds}s exceeds 60 s`);
  const assFile = join(WORK_DIR, `${slug}.ass`);
  writeFileSync(assFile, buildAss(brand, cues, mainSeconds, totalSeconds));

  const bg = `0x${brand.bg.slice(1)}`;
  const accent = `0x${brand.accent.slice(1)}`;
  const graph = [
    `[0:v]crop=w=trunc(ih*4/5/2)*2:h=ih:x=(iw-ow)/2:y=0,scale=${W}:${CAM_H}:flags=lanczos,setsar=1,fps=25[cam]`,
    `color=c=${bg}:s=${W}x${H}:r=25:d=${mainSeconds.toFixed(3)}[bg]`,
    `[bg][cam]overlay=0:${BAND}:shortest=1,drawbox=x=0:y=${BAND - 4}:w=${W}:h=4:color=${accent}:t=fill,format=yuv420p[main]`,
    `color=c=${bg}:s=${W}x${H}:r=25:d=${END_CARD_SECONDS},drawbox=x=${W / 2 - 60}:y=1080:w=120:h=4:color=${accent}:t=fill,format=yuv420p[end]`,
    `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0]`,
    `anullsrc=r=48000:cl=stereo,atrim=duration=${END_CARD_SECONDS}[a1]`,
    `[main][a0][end][a1]concat=n=2:v=1:a=1[cv][ca]`,
    `[cv]ass=filename=${assFile}:fontsdir=${FONTS_DIR}[v]`,
  ].join(";");
  run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-map",
    "[ca]",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "slow",
    "-crf",
    "21",
    "-maxrate",
    "4M",
    "-bufsize",
    "8M",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    output,
  ]);
  const out = probe(output);
  console.log(
    `${slug}: ${output} ${out.width}x${out.height} ${out.duration.toFixed(2)}s, ${cues.length} cues, speech ends ${speechEnd.toFixed(2)}s`,
  );
}
