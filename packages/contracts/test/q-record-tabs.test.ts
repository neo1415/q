import { describe, expect, it } from "vitest";

import {
  QOpenRecordPageIntentSchema,
  Q_RECORD_TABS,
  QManifestTabSchema,
  recordPageHasTab,
} from "../src/index.js";

const ID = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

describe("the tab an open-record intent may carry (N2)", () => {
  it("only names tabs the screen manifest knows", () => {
    for (const tab of Q_RECORD_TABS) {
      expect(QManifestTabSchema.safeParse(tab).success).toBe(true);
    }
  });

  it("accepts a company tab, a relationship tab, and the deck's section and viewer", () => {
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY_TEAM",
        id: ID,
        tab: "team",
      }).success,
    ).toBe(true);
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_INVESTOR",
        id: ID,
        tab: "diligence",
      }).success,
    ).toBe(true);
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY_DECK",
        id: ID,
        tab: "deck",
        subTab: "MARKET",
        viewer: "OPEN",
      }).success,
    ).toBe(true);
  });

  it("refuses a tab the page lacks, free text, and a section off the deck", () => {
    const bad = [
      { page: "COMPANY", tab: "calls" },
      { page: "RELATIONSHIP_COMPANY", tab: "team" },
      { page: "INVESTOR", tab: "team" },
      { page: "COMPANY", tab: "my own tab" },
      { page: "COMPANY", tab: "team", subTab: "MARKET" },
      { page: "COMPANY", tab: "deck", subTab: "NOT_A_SECTION" },
      { page: "COMPANY", tab: "team", viewer: "OPEN" },
    ];
    for (const one of bad) {
      expect(
        QOpenRecordPageIntentSchema.safeParse({
          kind: "OPEN_RECORD_PAGE",
          id: ID,
          ...one,
        }).success,
        JSON.stringify(one),
      ).toBe(false);
    }
    expect(recordPageHasTab("COMPANY_DECK", "deck")).toBe(true);
    expect(recordPageHasTab("WORK_ITEM", "team")).toBe(false);
  });
});
