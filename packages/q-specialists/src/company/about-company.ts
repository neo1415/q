import type { QSpecialistTurnReading } from "../contracts.js";

/**
 * Whether a question is about the company in the conversation at all.
 *
 * The company specialist used to take EVERY question asked while a company
 * was the subject. Live, "what's up", "who is the CEO of Paystack" and
 * "just search online" all went to a path that answers only from the
 * company's own records, and the person was told each fell outside the
 * scope of the company's data. So the specialist is only for questions
 * that are about the subject company; everything else goes to the
 * conversational path, which has the tools, the research and ordinary
 * knowledge, and reads the company's records through those same tools.
 *
 * Decided from Q's turn reader (a model reading of the words in context,
 * ADR 0011/0016), not from word patterns: a regex over phrasings answered
 * only the phrasings someone had thought of ("our runway", "how do we
 * look") and misread every other way of asking.
 *
 *   - a question asking for Q's judgement (ADVICE) that names nobody
 *     other than the speaker and the conversation's subject: the analysis.
 *   - a correction of what Q said about the company: the analysis, which
 *     reads the corrected fact against the record.
 *   - anything else -- small talk, a request for Q to do something, a
 *     question about somebody else, public facts, how Capital Q works, or
 *     a turn the reader could not read: the conversational path.
 */
export function readsAsAboutSubjectCompany(
  reading: QSpecialistTurnReading | null,
): boolean {
  if (reading === null || reading.aboutNamedOther) return false;
  if (reading.kind === "CORRECTION") return true;
  return reading.kind === "QUESTION_TO_Q" && reading.questionKind === "ADVICE";
}
