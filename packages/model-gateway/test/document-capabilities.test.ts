import { describe, expect, it } from "vitest";

import { TURN_DOCUMENT_TYPES_V14 } from "@capital-q/q-core";
import { eligibleCapabilities, Q_CAPABILITIES } from "@capital-q/q-tools";

import { capabilityNote } from "../src/q/index.js";

/**
 * Founder live 2026-09-28 #1: Q said "I can't create or attach a PDF"
 * while it could. Every document the registry says Q prepares must be one
 * the turn reader can ask for, and one the answer model is told about by
 * name, so a registered capability is never refused.
 */
const documentTypes = Q_CAPABILITIES.flatMap((capability) =>
  capability.performedBy.kind === "HAND" &&
  capability.performedBy.hand.kind === "PREPARE_DOCUMENT"
    ? [capability.performedBy.hand.documentType]
    : [],
);

describe("every registered document is reachable and named", () => {
  it("covers answers and written pieces, not only decks, briefs and mandates", () => {
    expect(documentTypes).toEqual(
      expect.arrayContaining(["ANSWER_EXPORT", "Q_REPORT"]),
    );
  });

  it.each(documentTypes)("the turn reader can ask for %s", (type) => {
    expect(TURN_DOCUMENT_TYPES_V14).toContain(type);
  });

  it("offers answers as documents whenever documents can be filed at all", () => {
    const eligible = eligibleCapabilities({
      surface: "HOME_Q",
      offeredTools: new Set(),
      company: false,
      ownInvestorOrganisation: false,
      artifacts: true,
      ownMandate: false,
      visibility: false,
    }).map((capability) => capability.id);
    expect(eligible).toEqual(
      expect.arrayContaining(["document.ANSWER_EXPORT", "document.Q_REPORT"]),
    );
  });

  it("tells the answer model each one by name, and never to refuse a PDF", () => {
    const note = capabilityNote(
      { navigate: [], documents: documentTypes, visibilityChange: false },
      [],
      [],
    ).content;
    // Named in words, never by a code the model would have to guess at.
    expect(note).not.toMatch(/answer export|q report/i);
    expect(note).toContain("an answer you already gave, as a document");
    expect(note).toContain("never say you cannot make a PDF");
  });
});
