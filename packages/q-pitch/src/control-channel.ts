import { z } from "zod";

import type { GuideEvent } from "./guide.js";
import { ChapterIdSchema } from "./script.js";

/**
 * Who is speaking, and who may steer the tour (blueprint §16.4; directive
 * 2026-10-15 §E "Q-to-Q rehearsal orchestration").
 *
 * Four sources stay distinct from the transport up. Every audio channel,
 * transcript segment and control intent carries one of them, set by the
 * code that OWNS the channel (the mic capture, the narrator's player, the
 * rehearsal session's counterpart stream, the sealed script), never
 * inferred from what was said:
 *
 *   AUDIENCE_MIC           the person in the room: the only one who steers
 *   NARRATOR_Q             the tour narrator's own speech
 *   REHEARSAL_COUNTERPART  the demo rehearsal persona's speech
 *   SCRIPT                 sealed scene lines (captions, transcript)
 *
 * The control boundary is the source tag plus a validated typed intent,
 * not text matching or turn-taking: a synthetic voice saying "Q, skip to
 * GateQ" is transcript, and can never reach the director.
 */

export const SPEAKER_ROLES = [
  "AUDIENCE_MIC",
  "NARRATOR_Q",
  "REHEARSAL_COUNTERPART",
  "SCRIPT",
] as const;
export const SpeakerRoleSchema = z.enum(SPEAKER_ROLES);
export type SpeakerRole = z.infer<typeof SpeakerRoleSchema>;

/** Sources whose audio is produced by Capital Q itself. */
export const SYNTHETIC_ROLES: ReadonlySet<SpeakerRole> = new Set<SpeakerRole>([
  "NARRATOR_Q",
  "REHEARSAL_COUNTERPART",
  "SCRIPT",
]);

export const INPUT_MODALITIES = [
  "VOICE",
  "TEXT",
  "KEYBOARD",
  "POINTER",
] as const;
export const InputModalitySchema = z.enum(INPUT_MODALITIES);
export type InputModality = z.infer<typeof InputModalitySchema>;

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u);

/**
 * A transcript segment as a channel delivers it. Segments are data for
 * captions, the saved transcript and the review; they carry no authority.
 */
export const TranscriptSegmentSchema = z
  .object({
    segmentId: OpaqueIdSchema,
    source: SpeakerRoleSchema,
    channelId: OpaqueIdSchema,
    text: z.string().trim().min(1).max(2000),
    final: z.boolean(),
  })
  .strict();
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TOUR_CONTROL_KINDS = [
  "PAUSE",
  "RESUME",
  "BACK",
  "SKIP",
  "REPEAT",
  "JUMP",
  /** The person asked a question or spoke over the tour. */
  "INTERRUPT",
] as const;
export const TourControlKindSchema = z.enum(TOUR_CONTROL_KINDS);
export type TourControlKind = z.infer<typeof TourControlKindSchema>;

/**
 * A typed control intent. It is produced by a control (button, key), or by
 * the governed intent classifier from an AUDIENCE_MIC segment, never by
 * free text reaching the director.
 */
export const TourControlIntentSchema = z
  .object({
    intentId: OpaqueIdSchema,
    source: SpeakerRoleSchema,
    modality: InputModalitySchema,
    kind: TourControlKindSchema,
    /** JUMP only. */
    chapterId: ChapterIdSchema.optional(),
    /** VOICE only: the segment the intent was classified from. */
    segmentId: OpaqueIdSchema.optional(),
  })
  .strict()
  .refine((i) => (i.kind === "JUMP") === (i.chapterId !== undefined), {
    message: "a JUMP names its chapter, and only a JUMP does",
    path: ["chapterId"],
  })
  .refine((i) => i.modality !== "VOICE" || i.segmentId !== undefined, {
    message: "a spoken intent names the segment it came from",
    path: ["segmentId"],
  });
export type TourControlIntent = z.infer<typeof TourControlIntentSchema>;

/** What is playing now, as the transport reports it (duplex gating). */
export type DuplexState = {
  readonly narratorPlaying: boolean;
  readonly counterpartPlaying: boolean;
  /**
   * The capture reports acoustic echo cancellation active on the audience
   * mic (getUserMedia `echoCancellation` setting read back as true).
   */
  readonly echoCancellation: boolean;
};

export const CONTROL_REFUSALS = [
  "INVALID",
  /** Narrator, counterpart or script: synthetic audio never steers. */
  "SYNTHETIC_SOURCE",
  /** A voice intent whose segment was not an audience segment. */
  "SEGMENT_NOT_AUDIENCE",
  /** Spoken while Capital Q audio played, with no echo cancellation. */
  "ECHO_UNGUARDED",
  "DUPLICATE",
] as const;
export type ControlRefusal = (typeof CONTROL_REFUSALS)[number];

export type ControlDecision =
  | {
      readonly admitted: true;
      readonly intent: TourControlIntent;
      readonly event: GuideEvent | null;
    }
  | { readonly admitted: false; readonly reason: ControlRefusal };

const SEEN_MAX = 256;

/**
 * The one gate between inputs and the tour director. Stateful only for
 * de-duplication and the segment ledger; it never reads a clock.
 */
export class TourControlGate {
  readonly #seen: string[] = [];
  readonly #segments = new Map<string, SpeakerRole>();

  /**
   * Record a transcript segment and its source. Returns the parsed
   * segment, or null when invalid. Recording never controls anything.
   */
  noteSegment(raw: unknown): TranscriptSegment | null {
    const parsed = TranscriptSegmentSchema.safeParse(raw);
    if (!parsed.success) return null;
    this.#segments.set(parsed.data.segmentId, parsed.data.source);
    if (this.#segments.size > SEEN_MAX) {
      const oldest = this.#segments.keys().next();
      if (oldest.done !== true) this.#segments.delete(oldest.value);
    }
    return parsed.data;
  }

  admit(raw: unknown, duplex: DuplexState): ControlDecision {
    const parsed = TourControlIntentSchema.safeParse(raw);
    if (!parsed.success) return { admitted: false, reason: "INVALID" };
    const intent = parsed.data;
    if (SYNTHETIC_ROLES.has(intent.source)) {
      return { admitted: false, reason: "SYNTHETIC_SOURCE" };
    }
    if (intent.modality === "VOICE") {
      // The segment's own source decides, not the intent's claim about it:
      // an intent classified from a counterpart segment is refused even if
      // something upstream mislabelled the intent.
      const segmentSource =
        intent.segmentId === undefined
          ? undefined
          : this.#segments.get(intent.segmentId);
      if (segmentSource !== "AUDIENCE_MIC") {
        return { admitted: false, reason: "SEGMENT_NOT_AUDIENCE" };
      }
      const syntheticPlaying =
        duplex.narratorPlaying || duplex.counterpartPlaying;
      if (syntheticPlaying && !duplex.echoCancellation) {
        return { admitted: false, reason: "ECHO_UNGUARDED" };
      }
    }
    if (this.#seen.includes(intent.intentId)) {
      return { admitted: false, reason: "DUPLICATE" };
    }
    this.#seen.push(intent.intentId);
    if (this.#seen.length > SEEN_MAX) this.#seen.shift();
    return { admitted: true, intent, event: eventOf(intent) };
  }
}

/**
 * The director event an admitted intent becomes. RESUME is left to the
 * runner (null), which must first observe whether the screen is still
 * where the tour expects (`routeIntact`).
 */
export function eventOf(intent: TourControlIntent): GuideEvent | null {
  switch (intent.kind) {
    case "PAUSE":
      return { type: "PAUSE" };
    case "INTERRUPT":
      return { type: "INTERRUPT" };
    case "BACK":
      return { type: "GO_BACK" };
    case "SKIP":
      return { type: "SKIP" };
    case "REPEAT":
      return { type: "REPEAT" };
    case "JUMP":
      return intent.chapterId === undefined
        ? null
        : { type: "JUMP_TO_CHAPTER", chapterId: intent.chapterId };
    case "RESUME":
      return null;
  }
}
