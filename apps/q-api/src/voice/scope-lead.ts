import type { SpokenFacts } from "@capital-q/q-core";

/**
 * D5 (audit 14 Nov 2026): Q wrote "Leaving out the ones I've already
 * shown, here are the next best: Clearwater 9.5 …", and the voice said
 * "The strongest fit is Clearwater". The spoken line of a ranking is built
 * from its cards, so the scope Q put in front of it ("leaving out the ones
 * already shown", "I looked at the four you've reached out to") was lost,
 * and the person challenged a ranking they had misheard.
 *
 * The lead is Q's own written words before the first sentence that names a
 * ranked item: at most two short plain sentences, never markdown. Null when
 * there is none, or when the spoken line already says it.
 */
const LEAD_MAX_CHARS = 240;

export function scopeLeadOf(
  facts: SpokenFacts,
  written: string,
): string | null {
  if (facts.kind !== "RANKED") return null;
  const names = facts.items
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return null;
  const head = written.trimStart();
  const sentences = head.split(/(?<=[.!?])\s+/u);
  const lead: string[] = [];
  for (const sentence of sentences) {
    const plain = sentence.trim();
    if (plain.length === 0) break;
    if (names.some((name) => plain.includes(name))) break;
    // An opener that introduces the list ("Your top three:") is the list's.
    if (/:\s*$/u.test(plain)) break;
    // Written structure (a heading, a table, emphasis) is never spoken.
    if (/[\n#*|`_[\]]/u.test(plain)) return null;
    lead.push(plain);
    if (lead.length === 2) break;
  }
  const text = lead.join(" ");
  if (text.length === 0 || text.length > LEAD_MAX_CHARS) return null;
  if (!/[.!?]$/u.test(text)) return null;
  return facts.fallback.includes(text) ? null : text;
}

/** The facts with Q's scope said first, when Q gave one. */
export function withScopeLead(
  facts: SpokenFacts,
  written: string,
): SpokenFacts {
  const lead = scopeLeadOf(facts, written);
  return lead === null
    ? facts
    : { ...facts, fallback: `${lead} ${facts.fallback}` };
}
