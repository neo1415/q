import type { FounderCandidate } from "./contracts.js";

/** Lower-case, accents folded, letters and digits only, split into words. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Whether these words name the person on this account: their first and
 * last names both appear as whole words (just the one, for a one-word
 * name). A comparison of names, never a reading of what the words mean.
 */
export function namesAccountHolder(text: string, name: string): boolean {
  const own = words(name);
  const first = own[0];
  const last = own.at(-1);
  if (first === undefined || last === undefined) return false;
  const said = new Set(words(text));
  return said.has(first) && said.has(last);
}

/**
 * QA F-74 (24 Oct): the deck read-back told Chidi Eze "you're the CEO";
 * the deck names Ngozi Adeyemi as CEO. A role read from material is about
 * whoever the material names. It is offered as the account holder's own
 * only when the words it rests on name them; otherwise nothing is assumed
 * and the role stays a question for them. What they said themselves (no
 * document origin) is theirs.
 */
export function isAccountHoldersOwn(
  candidate: FounderCandidate,
  accountName: string | null,
): boolean {
  if (candidate.key !== "founder_role" || candidate.origins.length === 0) {
    return true;
  }
  if (accountName === null || candidate.quote === null) return false;
  return namesAccountHolder(candidate.quote, accountName);
}
