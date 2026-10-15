import type { QMessage } from "@capital-q/contracts";
import {
  SUBJECT_KEY,
  demoCompany,
  receiptCardIndex,
  type FixtureKey,
  type TourAction,
} from "@capital-q/q-pitch";

/**
 * Tour record keys → canonical records, resolved ONLY from what the
 * signed-in actor was actually shown (lead decision, 15 Oct): `card-N` is
 * the Nth company card of the Q answer whose DONE receipt the tour
 * acknowledged (snapshotted when the receipt arrives). No names are hard-coded, nothing is looked
 * up, and no other actor's data is read. If the receipt has no such card,
 * the key does not resolve and the scene takes its fallback.
 */
export type ResolvedCompany = {
  readonly companyId: string;
  readonly name: string;
};

/** The company cards of one acknowledged run, in the order shown. */
export function receiptCompanies(
  messages: readonly QMessage[],
  runId: string,
): ResolvedCompany[] {
  const cards: ResolvedCompany[] = [];
  for (const message of messages) {
    if (message.role === "USER" || message.runId !== runId) continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ANSWER_CARDS") continue;
      for (const card of block.cards) {
        if (card.subject?.kind === "COMPANY") {
          cards.push({ companyId: card.subject.companyId, name: card.name });
        }
      }
    }
  }
  return cards;
}

/**
 * `card-N` from the acknowledged receipt; `subject` from the viewer-checked
 * server setting; a named fictional demo company from the q-pitch package's
 * DEMO_COMPANIES (owner decision 15 Oct; the page re-checks the viewer when
 * it opens); anything else never resolves.
 */
export function resolveCompanyFixture(
  key: FixtureKey,
  receipt: readonly ResolvedCompany[],
  subject: ResolvedCompany | null = null,
): ResolvedCompany | null {
  if (key === SUBJECT_KEY) return subject;
  const named = demoCompany(key);
  if (named !== null) return named;
  const index = receiptCardIndex(key);
  return index === null ? null : (receipt[index - 1] ?? null);
}

/** Every record key a scene's actions name. */
export function fixtureKeysOf(actions: readonly TourAction[]): FixtureKey[] {
  const keys = new Set<FixtureKey>();
  for (const action of actions) {
    if (action.kind === "openCompany") keys.add(action.company);
    if (action.kind === "buildComparison") {
      for (const company of action.companies) keys.add(company);
    }
    if (action.kind === "askApprovedQuestion" && action.subject !== undefined) {
      keys.add(action.subject);
    }
  }
  return [...keys];
}
