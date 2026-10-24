import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * A founder asking about their own pitch video (QA F-99, 24 Oct 2026:
 * "How is my pitch video doing, and how can I make it better?" got a
 * generic "performance isn't on record" with no transcript read, where at
 * 15h the same ask had a concrete review: a transcript error, the first
 * 15 seconds). The transcript is read by code, through the same
 * read_company_pitches tool and plan the model has, so the review rests
 * on what they actually say, whatever the turn's tool focus offered.
 */

/** "critique my pitch video", "how is our pitch doing", "review my video". */
const OWN_PITCH =
  /\b(?:my|our)\s+(?:(?:pitch|founder|intro)\s+)?(?:pitch|video)\b|\bthe\s+pitch\s+video\b/iu;

export function asksAboutOwnPitch(text: string): boolean {
  return OWN_PITCH.test(text);
}

/** "rewrite my deck", "update the script": a change asked for, not a review. */
const CHANGE_ASKED =
  /\b(?:revise|rewrite|edit|redo|update|change|fix)\b[^.?!]*\b(?:deck|document|script|brief|file|slides?)\b/iu;

/**
 * QA F-107: a review of their own pitch, with no change to a document
 * asked for. Such a turn reads; it never prepares a document revision.
 */
export function asksOnlyToReviewOwnPitch(text: string): boolean {
  return asksAboutOwnPitch(text) && !CHANGE_ASKED.test(text);
}

type PitchesRead = {
  readonly pitches?: readonly {
    readonly title?: unknown;
    readonly transcript?: unknown;
    readonly segments?: readonly {
      readonly at?: unknown;
      readonly text?: unknown;
    }[];
  }[];
};

const STATEMENT_MAX = 6_000;

/**
 * Their own pitch videos' timed transcripts, with how to use them: a
 * review from what is said (the opening seconds, lines to cut or sharpen,
 * what an investor will miss), machine-transcription slips named as such.
 * Viewing figures are not part of it: none are recorded, said once.
 * Null when there is nothing to read.
 */
export function ownPitchReviewFact(data: unknown): AuthorisedFact | null {
  const pitches = (data as PitchesRead | null)?.pitches ?? [];
  if (pitches.length === 0) return null;
  const parts = pitches.map((pitch, index) => {
    const name =
      typeof pitch.title === "string" && pitch.title.trim() !== ""
        ? `"${pitch.title.trim()}"`
        : `Pitch ${String(index + 1)}`;
    if (pitch.transcript !== "AVAILABLE") {
      return `${name}: no transcript yet, so what is said in it is unknown.`;
    }
    const lines = (pitch.segments ?? [])
      .map((segment) =>
        typeof segment.at === "string" && typeof segment.text === "string"
          ? `[${segment.at}] ${segment.text}`
          : null,
      )
      .filter((line): line is string => line !== null);
    return lines.length === 0
      ? `${name}: transcript is empty.`
      : `${name}, transcript: ${lines.join(" ")}`;
  });
  const statement =
    "THEIR OWN PITCH VIDEO, as they say it (machine-generated transcript, their words, not verified). " +
    "For how good it is or how to make it better, review it from these words: what the first 15 seconds say and whether they hook an investor; " +
    "name the exact lines (with the moment, e.g. 0:12) to cut, sharpen or reorder, and what an investor would still be missing (traction, the raise, use of funds); " +
    "a word that looks misheard is a transcription slip, say so rather than fault them for it. " +
    "Views, watch time and who watched are not recorded: if asked, say so in one clause, never as the whole answer. " +
    "This is a review in words: a pitch video is not a document Q revises, so prepare, revise or offer to revise no document, deck or file for it; for changes, say what to change and offer to help script the next take. " +
    parts.join(" ");
  return {
    scope: "COMPANY_PROFILE",
    statement: statement.slice(0, STATEMENT_MAX),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "Their pitch videos' machine-generated transcripts",
  };
}
