import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  claimedArtifacts,
  createArtifactClaimGuard,
  drawnArtifacts,
  drawnOnScreen,
  notDrawnLine,
  withoutUnbackedArtifactClaims,
} from "../src/q/artifact-claims.js";
import { createRunCompanies } from "../src/q/card-subjects.js";
import { analystResultBlocks } from "../src/q/result-blocks.js";
import {
  claimsOnScreen,
  withoutUnbackedScreenClaims,
} from "../src/q/screen-claims.js";

/**
 * Lane A (2026-10-15): Q must never say a table, map, chart or timeline
 * is shown unless the answer carries one, and the screen-claim guard must
 * read typographic apostrophes. Live failures on production (investor
 * savanna-seed) are quoted as they were said.
 */

const TABLE: QResultBlock = {
  kind: "TABLE",
  title: "Side by side",
  columns: [
    { label: "Bumpa", subject: null },
    { label: "Anchor", subject: null },
  ],
  rows: [{ label: "Based in", cells: ["NG", "KE"] }],
};

describe("artifact claims", () => {
  it("recognises a claim that an object is shown, and not an offer or a refusal", () => {
    expect(claimedArtifacts("Here's a map of where they're based.")).toEqual([
      "MAP",
    ]);
    expect(claimedArtifacts("I’ve put them in a table below.")).toEqual([
      "TABLE",
    ]);
    expect(claimedArtifacts("The chart below shows revenue by month.")).toEqual(
      ["CHART"],
    );
    for (const plain of [
      // Live 2026-10-15: a refusal, said honestly.
      "I can’t place all three accurately on a map from the information currently available.",
      "Would you like a table of these?",
      "I can put them in a table if you want.",
      "Their table stakes are unusually high.",
    ]) {
      expect(claimedArtifacts(plain), plain).toEqual([]);
    }
  });

  it("is backed only by an object of the same kind (FAILED BEFORE: any card backed it)", () => {
    const cards: QResultBlock = {
      kind: "COMPARISON_CARDS",
      title: "Top two",
      items: [
        { name: "Bumpa", subtitle: null, points: ["Leads on fit"] },
        { name: "Anchor", subtitle: null, points: ["Tied second"] },
      ],
    };
    const { text, removed } = withoutUnbackedArtifactClaims(
      "Bumpa leads on fit. Here's a map of where they're based.",
      [cards],
    );
    expect(removed).toBe(1);
    expect(text).toBe(`Bumpa leads on fit. ${notDrawnLine("MAP")}`);
    expect(
      withoutUnbackedArtifactClaims("Here's the table, side by side.", [TABLE]),
    ).toEqual({ text: "Here's the table, side by side.", removed: 0 });
    expect([...drawnArtifacts([TABLE])]).toEqual(["TABLE"]);
  });

  it("holds an unbacked claim back while streaming, and says the truth once when finished", () => {
    const stream = createArtifactClaimGuard(() => new Set(), "stream");
    expect(stream.sentence("Here's the map.")).toBeNull();
    expect(stream.sentence("Bumpa is in Lagos.")).toBe("Bumpa is in Lagos.");
    const final = createArtifactClaimGuard(() => new Set(), "final");
    expect(final.sentence("Here's the map.")).toBe(notDrawnLine("MAP"));
    expect(final.sentence("See the chart below.")).toBeNull();
  });
});

describe("an object the browser confirms drawn backs a mention of it (lane A slice 3)", () => {
  it("keeps “as the map shows” when the map from an earlier answer is on screen", () => {
    const said = "As the map shows, Baridi is in Kenya.";
    expect(claimedArtifacts(said)).toEqual(["MAP"]);
    // Nothing this run carries, but the browser reports the map drawn.
    expect(
      withoutUnbackedArtifactClaims(said, [], drawnOnScreen(["MAP"])),
    ).toEqual({ text: said, removed: 0 });
    // Not drawn: corrected.
    expect(withoutUnbackedArtifactClaims(said, []).removed).toBe(1);
    expect([...drawnOnScreen(["COMPARISON", "ANSWER_CARDS"])]).toEqual([
      "TABLE",
    ]);
  });
});

describe("screen claims read typographic apostrophes", () => {
  it("catches “I’ve opened…” with nothing opened (FAILED BEFORE: passed through)", () => {
    const said =
      "I’ve opened the three company records, but their profiles don’t include precise cities.";
    expect(claimsOnScreen(said)).toBe(true);
    expect(withoutUnbackedScreenClaims(said, false).removed).toBe(1);
  });
});

describe("a company map from the run's own reads", () => {
  const BUMPA = "6ab2cc02-160f-4812-a6b1-8be7e43afd3e";
  const BARIDI = "7ab2cc02-160f-4812-a6b1-8be7e43afd3e";
  const outcome = (data: unknown): Pick<QToolCallOutcome, "result"> => ({
    result: { ok: true, data },
  });

  it("maps the companies when the model asks for a map and no investor was read (FAILED BEFORE: nothing drawn)", () => {
    const runs = createRunCompanies();
    runs.note(
      "run-1",
      outcome({
        companies: [
          { companyId: BUMPA, name: "Bumpa", headquartersCountry: "NG" },
          { companyId: BARIDI, name: "Baridi", headquartersCountry: null },
        ],
      }),
    );
    const map = analystResultBlocks({
      result: { answer: "x".repeat(200), visual: "MAP" },
      subjects: [],
      read: runs.take("run-1"),
    })?.find((block) => block.kind === "MAP");
    expect(map).toEqual({
      kind: "MAP",
      title: "Where they're based",
      basis: "Country, as each company publishes it on Capital Q.",
      places: [
        {
          label: "Bumpa",
          countryCode: "NG",
          subject: { kind: "COMPANY", companyId: BUMPA },
          note: null,
        },
        {
          label: "Baridi",
          countryCode: null,
          subject: { kind: "COMPANY", companyId: BARIDI },
          note: null,
        },
      ],
    });
  });

  it("draws no map when no company's country was read", () => {
    const runs = createRunCompanies();
    runs.note(
      "run-2",
      outcome({ companies: [{ companyId: BUMPA, name: "Bumpa" }] }),
    );
    expect(
      analystResultBlocks({
        result: { answer: "x".repeat(200), visual: "MAP" },
        subjects: [],
        read: runs.take("run-2"),
      })?.find((block) => block.kind === "MAP"),
    ).toBeUndefined();
  });
});
