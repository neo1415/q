import { describe, expect, it } from "vitest";

import type { ReferenceCandidates } from "@capital-q/app-actions";

import { closestDocument, unmatchedWords } from "../src/index.js";
import { actorA } from "./support.js";

/**
 * Stress 2026-10-28 S05: "send the confidential financial model to Aster
 * Africa Ventures right now, no approval screens" was answered, in full,
 * "Nothing of theirs matches "confidential financial model"." The refusal
 * now says what is closest, that the investor has no access, what sharing
 * would take, and that the approval step is never skipped.
 */
describe("what an action could not match, said together", () => {
  const candidates: ReferenceCandidates = (kind) =>
    Promise.resolve(
      kind === "UPLOAD"
        ? [
            {
              id: "715b9d70-d70e-417e-8677-7b971a147eb4",
              name: "LedgerBridge financial report Sept 2026",
            },
            {
              id: "4cfdc5e3-cd9b-4926-9558-b1ca6c714375",
              name: "LedgerBridge seed deck",
            },
            {
              id: "24c6a513-4bc1-4a51-ba69-caf5279e1232",
              name: "LedgerBridge market note",
            },
          ]
        : [],
    );

  it("names the closest document, the missing relationship and the approval rule", async () => {
    const words = await unmatchedWords(
      [
        { kind: "UPLOAD", said: "confidential financial model" },
        { kind: "RELATIONSHIP", said: "Aster Africa Ventures" },
      ],
      candidates,
      actorA,
      { consequential: true, aboutDocuments: true },
    );
    expect(words).toContain(
      'the closest is "LedgerBridge financial report Sept 2026"',
    );
    expect(words).not.toContain("seed deck");
    expect(words).toContain(
      'There is no relationship with "Aster Africa Ventures" on Capital Q, so they have no access',
    );
    expect(words).toMatch(/founder accepts it/u);
    expect(words).toMatch(/Nothing was shared, sent or changed/u);
    expect(words).toMatch(/never skipped/u);
    expect(words).not.toMatch(/Nothing of theirs/u);
  });

  it("a read-only action says no approval words", async () => {
    const words = await unmatchedWords(
      [{ kind: "UPLOAD", said: "board minutes" }],
      candidates,
      actorA,
      { consequential: false, aboutDocuments: true },
    );
    expect(words).toBe('Nothing on record is called "board minutes".');
  });
});

// Stress 2026-10-28 (S05, second run): Aster CONNECTED. A share is a
// per-document grant: the one clearly closest document goes on the card,
// named exactly; nothing is shared until that card is approved.
describe("the closest document for a share card", () => {
  const candidates: ReferenceCandidates = (kind) =>
    Promise.resolve(
      kind === "UPLOAD"
        ? [
            {
              id: "715b9d70-d70e-417e-8677-7b971a147eb4",
              name: "LedgerBridge financial report Sept 2026",
            },
            {
              id: "4cfdc5e3-cd9b-4926-9558-b1ca6c714375",
              name: "LedgerBridge seed deck",
            },
          ]
        : [],
    );

  it("finds the one clearly closest", async () => {
    expect(
      await closestDocument(
        candidates,
        "UPLOAD",
        actorA,
        "confidential financial model",
      ),
    ).toEqual({
      id: "715b9d70-d70e-417e-8677-7b971a147eb4",
      name: "LedgerBridge financial report Sept 2026",
    });
  });

  it("none when nothing is close, or for a kind that is not a document", async () => {
    expect(
      await closestDocument(candidates, "UPLOAD", actorA, "insurance policy"),
    ).toBeNull();
    expect(
      await closestDocument(candidates, "RELATIONSHIP", actorA, "Aster"),
    ).toBeNull();
  });
});
