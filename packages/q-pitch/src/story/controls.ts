import { STORY_ROUTES, type StoryRoute } from "./acts.js";
import { STORY_BEATS, STORY_PRODUCT_BEAT, type StoryBeat } from "./beats.js";
import {
  normaliseCommand,
  parseStepCommand,
  resolveStepCommand,
  type StepMove,
} from "../step-commands.js";

/**
 * Story controls (plan §4): the v6 step commands, at beat level, plus the
 * story's own few words ("skip to the product", captions, mute, end).
 * Deterministic phrase tables, never a model: anything that is not a whole
 * command is a question, and goes to the QA bank.
 */
export type StoryCommand =
  | { readonly kind: "MOVE"; readonly move: StepMove }
  | { readonly kind: "CAPTIONS"; readonly on: boolean | null }
  | { readonly kind: "MUTE"; readonly on: boolean | null }
  | { readonly kind: "END" };

const PRODUCT =
  /^(?:skip|jump|go|take me)(?: straight)? to (?:the )?(?:product|product part|app|good part|demo)$/u;
const CAPTIONS =
  /^(?:(show|hide|turn on|turn off)\s+)?(?:the\s+)?(?:captions|subtitles)(?:\s+(on|off))?$/u;
const MUTE = /^(?:mute|unmute|sound (?:on|off))$/u;
const END =
  /^(?:end|end the story|stop the story|exit|close|that s enough|end tour)$/u;
const START_OVER =
  /^(?:start (?:over|again|from the (?:top|beginning|start))|restart(?: the story)?|from the (?:top|beginning|start)|go back to the (?:beginning|start)|play it again)$/u;

export function parseStoryCommand(
  text: string,
  current: number,
  total: number = STORY_BEATS.length,
  /** Where the product part (#33) is in the edition playing (1-based). */
  productStep: number = STORY_PRODUCT_BEAT,
): StoryCommand | null {
  const said = normaliseCommand(text)
    .replace(/^(?:(?:q|hey q|ok|okay|please)\s+)+/u, "")
    .replace(/\s+please$/u, "");
  if (PRODUCT.test(said)) {
    return {
      kind: "MOVE",
      move: { kind: "STEP", step: productStep },
    };
  }
  const captions = CAPTIONS.exec(said);
  if (captions !== null) {
    const verb = captions[1] ?? captions[2];
    return {
      kind: "CAPTIONS",
      on:
        verb === undefined
          ? null
          : verb === "show" || verb === "turn on" || verb === "on",
    };
  }
  if (MUTE.test(said)) {
    return {
      kind: "MUTE",
      on: said === "mute" || said === "sound off",
    };
  }
  if (END.test(said)) return { kind: "END" };
  if (START_OVER.test(said)) {
    return { kind: "MOVE", move: { kind: "STEP", step: 1 } };
  }
  const step = parseStepCommand(text);
  if (step === null) return null;
  return { kind: "MOVE", move: resolveStepCommand(step, current, total) };
}

/** The story's routes in order of first visit (the preload order). */
export function storyRoutes(
  beats: readonly StoryBeat[] = STORY_BEATS,
): StoryRoute[] {
  const seen: StoryRoute[] = [];
  for (const beat of beats) {
    for (const cue of beat.cues) {
      if (cue.act.kind === "navigate" && !seen.includes(cue.act.route)) {
        seen.push(cue.act.route);
      }
    }
  }
  return seen;
}

/**
 * The routes the next `ahead` beats after `index` (0-based) navigate to:
 * kept warm (prefetched again) while the story plays (plan §1).
 */
export function warmRoutes(
  index: number,
  ahead = 2,
  beats: readonly StoryBeat[] = STORY_BEATS,
): StoryRoute[] {
  return storyRoutes(beats.slice(index + 1, index + 1 + ahead));
}

/**
 * The page the story is on when beat `index` (0-based) begins: the last
 * navigation of the beats before it, so "go to beat 40" first lands where
 * beat 40 starts talking (its own cues then run from its first word).
 * Null when no beat before it navigated: the Q stage at /home.
 */
export function routeAtBeat(
  index: number,
  beats: readonly StoryBeat[] = STORY_BEATS,
): StoryRoute | null {
  let route: StoryRoute | null = null;
  for (const beat of beats.slice(0, Math.max(0, index))) {
    for (const cue of beat.cues) {
      if (cue.act.kind === "navigate") route = cue.act.route;
    }
  }
  return route;
}

/** Every route key is used by the script (a test keeps the list honest). */
export const STORY_ROUTE_KEYS: readonly StoryRoute[] = STORY_ROUTES;
