import { createHash } from "node:crypto";

import type { VoiceTranscriptTurn } from "./provider.js";

/**
 * Which spoken utterance a think request is about (founder live test
 * 2026-09-27, failure 9).
 *
 * The provider ends a person's turn at a pause and asks Q to think; if the
 * person carries on, it folds what follows into the same message and asks
 * again. So "Okay." and then "Okay. That makes sense." arrive as two think
 * requests about ONE utterance. What makes them one is their place in the
 * conversation, not their words: both are the person's words after the
 * same conversation, with nothing from Q in between. Once Q's reply is in
 * the conversation, the person's next words are a new utterance.
 *
 * The id is that place: the session, how many turns came before the
 * person's current words, and a digest of those turns. The words
 * themselves never enter it, so a re-heard or re-punctuated fragment is
 * still the same utterance, and the same words said again after a reply
 * are a different one. Opaque and of the stored reference's shape
 * (`UTTERANCE_REF_PATTERN`, q-runtime).
 */
export function utteranceRefOf(
  voiceSessionId: string,
  transcript: readonly VoiceTranscriptTurn[],
): string | undefined {
  let start = transcript.length;
  while (start > 0 && transcript[start - 1]?.role === "user") start -= 1;
  if (start === transcript.length) return undefined;
  const before = createHash("sha256")
    .update(
      JSON.stringify(
        transcript.slice(0, start).map((turn) => [turn.role, turn.content]),
      ),
    )
    .digest("hex")
    .slice(0, 16);
  const session = voiceSessionId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  return `voice:${session}:${String(start)}.${before}`;
}
