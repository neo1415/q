import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertOrderPreserved,
  validateFixtures,
  verifyAssessment,
} from "./unicorn-potential-acceptance.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function assessment() {
  const weights = [15, 15, 15, 8, 6, 8, 5, 5, 8, 5, 6, 4];
  return {
    status: "SCORED",
    overallScore: 50,
    band: "DEVELOPING",
    coverage: 1,
    stage: "PRE_SEED",
    momentum: null,
    pillars: weights.map((weight, index) => ({
      id: `P${index + 1}`,
      weight,
      grade: 2,
      contribution: weight / 2,
      criteria: ["A", "B"].map((id) => ({
        id,
        state: "OBSERVED",
        grade: 2,
        sources: [{ visibilityScope: "network_visible" }],
      })),
    })),
  };
}
test("arithmetic proof rejects a plausible but incorrect overall score", () => {
  verifyAssessment(assessment(), "SCORED");
  assert.throws(
    () => verifyAssessment({ ...assessment(), overallScore: 67 }, "SCORED"),
    /calculation/,
  );
});
test("arithmetic proof rejects wrong pillar grades and source-free observations", () => {
  const bad = assessment();
  bad.pillars[0].grade = 3;
  assert.throws(() => verifyAssessment(bad, "SCORED"), /average/);
  const noSource = assessment();
  noSource.pillars[0].criteria[0].sources = [];
  assert.throws(() => verifyAssessment(noSource, "SCORED"), /lineage/);
});
test("unscored proof never accepts fabricated zero or a band", () => {
  const value = {
    ...assessment(),
    status: "INSUFFICIENT_EVIDENCE",
    overallScore: null,
    band: null,
  };
  verifyAssessment(value, "INSUFFICIENT_EVIDENCE");
  assert.throws(
    () =>
      verifyAssessment({ ...value, overallScore: 0 }, "INSUFFICIENT_EVIDENCE"),
    /fabricated/,
  );
});
test("private source scopes and wrong contributions fail proof", () => {
  const privateValue = assessment();
  privateValue.pillars[0].criteria[0].sources[0].visibilityScope =
    "founder_private";
  assert.throws(
    () => verifyAssessment(privateValue, "SCORED"),
    /Private source/,
  );
  const wrong = assessment();
  wrong.pillars[0].contribution = 99;
  assert.throws(() => verifyAssessment(wrong, "SCORED"), /Contribution/);
});
test("momentum must reconcile and all twelve canonical pillars must exist", () => {
  assert.throws(
    () =>
      verifyAssessment(
        { ...assessment(), momentum: { previousScore: 45, delta: 4 } },
        "SCORED",
      ),
    /Momentum/,
  );
  const duplicate = assessment();
  duplicate.pillars[11].id = "P1";
  assert.throws(() => verifyAssessment(duplicate, "SCORED"), /Distinct/);
});
test("bounded order proof refuses reversed, absent and insufficient records", () => {
  const baseline = [1, 2, 3, 4].map((n) => ({ companyId: id(n) }));
  assertOrderPreserved(baseline, [baseline[0], baseline[3]]);
  assert.throws(
    () => assertOrderPreserved(baseline, [baseline[3], baseline[0]]),
    /changed/,
  );
  assert.throws(() => assertOrderPreserved(baseline, [baseline[0]]), /two/);
  assert.throws(
    () => assertOrderPreserved(baseline, [baseline[0], { companyId: id(99) }]),
    /baseline/,
  );
});
test("fixture preparation requires distinct evidence cases and all authorized roles", () => {
  const value = {
    publicConfigFile: "/tmp/public.json",
    scoredCompanyId: id(1),
    unscoredCompanyId: id(2),
    qExpectedTerms: ["dated revenue", "customer retention"],
    actors: [
      "premiumInvestor",
      "freeInvestor",
      "noMandateInvestor",
      "premiumFounder",
    ].map((role) => ({
      role,
      sessionFile: "/tmp/session.json",
      expectedScoreHttp: role === "freeInvestor" ? 404 : 200,
      ...(role === "premiumFounder"
        ? { applicationId: id(3), gateqPath: "/gateq?view=applications" }
        : {}),
    })),
  };
  validateFixtures(value);
  validateFixtures({
    ...value,
    expectedAssessmentStatus: "INSUFFICIENT_EVIDENCE",
  });
  assert.throws(
    () =>
      validateFixtures({
        ...value,
        expectedAssessmentStatus: "ASSUMED_SCORED",
      }),
    /Explicit scored/,
  );
  assert.throws(
    () => validateFixtures({ ...value, unscoredCompanyId: id(1) }),
    /Distinct/,
  );
  assert.throws(
    () => validateFixtures({ ...value, actors: value.actors.slice(0, 3) }),
    /required role/,
  );
  assert.throws(
    () => validateFixtures({ ...value, qExpectedTerms: [] }),
    /evidence terms/,
  );
});
