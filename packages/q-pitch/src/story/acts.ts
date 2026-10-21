import { z } from "zod";

/**
 * Q Story (v7, plan 2026-10-21 §1): what a story cue does on screen.
 *
 * A cue is anchored to a word of a beat and fires about 120 ms before that
 * word is spoken. Every act is local and non-consequential: it moves the
 * viewer's own screen (a route they may already open, a section lit, a
 * picture or demonstration artifact on the Q stage). Nothing here sends,
 * approves, books or writes, and nothing reads the database or calls a
 * model while the story plays: routes are prefetched, pictures decoded and
 * artifacts drawn from labelled demonstration fixtures before it starts.
 */

/**
 * The pages the story visits, by key. Closed: a cue can never carry a URL,
 * so the host resolves each key to a fixed path (or to a fixture record
 * the viewer's own pages authorise) and prefetches it on entry.
 */
export const STORY_ROUTES = [
  "home",
  "discover",
  "capital-mandate",
  "company-diligence",
  "relationship-prep",
  "gateq-gate",
  "gateq-application",
  "gateq-inbox",
] as const;
export const StoryRouteSchema = z.enum(STORY_ROUTES);
export type StoryRoute = z.infer<typeof StoryRouteSchema>;

/**
 * A section the story lights (gold ring plus the breathing pulse). Story
 * anchors are their own namespace (`qs.*`) and are placed by the web
 * host's marker table, like the investor track's `inv.*` anchors.
 */
export const StoryAnchorSchema = z
  .string()
  .regex(/^qs\.[a-z0-9][a-z0-9-]{0,30}(?:\.[a-z0-9][a-z0-9-]{0,30}){0,3}$/u);
export type StoryAnchor = z.infer<typeof StoryAnchorSchema>;

/**
 * What the Q stage shows. Each visual has numbered steps (an inbox item per
 * word, a chip per word); `step` 0 shows it bare. Illustrative visuals are
 * labelled as such on screen, and every visual naming a company uses
 * demonstration fixtures labelled "Demonstration data".
 */
export const STORY_VISUALS = [
  "none",
  "type",
  "inbox",
  "montage",
  "calendar",
  "questions",
  "scale",
  "photos",
  "timeline",
  "chart-dip",
  "icons",
  "warmth",
  "bubbles",
  "fade-words",
  "chips-mismatch",
  "chips-readiness",
  "wordmark",
  "top-three",
  "comparison",
  "investiq",
  "investor-matches",
  "deck-to-card",
  "q-card",
  "split",
  "screens",
  "stopwatch",
  "lines",
  "aperture",
] as const;
export const StoryVisualSchema = z.enum(STORY_VISUALS);
export type StoryVisual = z.infer<typeof StoryVisualSchema>;

/** The story's lighting: night (Act 1), day (Act 2), the app awake (Acts 4+). */
export const STORY_MOODS = ["STORY", "NIGHT", "DAY", "HUSH", "WAKE"] as const;
export const StoryMoodSchema = z.enum(STORY_MOODS);
export type StoryMood = z.infer<typeof StoryMoodSchema>;

/**
 * The figures Q's presence can form (lane S4, `presence.form`): the same
 * ids as the web's PRESENCE_FIGURE_IDS (a web test keeps them equal).
 */
export const STORY_FIGURES = [
  "CLOCK",
  "INBOX",
  "MAGNIFIER",
  "PLANE",
  "ENVELOPE",
  "PEN",
  "CHART_DIP",
  "CHART_BARS",
  "SCALE",
  "HOUSE",
  "CALENDAR",
  "MAP_PIN",
  "COMPARE",
  "DOCUMENT",
  "HANDSHAKE",
  "LETTER_Q",
] as const;
export const StoryFigureSchema = z.enum(STORY_FIGURES);
export type StoryFigure = z.infer<typeof StoryFigureSchema>;

export const StoryActSchema = z.discriminatedUnion("kind", [
  /** Scrim and chrome: story mode, night, day, the hush before "silence", the app waking. */
  z.object({ kind: z.literal("mood"), mood: StoryMoodSchema }).strict(),
  /** The Q stage visual, at `step` (0 = bare); `text` is a short on-screen label. */
  z
    .object({
      kind: z.literal("stage"),
      visual: StoryVisualSchema,
      step: z.number().int().min(0).max(20),
      text: z.string().trim().min(1).max(80).optional(),
    })
    .strict(),
  /** A direct jump to a story page (no intermediate steps). */
  z.object({ kind: z.literal("navigate"), route: StoryRouteSchema }).strict(),
  /** Light one section (ring plus pulse); one section is lit at a time. */
  z.object({ kind: z.literal("light"), anchor: StoryAnchorSchema }).strict(),
  /** Nothing lit. */
  z.object({ kind: z.literal("unlight") }).strict(),
  /** Q's presence forms a figure and holds it (S4), then flows back. */
  z
    .object({
      kind: z.literal("figure"),
      figure: StoryFigureSchema,
      holdMs: z.number().int().min(600).max(15_000),
    })
    .strict(),
]);
export type StoryAct = z.infer<typeof StoryActSchema>;

/** A cue: an act on the `at`-th word (0-based) of its beat. */
export const StoryCueSchema = z
  .object({
    at: z.number().int().min(0).max(200),
    act: StoryActSchema,
  })
  .strict();
export type StoryCue = z.infer<typeof StoryCueSchema>;
