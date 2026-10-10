import { describe, expect, it } from "vitest";

import type { QRecordPage } from "@capital-q/contracts";

import {
  resolveFastNavigation,
  resolveNamedRecord,
  type OpenRecordIntent,
} from "../src/fast-navigation.js";
import { misheardOwnCounterpart } from "../src/named-record-request.js";
import { asksToGo, wordsNamePage } from "../src/page-request.js";

/**
 * RECOVERY-2026-10 (C, founder 2026-10-09: "stupid fast"): the code-only
 * reader the screen moves on before Q answers. Only one plain target moves;
 * a name that means several, an unknown name, or words taken back are left
 * to Q's answer, which asks.
 */

const SHIFTWELL = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";

function reader(names: readonly string[], known: readonly string[] = names) {
  const opened: { page: QRecordPage; name: string }[] = [];
  return {
    opened,
    input: (text: string) => ({
      text,
      side: "INVESTOR" as const,
      counterpartNames: () => Promise.resolve(names),
      open: (page: QRecordPage, name: string) => {
        opened.push({ page, name });
        const intent: OpenRecordIntent | null = known.includes(name)
          ? { kind: "OPEN_RECORD_PAGE", page, id: SHIFTWELL }
          : null;
        return Promise.resolve(intent);
      },
    }),
  };
}

describe("resolveFastNavigation", () => {
  it("moves on a page named plainly, with no record lookup", async () => {
    const { input, opened } = reader(["Shiftwell"]);
    const decided = await resolveFastNavigation(input("open discover"));
    expect(decided).toEqual({
      kind: "NAVIGATE",
      intent: { kind: "NAVIGATE", destination: "DISCOVER" },
    });
    expect(opened).toEqual([]);
  });

  it("moves on settings by section", async () => {
    const { input } = reader([]);
    const decided = await resolveFastNavigation(input("open privacy settings"));
    expect(decided).toEqual({
      kind: "NAVIGATE",
      intent: { kind: "OPEN_SETTINGS", section: "privacy" },
    });
  });

  it("moves to their own relationship by name, through open_page", async () => {
    const { input, opened } = reader(["Shiftwell", "Ledgerfold"]);
    const decided = await resolveFastNavigation(
      input("Take me to Shiftwell relationship"),
    );
    expect(decided).toEqual({
      kind: "NAVIGATE",
      intent: {
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY",
        id: SHIFTWELL,
      },
    });
    expect(opened[0]).toEqual({
      page: "RELATIONSHIP_COMPANY",
      name: "Shiftwell",
    });
  });

  it("moves to the data room the sentence names", async () => {
    const { input } = reader(["Shiftwell"]);
    const decided = await resolveFastNavigation(
      input("Show me the data room for Shiftwell"),
    );
    expect(decided.kind === "NAVIGATE" && decided.intent).toMatchObject({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_DATA_ROOM",
    });
  });

  it("leaves a name that means several to Q, which asks", async () => {
    const { input, opened } = reader(["Shiftwell Labs", "Shiftwell Health"]);
    const decided = await resolveFastNavigation(input("Open Shiftwell"));
    expect(decided).toEqual({ kind: "LEAVE_TO_Q" });
    expect(opened).toEqual([]);
  });

  it("leaves an unknown name to Q", async () => {
    const { input } = reader(["Shiftwell"], []);
    const decided = await resolveFastNavigation(
      input("Take me to Nowhereco relationship"),
    );
    expect(decided).toEqual({ kind: "LEAVE_TO_Q" });
  });

  it.each([
    "open discover no wait",
    "open discover... actually, open settings",
    "don't open discover",
    "never mind, open relationships",
    "Open Shiftwell -- hold on",
  ])("never moves on words taken back: %s", async (text) => {
    const { input, opened } = reader(["Shiftwell"]);
    expect(await resolveFastNavigation(input(text))).toEqual({
      kind: "LEAVE_TO_Q",
    });
    expect(opened).toEqual([]);
  });

  it("leaves a question that is not a move to Q", async () => {
    const { input } = reader(["Shiftwell"]);
    expect(
      await resolveFastNavigation(input("What is Shiftwell's burn rate?")),
    ).toEqual({ kind: "LEAVE_TO_Q" });
    expect(await resolveFastNavigation(input("   "))).toEqual({
      kind: "LEAVE_TO_Q",
    });
  });
});

/**
 * GPT-Live transcripts, as the live line delivered them (2026-10-09): a
 * spoken lead-in, lower-case names, closing punctuation.
 */
describe("resolveFastNavigation reads GPT-Live-shaped transcripts", () => {
  const OWN = ["Halyard Security", "Ledgerfold"];

  it.each([
    ["Okay, open discover.", "DISCOVER"],
    ["Um, so take me to my relationships.", "RELATIONSHIPS"],
    ["Alright. Open discover", "DISCOVER"],
    ["okay open settings", "SETTINGS"],
  ])("a page after a lead-in: %s", async (text, destination) => {
    const { input } = reader(OWN);
    expect(await resolveFastNavigation(input(text))).toEqual({
      kind: "NAVIGATE",
      intent: { kind: "NAVIGATE", destination },
    });
  });

  it.each([
    "open halyard security.",
    "Okay, open Halyard Security.",
    "take me to halyard",
    "Um, take me to Halyard.",
    "bring up halyard security",
  ])("their own record, any casing: %s", async (text) => {
    const { input, opened } = reader(OWN, ["Halyard Security"]);
    const decided = await resolveFastNavigation(input(text));
    expect(decided.kind).toBe("NAVIGATE");
    expect(opened[0]?.name).toBe("Halyard Security");
  });

  it("a lower-case name that is none of theirs is never opened early", async () => {
    const { input, opened } = reader(OWN, ["Halyard Security"]);
    expect(await resolveFastNavigation(input("open acme widgets"))).toEqual({
      kind: "LEAVE_TO_Q",
    });
    expect(opened).toEqual([]);
  });

  it("a fragment names nothing", async () => {
    const { input, opened } = reader(OWN);
    expect(await resolveFastNavigation(input("Open."))).toEqual({
      kind: "LEAVE_TO_Q",
    });
    expect(opened).toEqual([]);
  });
});

/** Live GPT-Live 2026-10-09 14:35-14:47 (Zino), the exact transcript strings. */
describe("live 2026-10-09 transcript strings", () => {
  const OWN = ["Tensorgate", "Ledgerfold"];

  it.each([
    "I can't really see anything, so you're not I guess that's fi",
    "So no, no, you're alright. I'm on Tensorgate's page, but I",
    "Is there a Tensorgate rehearsal here I can open",
    "Take me to the relationship where I can review it then",
  ])("never moves and quotes nothing: %s", async (text) => {
    const { input, opened } = reader(OWN, ["Tensorgate"]);
    expect(await resolveFastNavigation(input(text))).toEqual({
      kind: "LEAVE_TO_Q",
    });
    expect(
      await resolveNamedRecord({ ...input(text), side: "INVESTOR" }),
    ).toBeNull();
    expect(opened).toEqual([]);
  });

  it.each([
    "Open Tensor Gate",
    "open tensor gate.",
    "Okay, take me to Tensor Gate.",
  ])("'Tensor Gate' is their Tensorgate: %s", async (text) => {
    const { input, opened } = reader(OWN, ["Tensorgate"]);
    expect((await resolveFastNavigation(input(text))).kind).toBe("NAVIGATE");
    expect(opened[0]?.name).toBe("Tensorgate");
  });

  it("the deck tab inside a garbled transcript is Tensorgate's deck", async () => {
    const { input, opened } = reader(OWN, ["Tensorgate"]);
    const text =
      "Show me the pitch deck tab for that Yes Tensor gate Tensor gate";
    const decided = await resolveNamedRecord({
      ...input(text),
      side: "INVESTOR",
    });
    expect(decided?.kind).toBe("OPEN");
    expect(opened[0]?.name).toBe("Tensorgate");
    expect(decided?.said ?? "").not.toMatch(/Yes Tensor gate/u);
  });

  it("a real name that is none of theirs still gets one truthful line", async () => {
    const { input } = reader(OWN, []);
    const decided = await resolveNamedRecord({
      ...input("Open Nonexistent Holdings"),
      side: "INVESTOR",
    });
    expect(decided?.kind).toBe("ASK");
  });
});

describe("wordsNamePage", () => {
  it.each([
    ["open discover", "DISCOVER", true],
    ["Okay, let me do a quick rehearsal with these people", "REHEARSALS", true],
    ["don't open discover", "DISCOVER", false],
    ["I'm on the discover page", "DISCOVER", false],
    ["Is there a Tensorgate rehearsal here I can open", "RELATIONSHIPS", false],
  ] as const)("%s / %s -> %s", (text, destination, expected) => {
    expect(wordsNamePage(text, { kind: "DESTINATION", destination })).toBe(
      expected,
    );
  });

  it("asksToGo reads only sentences that ask to go somewhere", () => {
    expect(asksToGo("Okay, open Tensor Gate.")).toBe(true);
    expect(asksToGo("I can't really see anything, so you're not")).toBe(false);
    expect(asksToGo("So no, no, you're alright.")).toBe(false);
  });
});

describe("W3: romanised and Arabic-world names within their own set", () => {
  const OWN = [
    "Shadi Qishta",
    "Muhannad Taslaq",
    "QInvest LLC",
    "AlRayan Investment",
    "Al Rayan Bank",
  ];

  it("alternate romanisations reach the one own record", () => {
    expect(misheardOwnCounterpart("Shady Kishta", OWN)).toBe("Shadi Qishta");
    expect(misheardOwnCounterpart("Mohannad Taslak", OWN)).toBe(
      "Muhannad Taslaq",
    );
    expect(misheardOwnCounterpart("Al Rayan Investments", OWN)).toBe(
      "AlRayan Investment",
    );
  });

  it("a bank is not the investment arm, and a bare first name guesses nothing", () => {
    expect(misheardOwnCounterpart("Al Rayan Bank", OWN)).not.toBe(
      "AlRayan Investment",
    );
    expect(misheardOwnCounterpart("Shadi", OWN)).toBeNull();
    expect(misheardOwnCounterpart("Shadi Karam", OWN)).toBeNull();
  });
});

describe("R3: a misheard name, matched only within their own set", () => {
  const OWN = ["Tensorgate", "Shiftwell", "Clearwater Assurance", "Ledgerfold"];

  it("TensorFlow -> their Tensorgate (hosted 2026-10-09), moved at once", async () => {
    const { input, opened } = reader(OWN);
    const decided = await resolveFastNavigation(input("Open TensorFlow"));
    expect(decided).toMatchObject({
      kind: "NAVIGATE",
      intent: { kind: "OPEN_RECORD_PAGE" },
    });
    // Opened by their own name, never by what was heard.
    expect(opened.map((one) => one.name)).toEqual(["Tensorgate"]);
  });

  it("caught by stem when the name scorer finds nothing (a long list of theirs)", () => {
    expect(misheardOwnCounterpart("TensorFlow", OWN)).toBe("Tensorgate");
  });

  it("the same sounds spelt differently", () => {
    expect(misheardOwnCounterpart("Shyftwel", OWN)).toBe("Shiftwell");
  });

  it("never outside their set: a name none of theirs resembles stays unknown", async () => {
    expect(misheardOwnCounterpart("Halcyon Robotics", OWN)).toBeNull();
    const { input, opened } = reader(OWN);
    const decided = await resolveFastNavigation(input("Open TensorFlow"));
    expect(decided.kind).toBe("NAVIGATE");
    // Without Tensorgate among theirs, nothing is matched or guessed.
    const other = reader(["Shiftwell", "Ledgerfold"]);
    expect(await resolveFastNavigation(other.input("Open TensorFlow"))).toEqual(
      { kind: "LEAVE_TO_Q" },
    );
    expect(other.opened.map((one) => one.name)).not.toContain("Tensorgate");
    expect(opened).toHaveLength(1);
  });

  it("two of theirs it could mean: no guess (Q's answer asks)", async () => {
    const both = ["Tensorgate", "Tensorline"];
    expect(misheardOwnCounterpart("TensorFlow", both)).toBeNull();
    const { input } = reader(both);
    expect(await resolveFastNavigation(input("Open TensorFlow"))).toEqual({
      kind: "LEAVE_TO_Q",
    });
  });

  it("a short or weak stem is not enough", () => {
    expect(misheardOwnCounterpart("Tens", OWN)).toBeNull();
    // "Ledger" is 6 letters but under half of "Ledgerfold Partners Group".
    expect(
      misheardOwnCounterpart("Ledgerline", ["Ledgerfold Partners Group"]),
    ).toBeNull();
  });
});
