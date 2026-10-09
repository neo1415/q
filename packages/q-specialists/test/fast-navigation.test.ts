import { describe, expect, it } from "vitest";

import type { QRecordPage } from "@capital-q/contracts";

import {
  resolveFastNavigation,
  type OpenRecordIntent,
} from "../src/fast-navigation.js";

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
