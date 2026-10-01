import type { RehearsalService } from "../composition/rehearsals.js";
import type { VoiceTranscriptTurn } from "./provider.js";
import type { VoiceTurnHandler, VoiceTurnOutcome } from "./turn.js";

/**
 * REHEARSE: a voice line opened for a rehearsal speaks only as the person
 * Q plays. Every turn on that line goes to the rehearsal service, which
 * checks the rehearsal is the speaker's own; any other line goes to Q's
 * ordinary turn handler, unchanged.
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

export function createRehearsalAwareTurn(dependencies: {
  readonly rehearsals: RehearsalService;
  readonly fallback: VoiceTurnHandler;
}): VoiceTurnHandler {
  let misses = 0;
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
      if (line !== undefined) {
        misses = 0;
        await speaker.speak(line.text);
        return { kind: "SPOKEN", path: "Q" };
      }
      return { kind: "NOTHING" };
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
