import type { OwnReadItem } from "@capital-q/app-actions";
import type { InterestService } from "@capital-q/network";
import type { DiligenceService } from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

/**
 * read_my("diligence") (2026-10-02): the diligence areas of their own
 * relationships, as the relationship page shows them to their side -- what
 * the investor asked for and whether it was answered, and what the company
 * shared. Read through the diligence service, which decides the party for
 * every relationship; only relationships where diligence started.
 */

const AREAS_MAX = 5;
const FACT_MAX = 200;

const clip = (parts: readonly string[]): string | null => {
  const joined = parts.join("; ");
  if (joined.length === 0) return null;
  return joined.length > FACT_MAX
    ? `${joined.slice(0, FACT_MAX - 1)}…`
    : joined;
};

type OwnDiligenceDependencies = {
  readonly interests: Pick<
    InterestService,
    "listRelationshipsForInvestor" | "listRelationshipsForCompany"
  >;
  readonly diligence: Pick<DiligenceService, "view">;
  readonly ownCompanyId: (actor: ActorContext) => Promise<string | null>;
};

/**
 * QO-15 (QA 2026-10-23): an investor asking for their data room requests
 * is told what they asked each company for and where it stands, from the
 * same diligence read: "You've asked three companies for documents: Kora
 * (2 open, 1 answered), …". Null when nothing can be read.
 */
export function createDiligenceSummary(
  dependencies: OwnDiligenceDependencies,
): (actor: ActorContext) => Promise<string | null> {
  const areas = createOwnDiligence(dependencies);
  return async (actor) => {
    const read = await areas(actor).catch(() => null);
    if (read === null) return null;
    if (read.length === 0) {
      return "You haven't asked any company for documents yet.";
    }
    const parts = read.map((item) => {
      const name = item.title.replace(/^Diligence with /u, "");
      const open = Number(item.facts["openCount"] ?? 0);
      const answered = Number(item.facts["answeredCount"] ?? 0);
      const state = [
        open > 0 ? `${String(open)} open` : null,
        answered > 0 ? `${String(answered)} answered` : null,
      ].filter((part): part is string => part !== null);
      return `${name} (${state.length === 0 ? "nothing asked yet" : state.join(", ")})`;
    });
    const listed =
      parts.length === 1
        ? (parts[0] ?? "")
        : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
    return `You've asked ${read.length === 1 ? "one company" : `${String(read.length)} companies`} for documents: ${listed}.`;
  };
}

export function createOwnDiligence(
  dependencies: OwnDiligenceDependencies,
): (actor: ActorContext) => Promise<readonly OwnReadItem[]> {
  return async (actor) => {
    const companyId = await dependencies.ownCompanyId(actor).catch(() => null);
    const listings =
      companyId === null
        ? await dependencies.interests
            .listRelationshipsForInvestor({ actor })
            .catch(() => [])
        : await dependencies.interests
            .listRelationshipsForCompany({ actor, companyId })
            .catch(() => []);
    const inDiligence = listings
      .filter((listing) =>
        listing.projection.milestones.some(
          (milestone) => milestone.state === "IN_DILIGENCE",
        ),
      )
      .slice(0, AREAS_MAX);
    const items = await Promise.all(
      inDiligence.map(async (listing) => {
        const view = await dependencies.diligence
          .view({ actor, relationshipId: listing.relationship.id })
          .catch(() => null);
        if (view === null) return null;
        const open = view.requests.filter((r) => r.status === "OPEN");
        const item: OwnReadItem = {
          id: listing.relationship.id,
          title: `Diligence with ${listing.counterpartName}`.slice(0, 200),
          status: view.open ? `${String(open.length)} requests open` : "closed",
          at: listing.projection.stateSince,
          facts: {
            openCount: open.length,
            answeredCount: view.requests.filter((r) => r.status === "FULFILLED")
              .length,
            openRequests: clip(open.map((r) => r.title)),
            answeredRequests: clip(
              view.requests
                .filter((r) => r.status === "FULFILLED")
                .map((r) => r.title),
            ),
            sharedDocuments: clip(view.shares.map((s) => s.title)),
            yourSide: view.side,
          },
        };
        return item;
      }),
    );
    return items.filter((item): item is OwnReadItem => item !== null);
  };
}
