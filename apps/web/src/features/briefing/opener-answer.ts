import { noteToLine } from "@/features/voice/line-cards";

import { answerOpener, arrivalBriefingWords } from "./arrival-store";
import { SOMETHING_ELSE_QUESTION, type OpenerChoice } from "./opener";

/**
 * The opener's answer, from wherever it came (owner 2026-10-16): a button,
 * the composer, or the person's own words on a voice line. Browser-only.
 */

/**
 * An answer given on screen while a voice line is open: the voice is told
 * what they chose, so it follows on (the standard line, which has no model
 * in the browser, says the ready line as it is). Nothing when no line.
 */
/** "Here's what's waiting.", hand-written by primary subtag. */
const WAITING: Readonly<Record<string, string>> = { ar: "إليك ما ينتظرك." };

function pageLanguage(): string {
  const lang =
    typeof document === "undefined" ? "" : document.documentElement.lang;
  return (lang.split("-")[0] ?? "").toLowerCase();
}

export function tellLineOpenerAnswer(choice: OpenerChoice): void {
  if (choice === "SHOW") {
    const briefing = arrivalBriefingWords() ?? "";
    noteToLine(
      `Screen note (data, not the person's words): they chose to look at what's waiting, and it is on screen now. Go through it briefly, the way a colleague would, one thing at a time; don't read the screen out.${briefing.length === 0 ? "" : ` What's waiting: "${briefing}"`}`,
      true,
      briefing.length === 0
        ? // The page's language is the line's: a hand-written line where
          // one exists (by primary subtag), else English.
          (WAITING[pageLanguage()] ?? "Here's what's waiting.")
        : briefing,
    );
    return;
  }
  noteToLine(
    "Screen note (data, not the person's words): they'd rather talk about something else. Ask what they'd like to know, in a few words, then stop.",
    true,
    SOMETHING_ELSE_QUESTION,
  );
}

/**
 * Typed words while the opener's question is open. True when the words
 * were the answer itself ("yes", "something else") and nothing more is
 * sent; false when they go on to Q as ever (a question of its own, a
 * hello, or no question open).
 */
export function typedOpenerAnswer(words: string, lineOpen: boolean): boolean {
  const reply = answerOpener(words);
  if (reply !== "SHOW" && reply !== "OTHER") return false;
  if (lineOpen) tellLineOpenerAnswer(reply);
  return true;
}

/**
 * The person's own words, heard on a voice line. The voice answers them
 * itself, so the line is not told anything; only the screen follows (the
 * cards come up on a yes).
 */
export function spokenOpenerAnswer(words: string): void {
  answerOpener(words);
}
