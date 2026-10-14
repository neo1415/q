import {
  DisclosureDocumentIdentitySchema,
  DisclosureLineageSchema,
  type DisclosureDocumentIdentity,
  type DisclosureLineage,
} from "../contracts/disclosure-lineage.js";

export { DisclosureDocumentIdentitySchema, DisclosureLineageSchema };
export type { DisclosureDocumentIdentity, DisclosureLineage };

const identityKey = (document: DisclosureDocumentIdentity): string =>
  `${document.documentId}:${document.versionId}:${document.sha256}`;

/**
 * Fail-closed projection for document-informed applications only. Callers must
 * recompute qualification, coverage and dossier from returned facts, never
 * reuse the private draft's qualification or snapshot. Empty complete lineage
 * is a server-proven text-only input, not a default for historical rows.
 */
export function projectSelectedDisclosure<
  Fact extends {
    readonly disclosureLineage?: DisclosureLineage | undefined;
    readonly sourceTurnSeq?: number | null | undefined;
  },
  Turn extends {
    readonly seq: number;
    readonly disclosureLineage?: DisclosureLineage | undefined;
  },
>(input: {
  readonly selectedDocuments: readonly DisclosureDocumentIdentity[];
  readonly facts: readonly Fact[];
  readonly turns: readonly Turn[];
}): { readonly facts: readonly Fact[]; readonly turns: readonly Turn[] } {
  const selected = new Set(
    input.selectedDocuments.map((document) =>
      identityKey(DisclosureDocumentIdentitySchema.parse(document)),
    ),
  );
  const bySeq = new Map<number, Turn>();
  for (const turn of input.turns) {
    if (bySeq.has(turn.seq))
      throw new Error("Duplicate disclosure turn identity");
    bySeq.set(turn.seq, turn);
  }
  const safeTurns = new Map<number, boolean>();
  const permits = (lineage: DisclosureLineage | undefined): boolean => {
    const parsed = DisclosureLineageSchema.safeParse(lineage);
    if (!parsed.success || parsed.data.state !== "COMPLETE") return false;
    return (
      parsed.data.documents.every((document) =>
        selected.has(identityKey(document)),
      ) && parsed.data.turnSeqs.every((seq) => permitsTurn(seq))
    );
  };
  const permitsTurn = (seq: number): boolean => {
    const known = safeTurns.get(seq);
    if (known !== undefined) return known;
    const turn = bySeq.get(seq);
    if (turn === undefined) return false;
    // Mark before recursion: cycles and self-dependencies fail closed.
    safeTurns.set(seq, false);
    const permitted = permits(turn.disclosureLineage);
    safeTurns.set(seq, permitted);
    return permitted;
  };
  return {
    facts: input.facts.filter(
      (fact) =>
        permits(fact.disclosureLineage) &&
        (fact.sourceTurnSeq == null || permitsTurn(fact.sourceTurnSeq)),
    ),
    turns: input.turns.filter((turn) => permitsTurn(turn.seq)),
  };
}
