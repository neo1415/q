import { describe, expect, it } from "vitest";

import {
  projectSelectedDisclosure,
  type DisclosureDocumentIdentity,
  type DisclosureLineage,
} from "../src/application/disclosure-projection.js";

const selected: DisclosureDocumentIdentity = {
  documentId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222",
  sha256: "a".repeat(64),
};
const excluded: DisclosureDocumentIdentity = {
  ...selected,
  documentId: "33333333-3333-4333-8333-333333333333",
};
const complete = (
  documents: readonly DisclosureDocumentIdentity[] = [],
  turnSeqs: readonly number[] = [],
): DisclosureLineage => ({
  state: "COMPLETE",
  documents: [...documents],
  turnSeqs: [...turnSeqs],
});

describe("selected disclosure confidentiality", () => {
  it("excludes private facts, mixed-source Q replies and downstream replies", () => {
    const result = projectSelectedDisclosure({
      selectedDocuments: [selected],
      facts: [
        { id: "public", disclosureLineage: complete([selected]) },
        { id: "private", disclosureLineage: complete([excluded]) },
        { id: "derived", disclosureLineage: complete([], [2]) },
        {
          id: "heard-private",
          disclosureLineage: complete(),
          sourceTurnSeq: 2,
        },
      ],
      turns: [
        { seq: 1, disclosureLineage: complete([selected]) },
        { seq: 2, disclosureLineage: complete([selected, excluded], [1]) },
        { seq: 3, disclosureLineage: complete([], [2]) },
        { seq: 4, disclosureLineage: complete([], [1]) },
      ],
    });
    expect(result.facts.map((fact) => fact.id)).toEqual(["public"]);
    expect(result.turns.map((turn) => turn.seq)).toEqual([1, 4]);
  });

  it("fails closed for missing, unknown, dangling and cyclic lineage", () => {
    const result = projectSelectedDisclosure({
      selectedDocuments: [selected],
      facts: [
        { id: "legacy" },
        { id: "unknown", disclosureLineage: { state: "UNKNOWN" } as const },
        { id: "dangling", disclosureLineage: complete([], [99]) },
      ],
      turns: [
        { seq: 1, disclosureLineage: complete([], [2]) },
        { seq: 2, disclosureLineage: complete([], [1]) },
        { seq: 3 },
      ],
    });
    expect(result).toEqual({ facts: [], turns: [] });
  });

  it("requires the exact frozen version and hash, and allows explicit no-doc disclosure", () => {
    const facts = [
      { id: "text", disclosureLineage: complete() },
      {
        id: "wrong-version",
        disclosureLineage: complete([
          { ...selected, versionId: excluded.documentId },
        ]),
      },
      {
        id: "wrong-hash",
        disclosureLineage: complete([{ ...selected, sha256: "b".repeat(64) }]),
      },
      { id: "doc", disclosureLineage: complete([selected]) },
    ];
    expect(
      projectSelectedDisclosure({
        selectedDocuments: [selected],
        facts,
        turns: [],
      }).facts.map((fact) => fact.id),
    ).toEqual(["text", "doc"]);
    expect(
      projectSelectedDisclosure({
        selectedDocuments: [],
        facts,
        turns: [],
      }).facts.map((fact) => fact.id),
    ).toEqual(["text"]);
  });

  it("refuses ambiguous duplicate turn identities", () => {
    expect(() =>
      projectSelectedDisclosure({
        selectedDocuments: [],
        facts: [],
        turns: [{ seq: 1 }, { seq: 1 }],
      }),
    ).toThrow("Duplicate disclosure turn identity");
  });
});
