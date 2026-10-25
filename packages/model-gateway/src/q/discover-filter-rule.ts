/**
 * QA F-114 (25 Oct 2026, savanna-seed, 07a748ac): "Only fintech ones in
 * Kenya or Nigeria that are raising now." after Q's own list opened
 * Discover and set its filters, adding Verified, Has pitch video and Raise
 * shared, and showed "No companies match these filters" -- while Silo
 * Credit, Ledgerfold and MedTrail are Nigerian fintechs that are raising.
 *
 * Two rules, decided by code at the tool port, whatever the model calls:
 *
 * - A narrowing of the list Q just gave is answered in the thread (the
 *   narrowed cards, from the catalog, where "raising now" is the network
 *   rank's own raise read). Their Discover page changes only when they
 *   asked for it (the reader's named action) or are on it.
 * - A filter Q does set carries only what they stated: sector, country and
 *   stage as the turn reader read them, and a raise range the model gives.
 *   Verified only, has a pitch video and raise shared only are kept
 *   exactly when the reader read them from the person's words ("only
 *   verified ones"), and dropped when only the model added them. "Raising
 *   now" is not "raise shared": a raise stated in a pitch counts as raising
 *   for the rank, so the page is not narrowed to shared raises for it.
 */

export const SET_DISCOVER_FILTERS_TOOL = "set_discover_filters";

export type DiscoverRule = {
  /** The turn reader's structure for a company search, if it read one. */
  readonly discover: {
    readonly sectors: readonly string[];
    readonly countries: readonly string[];
    readonly stages: readonly string[];
    readonly raising?: boolean | undefined;
    readonly verifiedOnly?: boolean | undefined;
    readonly hasPitch?: boolean | undefined;
    readonly raiseShared?: boolean | undefined;
  } | null;
  /** A narrowing of a list Q just answered. */
  readonly narrowing: boolean;
  /** They asked for Discover itself (the reader's action) or are on it. */
  readonly asked: boolean;
};

export type DiscoverFilterDecision =
  | { readonly kind: "REFUSE"; readonly safeMessage: string }
  | { readonly kind: "SET"; readonly arguments: Record<string, unknown> };

/** Each filter-sheet qualifier and the reading that states it. */
const QUALIFIERS = [
  ["verifiedOnly", "verifiedOnly"],
  ["hasPitch", "hasPitch"],
  ["raiseDisclosedOnly", "raiseShared"],
] as const;

export function discoverFilterDecision(
  args: unknown,
  rule: DiscoverRule | undefined,
): DiscoverFilterDecision {
  if (rule?.narrowing === true && !rule.asked) {
    return {
      kind: "REFUSE",
      safeMessage:
        "They narrowed the list you just gave them and did not ask to change their Discover page. Answer in the conversation: list the companies that match (discover_companies with their sectors, countries and raising), and change nothing on their screen.",
    };
  }
  const given =
    typeof args === "object" && args !== null
      ? { ...(args as Record<string, unknown>) }
      : {};
  const read = rule?.discover ?? null;
  for (const [qualifier, stated] of QUALIFIERS) {
    if (read?.[stated] === true) given[qualifier] = true;
    else delete given[qualifier];
  }
  if (read !== null) {
    if (read.sectors.length > 0) given["sectors"] = [...read.sectors];
    if (read.countries.length > 0) {
      given["countries"] = read.countries.map((code) => code.toUpperCase());
    }
    if (read.stages.length > 0) given["stages"] = [...read.stages];
  }
  return { kind: "SET", arguments: given };
}

/**
 * QA F-109/F-110 (run 4dbd529e): "ranked, with why" was answered as
 * comparison cards, not answer cards, so the narrowing that followed was
 * not seen as one of Q's own list and set their Discover filters. Q's
 * newest answer gave a list of companies when it carries company answer
 * cards, comparison cards, a table, or two or more company references.
 */
export function newestAnswerListsCompanies(
  earlier: readonly {
    readonly role: string;
    readonly blocks?: readonly unknown[] | null | undefined;
  }[],
): boolean {
  const newest = [...earlier].reverse().find((one) => one.role === "Q");
  const blocks = (newest?.blocks ?? []).filter(
    (block): block is object => typeof block === "object" && block !== null,
  );
  let references = 0;
  for (const block of blocks) {
    switch (Reflect.get(block, "kind")) {
      case "ANSWER_CARDS": {
        const cards: unknown = Reflect.get(block, "cards");
        if (
          Array.isArray(cards) &&
          cards.some((card: unknown) => {
            if (typeof card !== "object" || card === null) return false;
            const subject: unknown = Reflect.get(card, "subject");
            return (
              typeof subject === "object" &&
              subject !== null &&
              Reflect.get(subject, "kind") === "COMPANY"
            );
          })
        ) {
          return true;
        }
        break;
      }
      case "COMPARISON_CARDS":
      case "COMPARISON":
      case "TABLE":
        return true;
      case "COMPANY_REFERENCE":
        references += 1;
        break;
      default:
        break;
    }
  }
  return references >= 2;
}
