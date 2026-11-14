import type { QTurn } from "./conversation";

/**
 * What Q says first when voice opens on a conversation already under way
 * (owner 2026-11-06): it carries on from this thread, never the arrival's
 * "welcome, N things are waiting". Instant, so it never waits on a read.
 * The line goes to the same conversation (same id), so Q has the whole
 * Chat history behind it.
 *
 * D9 (audit 14 Nov 2026): the line used to quote the person's last
 * transcribed words back ("You'd asked 'Hey-ky'", "We were on 'I'm not
 * sure yet. Let's just have'"), a raw fragment that said nothing about what
 * was waiting. It now quotes nothing: it offers to carry on and stops.
 * What there is to carry on with is Q's to say: their answer ends a
 * question, so the voice line routes even a bare "yes" to Q, which answers
 * from the conversation and the account's own state.
 */

type ThreadLine = {
  readonly role: "person" | "q";
  readonly text: string;
  readonly turn?: Extract<QTurn, { kind: "Q" }> | undefined;
};

/** The stored turns as thread lines, in order. */
export function threadOfTurns(turns: readonly QTurn[]): readonly ThreadLine[] {
  return turns.map((turn) =>
    turn.kind === "PERSON"
      ? { role: "person" as const, text: turn.text }
      : { role: "q" as const, text: turn.text, turn },
  );
}

/** Q's opening on a resumed line: no content of its own (see above). */
export const CONTINUATION_LINE =
  "Shall we carry on from where we were, or is there something else?";

/**
 * Q's first words on a voice line opened mid-conversation, or null with
 * nothing said yet (then the arrival greeting is the right opening).
 */
export function continuationLine(lines: readonly ThreadLine[]): string | null {
  return lines.some((line) => line.text.trim().length > 0)
    ? CONTINUATION_LINE
    : null;
}
