/**
 * The page of one relationship by its id (C4, 13 Nov: the SCHEDULE card's
 * "Open the prep brief" went to the Relationships hub, so the call it named
 * was lost). Resolved from the person's OWN relationships, as the API lists
 * them for them: an id that is not theirs resolves to nothing, and the hub
 * opens instead -- the id grants nothing.
 */
export const RELATIONSHIP_PARAM = "relationship";
export const RELATIONSHIP_OPEN_PARAM = "open";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type OwnRelationshipRef = {
  readonly relationshipId: string;
  readonly counterpart: {
    readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly id: string;
  };
};

/** The hub link that opens one relationship's calls. */
export function relationshipCallsLink(relationshipId: string): string {
  return `/relationships?${RELATIONSHIP_PARAM}=${encodeURIComponent(relationshipId)}&${RELATIONSHIP_OPEN_PARAM}=calls`;
}

/** Where that link lands, given what the person may see; null: the hub. */
export function ownRelationshipHref(
  params: Readonly<Record<string, string | undefined>>,
  own: readonly OwnRelationshipRef[] | undefined,
): string | null {
  const wanted = params[RELATIONSHIP_PARAM];
  if (wanted === undefined || !UUID_RE.test(wanted)) return null;
  const item = (own ?? []).find(
    (one) => one.relationshipId.toLowerCase() === wanted.toLowerCase(),
  );
  if (item === undefined) return null;
  const side = item.counterpart.kind === "COMPANY" ? "company" : "investor";
  const base = `/relationships/${side}/${encodeURIComponent(item.counterpart.id)}`;
  return params[RELATIONSHIP_OPEN_PARAM] === "calls" ? `${base}/calls` : base;
}
