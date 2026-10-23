import type { QRehearsalTurnDto } from "@capital-q/contracts";

import type { RehearsalService } from "../composition/rehearsals.js";
import type { VoiceTranscriptTurn } from "./provider.js";
import { sentences } from "./speech.js";
import {
  deliverLine,
  SPEECH_TONES,
  type SpeechPerformanceBoard,
  type SpeechTone,
} from "./speech-performance.js";
import type { VoiceTurnHandler, VoiceTurnOutcome } from "./turn.js";

/**
 * REHEARSE: a voice line opened for a rehearsal speaks only as the person
 * Q plays. Every turn on that line goes to the rehearsal service, which
 * checks the rehearsal is the speaker's own; any other line goes to Q's
 * ordinary turn handler, unchanged.
 *
 * The line's mood, loudness and reaction (typed fields the turn's model
 * chose beside the line) go to the speech-performance board, so the speak
 * relay renders them as the voice's delivery: an annoyed investor sounds
 * annoyed. The words themselves go out exactly as written.
 *
 * Interruptions: the think route aborts a turn the person spoke over; the
 * rehearsal keeps nothing of an aborted reply and the grown utterance
 * arrives as the next turn.
 */

/** In character, never a system error read aloud. */
const DID_NOT_CATCH = [
  "Sorry, I lost you for a second there. Say that again?",
  "Hang on, you cut out. Could you repeat that?",
] as const;
const ALREADY_OVER =
  "I think we've covered it for today. Thanks for your time.";

/**
 * A persona turn is one bounded model call (rehearsals TURN_BUDGET: up to
 * two attempts of 8 s), so a reply can take longer than a person reads as
 * "they're thinking". Past this, the person Q plays fills the gap the way
 * a person would, in a couple of words, before the line itself (Kuuza's
 * soft timeout, 3 s). Nothing about the reply is guessed in it.
 */
export const PERSONA_FILLER_AFTER_MS = 3_000;
export const PERSONA_FILLERS = [
  "Hmm, let me think about that.",
  "Right. Give me a second.",
  "Okay, hang on.",
  "Mm. Let me think.",
] as const;

/** A turn's mood as a voice tone; NEUTRAL is the voice as it is. */
export function toneOf(mood: QRehearsalTurnDto["mood"]): SpeechTone | null {
  return mood !== null && (SPEECH_TONES as readonly string[]).includes(mood)
    ? (mood as SpeechTone)
    : null;
}

/** Hand one played line's delivery to the board for the relay. */
export function performRehearsalLine(
  board: SpeechPerformanceBoard | undefined,
  voiceSessionId: string,
  turn: Pick<
    QRehearsalTurnDto,
    "text" | "mood" | "intensity" | "reaction" | "beats"
  >,
): void {
  const spoken = sentences(turn.text);
  board?.perform(
    voiceSessionId,
    deliverLine(
      spoken,
      {
        tone: toneOf(turn.mood),
        intensity: turn.intensity ?? "NORMAL",
        reaction: turn.reaction ?? null,
      },
      // v13 (R5): a sentence's own feeling, only when the beats line up
      // with the sentences actually spoken; otherwise one delivery.
      turn.beats !== undefined && turn.beats.length === spoken.length
        ? turn.beats.map((beat) => ({
            tone: toneOf(beat.mood),
            intensity: beat.intensity,
          }))
        : undefined,
    ),
  );
}

export function createRehearsalAwareTurn(dependencies: {
  readonly rehearsals: RehearsalService;
  readonly fallback: VoiceTurnHandler;
  readonly performance?: SpeechPerformanceBoard | undefined;
  /** Absent means PERSONA_FILLER_AFTER_MS; for tests. */
  readonly fillerAfterMs?: number | undefined;
}): VoiceTurnHandler {
  const fillerAfterMs = dependencies.fillerAfterMs ?? PERSONA_FILLER_AFTER_MS;
  let fillers = 0;
  let misses = 0;
  /** The last played line spoken on each voice line, never said twice. */
  const spokenAt = new Map<string, string>();
  return async (binding, transcript, signal, speaker) => {
    const rehearsal = binding.thread.rehearsal;
    if (rehearsal === undefined) {
      return dependencies.fallback(binding, transcript, signal, speaker);
    }
    const latest = lastUserWords(transcript);
    if (latest === null) return { kind: "NOTHING" };
    // R7 (2026-10-23): on a line heard as it is spoken, the played line's
    // first sentence is said as soon as the model has written it (the
    // service decides when that is safe); the rest follows in the same
    // utterance. A deferred line (GPT-Live) says everything at once.
    const streams = speaker.deferred !== true;
    let firstPiece: string | null = null;
    let firstArrived: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      firstArrived = resolve;
    });
    const saying = dependencies.rehearsals.say(
      binding.actor,
      rehearsal.rehearsalId,
      { text: latest },
      signal,
      streams
        ? {
            onFirstPiece: (piece) => {
              firstPiece = piece;
              firstArrived();
            },
          }
        : undefined,
    );
    const settled = saying.then(
      () => "DONE" as const,
      () => "DONE" as const,
    );
    // A slow reply gets a filler first, on a line that is heard as it is
    // spoken; a deferred line (GPT-Live) says everything at once, so a
    // filler there would only become part of the answer. A first sentence
    // already on its way needs none.
    let filled = false;
    if (streams && fillerAfterMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const won = await Promise.race([
        settled,
        first.then(() => "FIRST" as const),
        new Promise<"LATE">((resolve) => {
          timer = setTimeout(() => resolve("LATE"), fillerAfterMs);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (won === "LATE" && !signal.aborted) {
        // The first sentence may still come while the filler plays.
        filled = true;
        await speaker.speak(
          PERSONA_FILLERS[fillers++ % PERSONA_FILLERS.length] ?? "",
        );
      }
    } else if (streams) {
      await Promise.race([settled, first]);
    }
    if (firstPiece !== null && !signal.aborted) {
      const piece = firstPiece ?? "";
      // The first sentence has no cue of its own (its feeling is not
      // known yet): the persona's voice as it is.
      dependencies.performance?.perform(binding.voiceSessionId, []);
      await speaker.speak(
        (async function* () {
          yield piece;
          const done = await saying;
          if (signal.aborted || done.kind !== "OK") return;
          const line = done.rehearsal.turns
            .filter((turn) => turn.from === "THEM")
            .at(-1);
          if (line === undefined) return;
          spokenAt.set(binding.voiceSessionId, line.at);
          const rest = restOf(line.text, piece);
          if (rest.length === 0) return;
          performRehearsalLine(
            dependencies.performance,
            binding.voiceSessionId,
            {
              ...line,
              text: rest,
              beats:
                line.beats === undefined
                  ? undefined
                  : line.beats.slice(
                      sentences(line.text).length - sentences(rest).length,
                    ),
            },
          );
          yield ` ${rest}`;
        })(),
      );
      misses = 0;
      if (signal.aborted) {
        return { kind: "INTERRUPTED", path: "Q" } satisfies VoiceTurnOutcome;
      }
      return { kind: "SPOKEN", path: "Q" };
    }
    const result = await saying;
    if (signal.aborted) {
      return { kind: "INTERRUPTED", path: "Q" } satisfies VoiceTurnOutcome;
    }
    if (result.kind === "OK") {
      const line = result.rehearsal.turns
        .filter((turn) => turn.from === "THEM")
        .at(-1);
      // Nothing new was said (an empty or repeated utterance): silence,
      // never the previous line again.
      if (
        line === undefined ||
        spokenAt.get(binding.voiceSessionId) === line.at
      ) {
        return filled ? { kind: "SPOKEN", path: "Q" } : { kind: "NOTHING" };
      }
      spokenAt.set(binding.voiceSessionId, line.at);
      if (spokenAt.size > 500) {
        const oldest = spokenAt.keys().next().value;
        if (oldest !== undefined) spokenAt.delete(oldest);
      }
      misses = 0;
      performRehearsalLine(
        dependencies.performance,
        binding.voiceSessionId,
        line,
      );
      await speaker.speak(line.text);
      return { kind: "SPOKEN", path: "Q" };
    }
    if (result.kind === "FINISHED") {
      await speaker.speak(ALREADY_OVER);
      return { kind: "SPOKEN", path: "Q" };
    }
    await speaker.speak(DID_NOT_CATCH[misses++ % DID_NOT_CATCH.length] ?? "");
    return { kind: "SPOKEN", path: "Q" };
  };
}

function lastUserWords(
  transcript: readonly VoiceTranscriptTurn[],
): string | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const turn = transcript[index];
    if (turn?.role === "user") {
      const text = turn.content.trim();
      return text.length === 0 ? null : text.slice(0, 4_000);
    }
  }
  return null;
}

/**
 * What is left to say after the first sentence already said: the rest of
 * the line when it begins with it; the whole line when it does not (code
 * changed the line after all), so the person always hears the real line.
 */
export function restOf(full: string, said: string): string {
  const flat = (text: string) => text.replace(/\s+/gu, " ").trim();
  const line = flat(full);
  const head = flat(said);
  if (head.length === 0) return line;
  return line.startsWith(head) ? line.slice(head.length).trim() : line;
}
