import type { QAnswerCardsBlock } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * The record behind each answer card (R0, Zino live 2026-10-06: every card
 * of the day came with subject null, so "Open profile" could never show
 * and a card could not open its company).
 *
 * A card names a company in words; the id comes only from what this run's
 * own tools returned -- authorised reads, under the plan -- never from the
 * model. A name matches when it is the same name, letters and digits only;
 * a card no tool result names keeps no subject.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/[^a-z0-9]+/gu, "");
}

/** Every {company id, name} pair a tool's authorised output carries. */
export function companiesInOutcome(
  outcome: Pick<QToolCallOutcome, "result">,
): { readonly companyId: string; readonly name: string }[] {
  if (!outcome.result.ok) return [];
  const found: { companyId: string; name: string }[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    // { companyId, name }, { id, canonicalName }, or a relationship's
    // counterpart { kind: "COMPANY", id, name }.
    const id =
      record.companyId ??
      (record.canonicalName !== undefined || record.kind === "COMPANY"
        ? record.id
        : undefined);
    const name = record.canonicalName ?? record.name ?? record.companyName;
    if (typeof id === "string" && UUID.test(id) && typeof name === "string") {
      found.push({ companyId: id.toLowerCase(), name });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(outcome.result.data, 0);
  return found;
}

/**
 * The companies one run's tools have returned, by run, bounded: a run that
 * never asks for its list is forgotten once newer runs push it out.
 */
export function createRunCompanies(limit = 200) {
  const runs = new Map<string, Map<string, string>>();
  return {
    note(runId: string, outcome: Pick<QToolCallOutcome, "result">): void {
      const found = companiesInOutcome(outcome);
      if (found.length === 0) return;
      let known = runs.get(runId);
      if (known === undefined) {
        known = new Map();
        runs.set(runId, known);
        if (runs.size > limit) {
          const oldest = runs.keys().next().value;
          if (oldest !== undefined) runs.delete(oldest);
        }
      }
      for (const { companyId, name } of found) {
        const key = nameKey(name);
        if (key.length > 0 && !known.has(key)) known.set(key, companyId);
      }
    },
    take(runId: string): ReadonlyMap<string, string> {
      const known = runs.get(runId) ?? new Map<string, string>();
      runs.delete(runId);
      return known;
    },
  };
}

/** The block, with each card's company where a tool of this run named it. */
export function withCardSubjects(
  block: QAnswerCardsBlock,
  known: ReadonlyMap<string, string>,
): QAnswerCardsBlock {
  if (known.size === 0) return block;
  return {
    ...block,
    cards: block.cards.map((card) => {
      if (card.subject !== null) return card;
      const companyId = known.get(nameKey(card.name));
      return companyId === undefined
        ? card
        : { ...card, subject: { kind: "COMPANY" as const, companyId } };
    }),
  };
}
