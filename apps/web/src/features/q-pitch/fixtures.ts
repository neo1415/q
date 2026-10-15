import type { QMessage } from "@capital-q/contracts";
import type { FixtureKey, TourAction } from "@capital-q/q-pitch";

/**
 * Tour fixture keys → canonical records, resolved ONLY from what the
 * signed-in actor's own Q conversation already showed them (answer cards
 * with a resolved COMPANY subject). No lookup endpoint, no list of ids in
 * the bundle, no other actor's data: if the actor has not been shown the
 * company, the key does not resolve and the scene takes its fallback.
 *
 * The names are the existing fictional seeded companies the certified
 * runs used (CERTIFICATION_MANIFEST.md: Ledgerfold, F2).
 */
const FIXTURE_NAMES: Readonly<Record<string, RegExp>> = {
  ledgerfold: /^ledgerfold\b/iu,
  f2: /^f2\b/iu,
};

export type ResolvedCompany = {
  readonly companyId: string;
  readonly name: string;
};

export function resolveCompanyFixture(
  key: FixtureKey,
  messages: readonly QMessage[],
): ResolvedCompany | null {
  const pattern = FIXTURE_NAMES[key];
  if (pattern === undefined) return null;
  // Newest first: the most recent card the actor saw wins.
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const message = messages[m];
    if (message === undefined || message.role === "USER") continue;
    const blocks = message.blocks ?? [];
    for (const block of blocks) {
      if (block.kind !== "ANSWER_CARDS") continue;
      for (const card of block.cards) {
        if (card.subject?.kind !== "COMPANY") continue;
        if (pattern.test(card.name)) {
          return { companyId: card.subject.companyId, name: card.name };
        }
      }
    }
  }
  return null;
}

/** Every fixture key a scene's actions name. */
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
