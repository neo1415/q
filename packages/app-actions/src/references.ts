import { closestByName } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * Fields that name a record (ADR 0040): Q may fill them with an id or the
 * name the person said ("Nixon" for Nixo, "my pitch video"). One coercion
 * for every action: an id passes through for the action's own authorize
 * step to judge; a name is matched among the records of that kind the
 * person can already see, by the same matcher everywhere, and only one
 * clear match is ever taken.
 */
export const REFERENCE_KINDS = [
  "COMPANY",
  "RELATIONSHIP",
  "DOCUMENT",
  // A file they uploaded (deck, financials): DOCUMENT is Q's own drafts.
  "UPLOAD",
  "MEDIA",
  "REHEARSAL",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export type ReferenceCandidate = {
  readonly id: string;
  readonly name: string;
};

/** The records of one kind this person can see, for matching a said name. */
export type ReferenceCandidates = (
  kind: ReferenceKind,
  actor: ActorContext,
  said: string,
) => Promise<readonly ReferenceCandidate[]>;

export type ReferenceResolution =
  | { readonly kind: "RESOLVED"; readonly id: string }
  | { readonly kind: "NONE" }
  | { readonly kind: "SEVERAL"; readonly names: readonly string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Words that point at "the one" rather than naming it ("my pitch", "the video"). */
const POINTING =
  /^(?:(?:my|our|the|this|that)\s+)?(?:pitch|video|pitch video|document|doc|deck|rehearsal)s?$/i;

export async function resolveReference(
  candidates: ReferenceCandidates,
  kind: ReferenceKind,
  actor: ActorContext,
  said: string,
): Promise<ReferenceResolution> {
  const value = said.trim();
  if (UUID.test(value)) return { kind: "RESOLVED", id: value.toLowerCase() };
  const seen = await candidates(kind, actor, value).catch(() => []);
  // "my pitch video" with exactly one of that kind: that one.
  if (POINTING.test(value) && seen.length === 1 && seen[0] !== undefined) {
    return { kind: "RESOLVED", id: seen[0].id };
  }
  // A name is matched with and without its parenthetical ("Savanna Seed
  // Partners (fictional)", "Acme Capital (UK)"): people rarely say it
  // (parity eval 2026-10-03: "Savanna Seed Parters" matched nothing).
  const bare = (name: string) => name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const named = seen.flatMap((candidate) => {
    const short = bare(candidate.name);
    return short.length > 0 && short !== candidate.name
      ? [candidate, { ...candidate, name: short }]
      : [candidate];
  });
  const found = closestByName(
    named,
    value,
    (candidate) => candidate.name,
    (candidate) => candidate.id,
  );
  const ids = [...new Set(found.map((candidate) => candidate.id))];
  if (ids.length === 1 && ids[0] !== undefined) {
    return { kind: "RESOLVED", id: ids[0] };
  }
  return ids.length === 0
    ? { kind: "NONE" }
    : {
        kind: "SEVERAL",
        names: [
          ...new Set(
            found.map(
              (candidate) =>
                seen.find((one) => one.id === candidate.id)?.name ??
                candidate.name,
            ),
          ),
        ],
      };
}
