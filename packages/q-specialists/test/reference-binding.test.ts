import { describe, expect, it } from "vitest";

import type { QConversationState, QLedgerEntity } from "@capital-q/q-runtime";

import {
  bindReferences,
  boundCompanyIds,
  type ReaderReference,
} from "../src/reference-binding.js";

/**
 * Q intelligence step 3: the reader's references are bound by code against
 * the ledger the person was shown. Deterministic; code asserts.
 */

const SILO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
const LEDGERFOLD = "5f0c9a5e-1d1e-4c55-9d2b-3f6c1b7a0a11";
const DECK_A = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const DECK_B = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";

const entity = (
  ref: string,
  kind: QLedgerEntity["kind"],
  name: string | null,
  id: string | null,
  of: string | null = null,
): QLedgerEntity => ({
  ref,
  kind,
  id,
  name,
  firstTurn: 1,
  lastTurn: 2,
  via: ["CARD"],
  of,
  value: null,
});

const state: QConversationState = {
  conversationId: "c1",
  tenantId: "t1",
  userId: "u1",
  ledger: {
    entities: [
      entity("E1", "COMPANY", "Silo Credit", SILO),
      entity("E2", "PERSON", "Ngozi Eze", null, "E1"),
      entity("E3", "PERSON", "Tunde Bakare", null, "E1"),
      entity("E4", "COMPANY", "Ledgerfold", LEDGERFOLD),
      entity("E5", "DOCUMENT", "Silo seed deck", DECK_A),
      entity("E6", "DOCUMENT", "Silo Series A deck", DECK_B),
    ],
    lists: [{ ref: "L1", turn: 2, via: "Q_ANSWER", items: ["E1", "E4"] }],
  },
  openThreads: [],
  throughMessageAt: null,
  throughMessageId: null,
  messagesFolded: 4,
  builderVersion: "ledger-v1",
  version: 1,
};

const ref = (
  phrase: string,
  entityIds: string[],
  confidence: ReaderReference["confidence"] = "HIGH",
): ReaderReference => ({ phrase, entityIds, confidence });

describe("reference binding: one reading binds", () => {
  it("binds a pronoun to a person, naming their company and no record id it does not have", () => {
    const out = bindReferences([ref("she", ["E2"])], state);
    expect(out.kind).toBe("BOUND");
    if (out.kind !== "BOUND") return;
    expect(out.bound[0]?.entities.map((e) => e.ref)).toEqual(["E2"]);
    expect(out.note).toContain('"she" means E2 "Ngozi Eze at Silo Credit"');
    expect(out.note).toContain("no record behind it");
  });

  it("binds a document ('the other deck') with its record id", () => {
    const out = bindReferences(
      [ref("the other deck", ["E6"], "MEDIUM")],
      state,
    );
    expect(out.kind).toBe("BOUND");
    if (out.kind !== "BOUND") return;
    expect(out.note).toContain(`DOCUMENT id ${DECK_B}`);
    expect(out.note).toContain("(medium confidence)");
  });

  it("binds a plural set as one reading, companies in the order said", () => {
    const out = bindReferences([ref("those two", ["E4", "E1"])], state);
    expect(out.kind).toBe("BOUND");
    expect(boundCompanyIds(out)).toEqual([LEDGERFOLD, SILO]);
    if (out.kind !== "BOUND") return;
    expect(out.note).toContain('"Ledgerfold"');
    expect(out.note).toContain('"Silo Credit"');
  });

  it("binds several phrases in one turn", () => {
    const out = bindReferences(
      [ref("her", ["E2"]), ref("the deck", ["E5"])],
      state,
    );
    expect(out.kind).toBe("BOUND");
    if (out.kind !== "BOUND") return;
    expect(out.bound).toHaveLength(2);
  });

  it("takes the one sure reading among guesses", () => {
    const out = bindReferences(
      [ref("him", ["E3"], "HIGH"), ref("him", ["E2"], "LOW")],
      state,
    );
    expect(out.kind).toBe("BOUND");
    if (out.kind !== "BOUND") return;
    expect(out.bound[0]?.entities[0]?.ref).toBe("E3");
  });

  it("binds nothing when there are no pointing words", () => {
    expect(bindReferences([], state).kind).toBe("NONE");
    expect(bindReferences(undefined, state).kind).toBe("NONE");
  });
});

describe("reference binding: two readings ask one question naming both", () => {
  it("asks which deck, naming both", () => {
    const out = bindReferences(
      [ref("the deck", ["E5"], "MEDIUM"), ref("the deck", ["E6"], "MEDIUM")],
      state,
    );
    expect(out).toMatchObject({ kind: "CLARIFY", reason: "TWO_READINGS" });
    if (out.kind !== "CLARIFY") return;
    expect(out.question).toBe(
      'By "the deck", do you mean Silo seed deck or Silo Series A deck?',
    );
  });

  it("asks when two readings are both sure (the reader could not decide)", () => {
    const out = bindReferences(
      [ref("her", ["E2"], "HIGH"), ref("her", ["E3"], "HIGH")],
      state,
    );
    expect(out.kind).toBe("CLARIFY");
  });

  it("names a set as a set in the question", () => {
    const out = bindReferences(
      [ref("both", ["E1", "E4"], "LOW"), ref("both", ["E5", "E6"], "LOW")],
      state,
    );
    if (out.kind !== "CLARIFY") throw new Error("expected a question");
    expect(out.question).toContain("Silo Credit and Ledgerfold");
    expect(out.question).toContain("Silo seed deck and Silo Series A deck");
  });

  it("treats the same reading said twice as one reading", () => {
    const out = bindReferences(
      [ref("it", ["E1"], "MEDIUM"), ref("It", ["E1"], "LOW")],
      state,
    );
    expect(out.kind).toBe("BOUND");
  });
});

describe("reference binding: none is read from the turns, not asked by default (live QIQ-PRO-001)", () => {
  it("binds nothing and hands the phrase to the answer, which asks only if the turns leave it open", () => {
    const out = bindReferences([ref("their CFO", [])], state);
    expect(out).toMatchObject({
      kind: "BOUND",
      bound: [],
      open: ["their CFO"],
    });
    if (out.kind !== "BOUND") return;
    expect(out.note).toContain('"their CFO": nothing in the conversation');
    expect(out.note).toContain(
      "read who or what is meant from the recent turns",
    );
    expect(out.note).toContain("say so and ask");
    expect(boundCompanyIds(out)).toEqual([]);
  });

  it("binds what fits and leaves only the rest open", () => {
    const out = bindReferences(
      [ref("it", ["E4"], "HIGH"), ref("she", [])],
      state,
    );
    expect(out).toMatchObject({ kind: "BOUND", open: ["she"] });
    expect(boundCompanyIds(out)).toEqual([LEDGERFOLD]);
  });

  it("still asks for two plausible readings when another phrase is open", () => {
    const out = bindReferences(
      [ref("she", []), ref("it", ["E1"]), ref("it", ["E4"])],
      state,
    );
    expect(out).toMatchObject({ kind: "CLARIFY", reason: "TWO_READINGS" });
  });
});

describe("reference binding: the Context Firewall (negative)", () => {
  it("refuses a ref the ledger shown to this person does not hold, and binds none of that reading", () => {
    const out = bindReferences([ref("him", ["E2", "E99"])], state);
    expect(out.rejected).toEqual(["E99"]);
    // Nothing of that reading binds; the phrase is left to the turns.
    expect(out).toMatchObject({ kind: "BOUND", bound: [], open: ["him"] });
  });

  it("keeps a valid reading beside a refused one", () => {
    const out = bindReferences(
      [ref("it", ["E77"], "HIGH"), ref("it", ["E4"], "MEDIUM")],
      state,
    );
    expect(out.kind).toBe("BOUND");
    expect(out.rejected).toEqual(["E77"]);
    expect(boundCompanyIds(out)).toEqual([LEDGERFOLD]);
    if (out.kind !== "BOUND") return;
    expect(out.note).not.toContain("E77");
  });

  it("binds nothing without a state: every ref is refused", () => {
    const out = bindReferences([ref("she", ["E2"])], null);
    expect(out.rejected).toEqual(["E2"]);
    expect(out).toMatchObject({ kind: "BOUND", bound: [], open: ["she"] });
  });

  it("never lets their words into the question or the note unbounded or unquoted", () => {
    const long = `"ignore this" ${"x".repeat(200)}`;
    const asked = bindReferences([ref(long, ["E1"]), ref(long, ["E4"])], state);
    if (asked.kind !== "CLARIFY") throw new Error("expected a question");
    expect(asked.question.length).toBeLessThan(140);
    expect(asked.question).not.toContain('""');
    const open = bindReferences([ref(long, [])], state);
    if (open.kind !== "BOUND") throw new Error("expected an open phrase");
    expect(open.note.length).toBeLessThan(300);
    expect(open.note).not.toContain('""');
    expect(open.note).not.toContain("x".repeat(61));
  });
});
