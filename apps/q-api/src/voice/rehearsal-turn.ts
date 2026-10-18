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
  turn: Pick<QRehearsalTurnDto, "text" | "mood" | "intensity" | "reaction">,
): void {
  board?.perform(
    voiceSessionId,
    deliverLine(sentences(turn.text), {
      tone: toneOf(turn.mood),
      intensity: turn.intensity ?? "NORMAL",
      reaction: turn.reaction ?? null,
    }),
  );
}

export function createRehearsalAwareTurn(dependencies: {
  readonly rehearsals: RehearsalService;
  readonly fallback: VoiceTurnHandler;
  readonly performance?: SpeechPerformanceBoard | undefined;
}): VoiceTurnHandler {
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
    const result = await dependencies.rehearsals.say(
      binding.actor,
      rehearsal.rehearsalId,
      { text: latest },
      signal,
    );
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
        return { kind: "NOTHING" };
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
