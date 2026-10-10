import { parseOrgName, scoreOrgNames } from "./org.js";
import { parsePersonName, scoreTokens } from "./person.js";
import { tokenize, type NameToken } from "./tokens.js";

/**
 * Proper-name intelligence, step 7: repairing what a speech recogniser
 * heard against the names the person is known to use. The lexicon is the
 * asker's OWN set (their contacts, their company and counterparts).
 *
 * Rules that keep a person's real name intact:
 *  - words that already equal a lexicon name, or any other name, are left;
 *  - a name with no near lexicon entry is left (it may be a stranger);
 *  - a repair is APPLIED only when exactly one entry fits and context
 *    supports it (the full name matches both parts, or the entry's
 *    employer or city is also in the sentence); otherwise it is only
 *    SUGGESTED and the text is unchanged;
 *  - the original text is always returned.
 */

export type LexiconEntry = {
  readonly kind: "person" | "organisation";
  readonly name: string;
  readonly employer?: string | undefined;
  readonly city?: string | undefined;
};

export type Repair = {
  readonly from: string;
  readonly to: string;
  readonly score: number;
  readonly applied: boolean;
  readonly reason: "FULL_NAME" | "CONTEXT" | "NEEDS_CONTEXT" | "AMBIGUOUS";
};

export type RepairResult = {
  readonly original: string;
  readonly text: string;
  readonly repairs: readonly Repair[];
};

type Span = {
  readonly word: string;
  readonly start: number;
  readonly end: number;
};

const spansOf = (text: string): readonly Span[] =>
  [...text.matchAll(/[\p{L}\p{M}'’]+/gu)].map((m) => ({
    word: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));

const tokensOfEntry = (entry: LexiconEntry): readonly NameToken[] =>
  entry.kind === "person"
    ? parsePersonName(entry.name).tokens
    : parseOrgName(entry.name).brand;

const FLOOR = 0.86;
const RIVAL_GAP = 0.06;

type Hit = {
  readonly from: number;
  readonly to: number;
  readonly entry: LexiconEntry;
  readonly score: number;
  readonly joined: boolean;
};

export function repairTranscript(
  text: string,
  lexicon: readonly LexiconEntry[],
): RepairResult {
  const spans = spansOf(text);
  const lower = text.toLowerCase();
  const exactNames = new Set(lexicon.map((e) => e.name.toLowerCase()));
  const hits: { hit: Hit; rivals: number }[] = [];
  const entries = lexicon.map((entry) => ({
    entry,
    tokens: tokensOfEntry(entry),
  }));
  for (let start = 0; start < spans.length; start += 1) {
    const candidates: Hit[] = [];
    for (const { entry, tokens } of entries) {
      if (tokens.length === 0) continue;
      // Windows of the entry's word count, and a single entry word that
      // the recogniser split in two ("Mid Mack" for Midmac).
      const sizes = tokens.length === 1 ? [1, 2] : [tokens.length];
      for (const size of sizes) {
        const first = spans[start];
        const last = spans[start + size - 1];
        if (first === undefined || last === undefined) continue;
        const surface = text.slice(first.start, last.end);
        const heard =
          size === 2 && tokens.length === 1
            ? tokenize(`${first.word}${last.word}`)
            : tokenize(surface);
        if (heard.length !== tokens.length) continue;
        if (surface.toLowerCase() === entry.name.toLowerCase()) continue;
        const match = scoreTokens(heard, tokens, { allowSingle: true });
        if (match.score >= FLOOR && match.matchedParts === tokens.length) {
          candidates.push({
            from: first.start,
            to: last.end,
            entry,
            score: match.score,
            joined: size === 2 && tokens.length === 1,
          });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0];
    if (top === undefined) continue;
    const rivals = candidates.filter(
      (one) =>
        one.entry.name !== top.entry.name && top.score - one.score < RIVAL_GAP,
    ).length;
    hits.push({ hit: top, rivals });
  }
  // Longest span wins where windows overlap.
  hits.sort((a, b) => b.hit.to - b.hit.from - (a.hit.to - a.hit.from));
  const taken: { from: number; to: number }[] = [];
  const chosen: { hit: Hit; rivals: number }[] = [];
  for (const one of hits) {
    if (taken.some((t) => one.hit.from < t.to && one.hit.to > t.from)) continue;
    // Never overwrite words that are exactly another known name.
    if (exactNames.has(text.slice(one.hit.from, one.hit.to).toLowerCase())) {
      continue;
    }
    taken.push({ from: one.hit.from, to: one.hit.to });
    chosen.push(one);
  }
  const repairs: Repair[] = [];
  const appliedHits: Hit[] = [];
  for (const { hit, rivals } of chosen) {
    const surface = text.slice(hit.from, hit.to);
    const fullName =
      hit.entry.kind === "person" && tokensOfEntry(hit.entry).length >= 2;
    const supported =
      [hit.entry.employer, hit.entry.city].some(
        (clue) => clue !== undefined && mentions(lower, clue),
      ) ||
      chosen.some(
        (other) =>
          other.hit !== hit &&
          (linked(hit.entry.employer, other.hit.entry.name) ||
            linked(other.hit.entry.employer, hit.entry.name)),
      ) ||
      otherEntryNear(lexicon, hit, text);
    let reason: Repair["reason"];
    if (rivals > 0) reason = "AMBIGUOUS";
    else if (fullName) reason = "FULL_NAME";
    else if (supported) reason = "CONTEXT";
    else reason = "NEEDS_CONTEXT";
    const applied = reason === "FULL_NAME" || reason === "CONTEXT";
    if (applied) appliedHits.push(hit);
    repairs.push({
      from: surface,
      to: hit.entry.name,
      score: hit.score,
      applied,
      reason,
    });
  }
  let out = text;
  for (const hit of appliedHits.sort((x, y) => y.from - x.from)) {
    out = out.slice(0, hit.from) + hit.entry.name + out.slice(hit.to);
  }
  return { original: text, text: out, repairs };
}

/** An entry's employer is the other entry (same organisation by name). */
const linked = (employer: string | undefined, name: string): boolean =>
  employer !== undefined && scoreOrgNames(employer, name).score >= 0.85;

function mentions(lowerText: string, clue: string): boolean {
  if (lowerText.includes(clue.toLowerCase())) return true;
  const first = parseOrgName(clue).brand.slice(0, 1);
  if (first.length === 0) return false;
  return tokenize(lowerText).some(
    (heard) =>
      scoreTokens([heard], first, { allowSingle: true }).score >= FLOOR,
  );
}

/** Another lexicon entry that the same sentence says (its own repair or exact). */
function otherEntryNear(
  lexicon: readonly LexiconEntry[],
  hit: Hit,
  text: string,
): boolean {
  const rest = text.slice(0, hit.from) + " " + text.slice(hit.to);
  return lexicon.some(
    (other) =>
      other.name !== hit.entry.name &&
      other.name.length > 2 &&
      rest.toLowerCase().includes(other.name.toLowerCase()),
  );
}
