/**
 * WebVTT to timed cues (R18), deterministically.
 *
 * Only what a transcript needs: each cue's start, end and text. Cue
 * identifiers, settings, NOTE/STYLE/REGION blocks and inline tags are
 * dropped. A malformed cue is skipped rather than guessed at; a file with
 * no parseable cue is an empty transcript, and the caller treats that as
 * no transcript at all -- unknown, never "nothing was said".
 */

export type TimedCue = {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
};

export const WEB_VTT_MAX_CUES = 5000;
const CUE_TEXT_MAX = 2000;

const TIMING = new RegExp(
  String.raw`^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{3})`,
);

function toMs(stamp: string): number | null {
  const parts = stamp.split(":");
  const secondsPart = parts.pop();
  if (secondsPart === undefined) return null;
  const [whole, fraction] = secondsPart.split(".");
  const seconds = Number(whole);
  const millis = Number(fraction);
  const minutes = Number(parts.pop() ?? "0");
  const hours = Number(parts.pop() ?? "0");
  if (
    [seconds, millis, minutes, hours].some((n) => !Number.isInteger(n)) ||
    seconds > 59 ||
    minutes > 59
  ) {
    return null;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function cleanText(lines: readonly string[]): string {
  return lines
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CUE_TEXT_MAX);
}

export function parseWebVtt(vtt: string): readonly TimedCue[] {
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues: TimedCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue; // header, NOTE, STYLE, REGION
    const match = TIMING.exec(lines[timingIndex] ?? "");
    if (match === null) continue;
    const startMs = toMs(match[1] ?? "");
    const endMs = toMs(match[2] ?? "");
    const text = cleanText(lines.slice(timingIndex + 1));
    if (startMs === null || endMs === null || endMs < startMs || text === "") {
      continue;
    }
    cues.push({ startMs, endMs, text });
    if (cues.length >= WEB_VTT_MAX_CUES) break;
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

/**
 * The cues that overlap [atMs - windowMs, atMs + windowMs]: what was being
 * said around a moment. Empty when nothing was said then (a pause), which
 * is different from having no transcript.
 */
export function cuesAround(
  cues: readonly TimedCue[],
  atMs: number,
  windowMs: number,
): readonly TimedCue[] {
  const from = Math.max(0, atMs - windowMs);
  const to = atMs + windowMs;
  return cues.filter((cue) => cue.endMs >= from && cue.startMs <= to);
}
