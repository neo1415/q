import type { ActorContext } from "@capital-q/security";
import type { OwnRecordsPort, OwnRelationships } from "@capital-q/q-tools";

/**
 * Owner QA 2026-10-23 (QO-07): investor Zino asked "Write me a 12-month
 * plan" and got a generic document naming none of his companies. An
 * analysis written FOR someone is grounded in their own context: an
 * investor's organisation, mandates and pipeline; a founder's
 * relationships with investors (their company is read separately). Every
 * read goes through the owning service as the person -- the same reads
 * their screens make -- and the document is private to them.
 */

const RECORD_MAX = 4_000;
const PIPELINE_MAX = 40;

function compact(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  const text = JSON.stringify(data);
  return text.length > RECORD_MAX ? `${text.slice(0, RECORD_MAX)}…` : text;
}

export function createOwnContextReader(dependencies: {
  /** Their own investor organisation's id, resolved from membership; null: none. */
  readonly ownInvestorOrganisation: (
    actor: ActorContext,
  ) => Promise<string | null>;
  readonly records: Pick<OwnRecordsPort, "read">;
  readonly relationships?:
    ((actor: ActorContext) => Promise<OwnRelationships | null>) | undefined;
}) {
  return async (actor: ActorContext): Promise<string | null> => {
    const lines: string[] = [];
    const investorId = await dependencies
      .ownInvestorOrganisation(actor)
      .catch(() => null);
    if (investorId !== null) {
      const read = (record: "INVESTOR_ORGANISATION" | "INVESTOR_MANDATES") =>
        dependencies.records
          .read(actor, {
            record,
            subjectType: "INVESTOR_ORGANISATION",
            subjectId: investorId,
          })
          .catch(() => null);
      const [organisation, mandates] = await Promise.all([
        read("INVESTOR_ORGANISATION"),
        read("INVESTOR_MANDATES"),
      ]);
      const org = compact(organisation);
      const mandate = compact(mandates);
      lines.push(
        org === null
          ? "Their investor organisation: not readable just now (unknown)."
          : `Their investor organisation (their own record, as declared): ${org}`,
        mandate === null
          ? "Their mandates: none on record or not readable (unknown)."
          : `Their mandates (declared): ${mandate}`,
      );
    }
    const own =
      dependencies.relationships === undefined
        ? undefined
        : await dependencies.relationships(actor).catch(() => undefined);
    if (own === undefined) {
      lines.push("Their pipeline: not readable just now (unknown).");
    } else if (own !== null) {
      const items = own.items.slice(0, PIPELINE_MAX);
      lines.push(
        items.length === 0
          ? "Their pipeline: no relationships yet."
          : [
              `Their pipeline (${own.side === "INVESTOR" ? "companies they are talking to" : "investors their company is talking to"}, as their relationships screen lists them):`,
              ...items.map(
                (item) =>
                  `- ${item.counterpart.name} (${item.counterpart.kind}): ${item.state} since ${item.stateSince.slice(0, 10)}; next step: ${item.nextStep}`,
              ),
              ...(own.items.length > items.length
                ? [`(and ${String(own.items.length - items.length)} more)`]
                : []),
            ].join("\n"),
      );
    }
    return lines.length === 0 ? null : lines.join("\n");
  };
}
