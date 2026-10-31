import type { RelationshipBrief } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";
import {
  briefFacts,
  type OwnRecordsPort,
  type OwnRelationships,
} from "@capital-q/q-tools";

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
/** Relationships whose history is read in full for one document. */
const HISTORY_MAX = 2;

/** What the document is about: its company, and the words of the ask. */
export type OwnContextFocus = {
  readonly companyId: string | null;
  readonly goal: string;
  /**
   * Owner 2026-10-29: a research brief written from their whole situation
   * already holds their pipeline; it is not read again here then. Their
   * organisation and the mandate in force are read whatever the brief
   * says (live 2026-10-29: an IC memo's brief left the mandate out, and
   * the memo judged fit against none).
   */
  readonly briefed?: boolean | undefined;
};

/**
 * The relationships a document is about: the one with its company, or
 * those whose counterpart the ask names (exact name, whole words).
 */
export function relationshipsInFocus(
  own: OwnRelationships,
  focus: OwnContextFocus | undefined,
): OwnRelationships["items"] {
  if (focus === undefined) return [];
  const goal = focus.goal.toLowerCase();
  const named = (name: string) => {
    const wanted = name.toLowerCase().trim();
    if (wanted.length < 3) return false;
    const at = goal.indexOf(wanted);
    if (at < 0) return false;
    const before = at === 0 ? " " : (goal[at - 1] ?? " ");
    const after = goal[at + wanted.length] ?? " ";
    return !/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after);
  };
  return own.items
    .filter(
      (item) =>
        (focus.companyId !== null &&
          item.counterpart.id.toLowerCase() ===
            focus.companyId.toLowerCase()) ||
        named(item.counterpart.name),
    )
    .slice(0, HISTORY_MAX);
}

/** How the mandate in force is handed to the writer (mandateAmounts reads it). */
export const MANDATES_LINE = "Their mandates (declared): ";

/**
 * The money amounts of the person's own declared mandate (cheques, ticket
 * sizes, fund amounts), read back from its line: what a document may label
 * "(your mandate)", never "(company record)" (analysis.ts mandateLabels).
 */
export function mandateAmounts(context: string | null): readonly number[] {
  if (context === null) return [];
  const amounts = new Set<number>();
  for (const line of context.split("\n")) {
    if (!line.startsWith(MANDATES_LINE)) continue;
    // A cheque is held as {"cheque":{"min":…,"max":…,"currency":…}}
    // (own-records.ts declaredCriteria); a flat "minCheque": … reads too.
    for (const match of line.matchAll(
      /"[A-Za-z_]*(?:cheque|ticket|amount|aum|fund_?size|commitment)[A-Za-z_]*"\s*:\s*(\{[^{}]*\}|"?\d+(?:\.\d+)?)/giu,
    )) {
      for (const number of (match[1] ?? "").matchAll(/\d+(?:\.\d+)?/gu)) {
        const value = Number(number[0]);
        if (Number.isFinite(value) && value >= 1_000) amounts.add(value);
      }
    }
  }
  return [...amounts];
}

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
  /**
   * Stress 2026-10-28 (J7-I, J7-F): both meeting briefs said "no prior
   * interaction recorded" over an interest with its note and a shared
   * deck, because a document saw only the pipeline's state. The Relationship
   * Brief (the Network context's own read, as the person, for their side)
   * of the relationship the document is about. Absent: not composed.
   */
  readonly brief?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<RelationshipBrief | null>)
    | undefined;
}) {
  return async (
    actor: ActorContext,
    focus?: OwnContextFocus,
  ): Promise<string | null> => {
    const lines: string[] = [];
    const briefed = focus?.briefed === true;
    // The declared mandate in force is code's to hand the writer, never a
    // model's selection to make (a brief is one).
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
          : `${MANDATES_LINE}${mandate}`,
      );
    }
    const own =
      dependencies.relationships === undefined
        ? undefined
        : await dependencies.relationships(actor).catch(() => undefined);
    if (own === undefined) {
      if (!briefed)
        lines.push("Their pipeline: not readable just now (unknown).");
    } else if (own !== null) {
      const items = own.items.slice(0, PIPELINE_MAX);
      if (!briefed)
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
      const brief = dependencies.brief;
      if (brief !== undefined) {
        for (const item of relationshipsInFocus(own, focus)) {
          const read = await brief(actor, item.relationshipId).catch(
            () => undefined,
          );
          lines.push(
            read === undefined || read === null
              ? `What has happened with ${item.counterpart.name}: the relationship history could not be read just now (unknown, not "nothing").`
              : [
                  `What has happened with ${item.counterpart.name} (the relationship history as their side may see it, in order; recorded facts, never "no prior interaction" when steps are listed):`,
                  ...briefFacts(read).map((fact) => `- ${fact}`),
                ].join("\n"),
          );
        }
      }
    }
    return lines.length === 0 ? null : lines.join("\n");
  };
}
