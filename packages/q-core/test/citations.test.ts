import { describe, expect, it } from "vitest";

import {
  CompanyIntelligenceFindingSchema,
  readCitationLabels,
} from "../src/index.js";

/**
 * A citation a model wrote badly costs the citation, never the answer.
 * Live, six findings each carried one label the schema refused, and an
 * answer the person had already been read was thrown away for it.
 */
describe("citation labels as a model writes them", () => {
  it("keeps well-formed labels, once each, in order", () => {
    expect(readCitationLabels(["F1", "F7", "F1"])).toEqual(["F1", "F7"]);
  });

  it("recovers a label written with decoration or in one string", () => {
    expect(readCitationLabels(["[F3]", "f4", "F5.", "(F6)"])).toEqual([
      "F3",
      "F4",
      "F5",
      "F6",
    ]);
    expect(readCitationLabels("F1, F2 F3")).toEqual(["F1", "F2", "F3"]);
  });

  it("drops what could never resolve rather than refusing the answer", () => {
    expect(
      readCitationLabels(["S1", "paystack.com", "the deck", "F999999", 3]),
    ).toEqual([]);
    expect(readCitationLabels(undefined)).toEqual([]);
  });

  it("is what the finding schema accepts", () => {
    const finding = CompanyIntelligenceFindingSchema.parse({
      dimension: "TRACTION",
      type: "FACT",
      statement: "Customers grew from 4 to 11.",
      truthClass: "USER_CLAIM",
      confidence: "MODERATE",
      citations: ["S1", "[F2]", "F2", "a public article"],
    });
    expect(finding.citations).toEqual(["F2"]);
  });
});
