import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V22,
  COMPANY_ANALYST_V23,
  CompanyAnalystV22ResultSchema,
  CompanyDimensionCoverageSchema,
  CompanyIntelligenceFindingSchema,
  createDefaultPromptRegistry,
  V23_RESULT_GUIDANCE,
} from "../src/index.js";

function example() {
  const json = V23_RESULT_GUIDANCE.match(
    /JSON SHAPE EXAMPLE\n([^\n]+)\nEND JSON SHAPE EXAMPLE/u,
  )?.[1];
  if (json === undefined) throw new Error("Missing analyst JSON shape example");
  const value: unknown = JSON.parse(json);
  return CompanyAnalystV22ResultSchema.parse(value);
}

describe("COMPANY_ANALYST v23: precise shape beside tools", () => {
  it("activates the new guidance on the same strict result contract", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("COMPANY_ANALYST").definition;
    expect(active.version).toBe(27);
    // v26 (L-13) added PICTURE; v23-v25 wrote to v22's contract.
    expect(registry.get("COMPANY_ANALYST", 25)?.definition.output).toBe(
      COMPANY_ANALYST_V22.output,
    );
    expect(registry.get("COMPANY_ANALYST", 22)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V23.template.replace(V23_RESULT_GUIDANCE, "")).toBe(
      COMPANY_ANALYST_V22.template,
    );
    // Keep the added guidance in the stable prefix, before every turn variable.
    expect(
      COMPANY_ANALYST_V23.template.indexOf(V23_RESULT_GUIDANCE),
    ).toBeLessThan(
      COMPANY_ANALYST_V23.template.indexOf(
        "AUTHORISED FACTS\n{{authorisedFacts}}",
      ),
    );
  });

  it("lists exactly the result contract's allowed root keys", () => {
    const keys = V23_RESULT_GUIDANCE.match(
      /The only allowed root keys are: ([^.]+)\./u,
    )?.[1]?.split(", ");
    expect(keys).toEqual(Object.keys(CompanyAnalystV22ResultSchema.shape));
    expect(keys).not.toContain("followUps");
    expect(
      CompanyAnalystV22ResultSchema.safeParse({
        ...example(),
        followUps: ["A synthetic next question"],
      }).success,
    ).toBe(false);
  });

  it("publishes a schema-valid finding and separate dimension coverage example", () => {
    const answer = example();
    expect(answer.companyFindings).toHaveLength(1);
    expect(answer.coverage).toHaveLength(1);
    const finding = CompanyIntelligenceFindingSchema.parse(
      answer.companyFindings[0],
    );
    const coverage = CompanyDimensionCoverageSchema.parse(answer.coverage[0]);
    expect(coverage.dimension).toBe(finding.dimension);
    expect(finding.citations).toEqual(["F1"]);
    expect(Object.keys(finding).sort()).toEqual(
      [
        "dimension",
        "type",
        "statement",
        "truthClass",
        "confidence",
        "citations",
        "assumptions",
      ].sort(),
    );
    // Reproduce the refused shape without customer or model output content.
    const { statement, ...withoutStatement } = finding;
    expect(statement.length).toBeGreaterThan(0);
    expect(
      CompanyIntelligenceFindingSchema.safeParse({
        ...withoutStatement,
        text: statement,
        coverage: coverage.coverage,
      }).success,
    ).toBe(false);
  });

  it("keeps historical prompt hashes unchanged", () => {
    const value: unknown = JSON.parse(
      readFileSync(new URL("../prompts.lock.json", import.meta.url), "utf8"),
    );
    if (typeof value !== "object" || value === null || !("entries" in value))
      throw new Error("Missing prompt lock entries");
    const entries = value.entries;
    if (typeof entries !== "object" || entries === null)
      throw new Error("Invalid prompt lock entries");
    const registry = createDefaultPromptRegistry();
    for (let version = 1; version <= 24; version += 1) {
      const historical = registry.get("COMPANY_ANALYST", version);
      expect(historical?.contentHash).toBe(
        Reflect.get(entries, `company-analyst/v${String(version)}`),
      );
    }
  });
});
