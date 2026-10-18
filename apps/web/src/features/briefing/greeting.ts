import { arrivalGreeting, partOfDay } from "@capital-q/q-core/speech";

/**
 * The arrival greeting, casual and glad to see them (Zino, 2026-10-08:
 * "greet me casually, happy to see me"). The time of day comes from their
 * own clock (q-core's `arrivalGreeting`); the warm half is one of a fixed
 * set, picked by a seed so the same visit always reads the same and a
 * test can pin it. Never generic ("What would you like to work on?").
 */

const WARM: readonly string[] = [
  "Good to see you.",
  "Nice to have you back.",
  "Glad you're here.",
  "Good to have you back.",
];

const AWAY_DAYS: readonly string[] = [
  "It's been a few days. Good to see you.",
  "It's been a little while. Nice to have you back.",
];

/** A stable small number from a string (FNV-1a). */
export function greetingSeed(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(options: readonly string[], seed: number): string {
  return options[seed % options.length] ?? options[0] ?? "";
}

export function warmGreeting(input: {
  readonly firstName: string | null;
  readonly now: Date;
  readonly timeZone: string | null;
  /** Hours since their last visit; null when this browser does not know. */
  readonly hoursAway: number | null;
  /** Varies the warm half; the day plus the person is a good seed. */
  readonly seed: number;
}): string {
  const hello = arrivalGreeting({
    firstName: input.firstName,
    now: input.now,
    timeZone: input.timeZone,
  });
  // Late at night the hello already says something human; a second
  // cheerful line would read as forced.
  if (partOfDay(input.now, input.timeZone) === "LATE") return hello;
  const away = input.hoursAway !== null && input.hoursAway >= 72;
  return `${hello} ${pick(away ? AWAY_DAYS : WARM, input.seed)}`;
}
