import type { PermittedContextPlan, QSubjectRef } from "@capital-q/contracts";

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

/**
 * A8 (live 14 Nov 2026, founder.maji-loop on 5f4603b05): whether a founder
 * is correcting something about THEIR OWN company, so the turn goes to the
 * answer path that holds `propose_company_figure`, not to this specialist.
 *
 * "Actually October MRR was $110k." was read as a CORRECTION and answered
 * here, a path with no tools: no approval card could be prepared, and the
 * reply said both figures were being kept, which nothing had recorded. A
 * correction from the company's own side changes what is on record, and
 * the only way anything reaches the record is an approval card (Prepare ->
 * Approval). The analysis of the corrected fact is still read there,
 * through the same records, by the tools.
 *
 * Decided from the turn reader's kind (a model reading, never words) and
 * from the Context Firewall's plan, never from the request: the subject
 * company must be the one the plan holds under its owner's label
 * (`organisation_private` COMPANY_PROFILE -- a disclosed company profile
 * never carries it), so an investor's correction about a company stays
 * on this path, as before.
 */
export function correctsOwnCompany(
  reading: Pick<QSpecialistTurnReading, "kind" | "aboutNamedOther"> | null,
  subjects: readonly QSubjectRef[],
  plan: Pick<PermittedContextPlan, "scopes">,
): boolean {
  if (reading === null || reading.aboutNamedOther) return false;
  if (reading.kind !== "CORRECTION") return false;
  const companies = subjects.filter(
    (subject): subject is Extract<QSubjectRef, { kind: "COMPANY" }> =>
      subject.kind === "COMPANY",
  );
  if (companies.length !== 1) return false;
  const companyId = companies[0]?.companyId;
  return plan.scopes.some(
    (scope) =>
      scope.kind === "COMPANY_PROFILE" &&
      scope.contextLabel === "organisation_private" &&
      scope.subject?.kind === "COMPANY" &&
      scope.subject.companyId === companyId,
  );
}
