/**
 * Turn latency row 18 (2026-10-21): a typed answer is read aloud from its
 * first finished sentence, not after the whole text has arrived (the
 * owner heard 0.3-4.4 s of silence after every typed answer settled).
 *
 * Given the answer's plain text so far and how much of it was already
 * handed to speech, the next piece to speak: every whole sentence since
 * then, or -- once the answer is final -- everything left. Null when
 * nothing new is ready. The total never passes `limit`, the most one
 * answer is ever spoken (the speech route's own ceiling).
 */
export function nextSpokenPiece(input: {
  readonly text: string;
  readonly spoken: number;
  readonly final: boolean;
  readonly limit: number;
}): { readonly piece: string; readonly spoken: number } | null {
  const end = Math.min(input.text.length, input.limit);
  if (input.spoken >= end) return null;
  const rest = input.text.slice(input.spoken, end);
  let upTo: number;
  if (input.final || end < input.text.length) {
    // The answer is whole, or this is as far as it is ever spoken.
    upTo = rest.length;
  } else {
    // The last sentence end followed by space: what comes after may still
    // be half a sentence, and half a sentence is never said.
    let last = -1;
    for (const match of rest.matchAll(/[.!?…]["'”’)\]]*(?=\s)/gu)) {
      last = match.index + match[0].length;
    }
    if (last < 0) return null;
    upTo = last;
  }
  const piece = rest.slice(0, upTo).trim();
  if (piece.length === 0) return null;
  return { piece, spoken: input.spoken + upTo };
}
