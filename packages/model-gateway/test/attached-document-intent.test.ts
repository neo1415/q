import { describe, expect, it } from "vitest";

import {
  attachedDocumentIntent,
  attachedDocumentNote,
} from "../src/q/attached-document-intent.js";
import { environmentNoteParts, joinedNoteParts } from "../src/q/index.js";

/**
 * Owner, 23 Oct 2026: "I uploaded a document and asked about it. Instead of
 * a summary of what's in it, it was just critical." What a turn about an
 * attached document asks for is read by code from their words: a summary
 * first unless they ask for a critique.
 */
describe("what a turn about an attached document asks for", () => {
  it.each([
    "",
    'I\'ve attached "term-sheet.pdf". Tell me briefly what it is and what it says.',
    "what's this about?",
    "What is this?",
    "what does it say",
    "Tell me about this",
    "Summarise it",
    "summarize this for me please",
    "Can you give me an overview?",
    "walk me through it",
    "tl;dr",
    "here you go",
    "fyi",
  ])("%j is a summary", (said) => {
    expect(attachedDocumentIntent(said)).toBe("SUMMARY");
  });

  it.each([
    "Review this",
    "What's wrong with it?",
    "critique my deck",
    "Is this good?",
    "is it any good",
    "What are the weaknesses?",
    "any red flags?",
    "What's missing from this contract?",
    "What are the risks here?",
    "Give me feedback on this",
    "how can I improve this deck",
  ])("%j is a critique", (said) => {
    expect(attachedDocumentIntent(said)).toBe("CRITIQUE");
  });

  it.each([
    "What's the liquidation preference?",
    "what does it say about valuation?",
    "Who is the lead investor on this round?",
    "When does the lease end?",
  ])("%j is a question answered from it", (said) => {
    expect(attachedDocumentIntent(said)).toBe("QUESTION");
  });

  it("a summary leads with what it says and offers the critique in one line", () => {
    const note = attachedDocumentNote(["Term sheet"], "SUMMARY");
    expect(note).toContain('"Term sheet"');
    expect(note).toContain("Open with what it is");
    expect(note).toContain("no RISK or GAP findings");
    expect(note).toContain("Want my read on what's weak?");
    expect(note).toContain("do not open with what is missing");
  });

  it("critique only when asked; a question gets no unasked critique", () => {
    expect(attachedDocumentNote(["Deck"], "CRITIQUE")).toContain(
      "what is strong and what is weak",
    );
    expect(attachedDocumentNote(["Deck"], "QUESTION")).toContain(
      "Add no critique they did not ask for",
    );
  });

  it("the note is a trusted turn note, ahead of the other turn guidance", () => {
    const parts = environmentNoteParts([], [], [], {
      attachedDocument: { titles: ["Term sheet"], intent: "SUMMARY" },
    });
    expect(parts.turn.startsWith('THEY ATTACHED "Term sheet"')).toBe(true);
    expect(joinedNoteParts(parts)).toContain("Want my read on what's weak?");
    expect(environmentNoteParts([], [], [], {}).turn).not.toContain(
      "THEY ATTACHED",
    );
  });
});
