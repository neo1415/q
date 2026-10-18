import { describe, expect, it } from "vitest";
import {
  QPageManifestSchema,
  UNICORN_PILLAR_IDS,
  notAssessedUnicornPotential,
  type UnicornPotentialDto,
} from "@capital-q/contracts";
import { AuthorisedFactSchema } from "@capital-q/q-core";
import { manifestFacts, manifestReads } from "../src/q/manifest-fact.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const manifest = QPageManifestSchema.parse({
  v: 2,
  seq: 1,
  inView: [],
  dialogs: [],
  sections: [
    {
      id: "profile",
      kind: "COMPANY_PROFILE",
      refs: [{ kind: "COMPANY", id: companyId }],
      total: 1,
    },
  ],
  controls: [
    { id: "disclosure.unicorn-potential", kind: "DISCLOSURE", state: "CLOSED" },
  ],
});
const score: UnicornPotentialDto = {
  ...notAssessedUnicornPotential("unicorn-potential.v1.0.0"),
  status: "INSUFFICIENT_EVIDENCE",
  stage: "SEED",
  coverage: 0.29,
  inputRulesVersion: "unicorn-potential-inputs.v4",
  missing: ["Dated retention cohorts"],
  pillars: UNICORN_PILLAR_IDS.map((id) => ({
    id,
    label: `Synthetic ${id}`,
    grade: 2,
    weight: 8,
    contribution: null,
    coverage: 0.5,
    criteria: (["A", "B"] as const).map((criterion) => ({
      id: criterion,
      label: `Synthetic ${id}.${criterion}`,
      state: "UNKNOWN" as const,
      grade: null,
      anchor: `Exact ${id}.${criterion} evidence requirement`,
      sources: [],
    })),
  })),
};
const read = (value: unknown) => new Map([[`fit_profile:${companyId}`, value]]);
const assessmentFacts = (value: unknown) =>
  manifestFacts(manifest, read(value)).filter(
    (fact) => fact.scope === "COMPANY_ASSESSMENT",
  );

describe("the selected persisted Unicorn assessment is read before answering", () => {
  it("reads a closed visible assessment through the existing authorized fit tool, once", () => {
    const reads = manifestReads(
      manifest,
      new Set(["fit_profile", "get_company"]),
    );
    expect(reads.filter((entry) => entry.name === "fit_profile")).toEqual([
      {
        key: `fit_profile:${companyId}`,
        name: "fit_profile",
        arguments: { companyId },
      },
    ]);
    expect(
      manifestReads(manifest, new Set(["get_company"])).some(
        (entry) => entry.name === "fit_profile",
      ),
    ).toBe(false);
    expect(
      manifestReads({ ...manifest, controls: [] }, new Set(["fit_profile"])),
    ).toEqual([]);
  });
  it("does not add score reads across a feed or an ambiguous profile set", () => {
    expect(
      manifestReads(
        {
          ...manifest,
          sections: manifest.sections.map((s) => ({
            ...s,
            kind: "COMPANY_FEED" as const,
          })),
        },
        new Set(["fit_profile"]),
      ),
    ).toEqual([]);
    expect(
      manifestReads(
        {
          ...manifest,
          sections: [
            ...manifest.sections,
            {
              kind: "COMPANY_PROFILE",
              id: "other",
              refs: [
                { kind: "COMPANY", id: "00000000-0000-4000-8000-000000000002" },
              ],
            },
          ],
        },
        new Set(["fit_profile"]),
      ),
    ).toEqual([]);
  });
  it("supplies every actual pillar, grade, weight and missing input without inferring a number or copying sibling private data", () => {
    const facts = assessmentFacts({
      status: "OK",
      scores: { unicornPotential: score, privateEvaluation: "never disclose" },
    });
    expect(facts).toHaveLength(13);
    for (const fact of facts)
      expect(AuthorisedFactSchema.safeParse(fact).success).toBe(true);
    const text = facts.map((fact) => fact.statement).join("\n");
    expect(text).toContain('"overallScore":null');
    expect(text).toContain('"coverage":0.29');
    expect(text).toContain("Dated retention cohorts");
    expect(text).not.toContain("never disclose");
    const storedPillars = facts
      .slice(1)
      .map(
        (fact) =>
          JSON.parse(
            fact.statement.slice(fact.statement.indexOf("axes: ") + 6),
          ) as unknown,
      );
    expect(storedPillars).toEqual(score.pillars);
  });
  it("drops absent, revoked, invalid or failed score reads rather than reconstructing a premium assessment", () => {
    for (const value of [
      undefined,
      { status: "NOT_FOUND", scores: { unicornPotential: score } },
      { status: "OK", scores: {} },
      { status: "OK", scores: { unicornPotential: { overallScore: 99 } } },
    ])
      expect(assessmentFacts(value)).toEqual([]);
  });
});
