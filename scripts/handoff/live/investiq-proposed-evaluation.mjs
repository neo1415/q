/** PROPOSED offline arithmetic experiment. Synthetic fixtures only.
 * No provider calls, auth, database, application imports or production scoring.
 * Rubric anchors are supplied synthetic observations, not an AI evaluator.
 * See docs/ai-handoff/INVESTIQ-METHODOLOGY-PROPOSED.md for unresolved policy. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const version = "PROPOSED-investiq-experiment-0.1";
const dimensions = [
  ["leadership", ["capability", "coverage", "learning"]],
  ["market", ["pain", "opportunity", "timing"]],
  ["product", ["validation", "defensibility", "reliability"]],
  ["commercial", ["adoption", "retention", "acquisition"]],
  ["financial", ["unitEconomics", "liquidity", "efficiency"]],
  ["governance", ["legal", "oversight", "regulatory"]],
  ["capital", ["milestones", "resilience", "structure"]],
];
const profiles = {
  PRESEED: [24, 22, 22, 10, 10, 6, 6],
  SEED: [18, 18, 20, 18, 14, 7, 5],
  GROWTH: [12, 12, 14, 24, 22, 10, 6],
};
const reliability = {
  VERIFIED_PRIMARY: 0.95,
  PRIMARY: 0.75,
  INDEPENDENT: 0.7,
  PUBLIC_STATEMENT: 0.45,
  FOUNDER_CLAIM: 0.35,
  PROMOTIONAL: 0.15,
  AI_ONLY: 0,
};
const halfLives = [365, 365, 365, 180, 90, 730, 180];
const round = (value) => Math.round((value + Number.EPSILON) * 10) / 10;
const sum = (values) => values.reduce((a, b) => a + b, 0);
const criteriaIds = dimensions.flatMap(([d, ids]) =>
  ids.map((id) => `${d}.${id}`),
);

function evaluate(input, multiplier = dimensions.map(() => 1)) {
  assert.equal(
    input.synthetic,
    true,
    "Only synthetic offline inputs are supported",
  );
  assert.ok(Object.hasOwn(profiles, input.stage), "Unsupported stage");
  assert.ok(
    ["GENERAL", "REGULATED", "CAPITAL_INTENSIVE"].includes(input.sector),
  );
  assert.ok(["GENERAL", "RECURRING"].includes(input.model));
  assert.ok(Number.isFinite(Date.parse(input.asOf)));
  assert.equal(input.criteria.length, criteriaIds.length);
  assert.equal(
    new Set(input.criteria.map((c) => c.id)).size,
    criteriaIds.length,
  );
  assert.ok(input.criteria.every((c) => criteriaIds.includes(c.id)));
  const rawWeights = profiles[input.stage].map((w, i) => {
    let factor = multiplier[i];
    assert.ok(Number.isFinite(factor) && factor >= 0.5 && factor <= 2);
    if (input.sector === "REGULATED" && i === 5) factor *= 1.5;
    if (input.sector === "CAPITAL_INTENSIVE" && [2, 4].includes(i))
      factor *= 1.25;
    if (input.model === "RECURRING" && i === 3) factor *= 1.15;
    assert.ok(
      factor >= 0.5 && factor <= 2,
      "Profile multiplier outside experimental limits",
    );
    return w * factor;
  });
  let materialConflict = false;
  const rows = dimensions.map(([dimension, ids], dimensionIndex) => {
    const applicable = ids
      .map((id) => input.criteria.find((c) => c.id === `${dimension}.${id}`))
      .filter((c) => {
        assert.ok(
          [
            "OBSERVED",
            "UNKNOWN",
            "AWAITING_VERIFICATION",
            "CONFLICTED",
            "NOT_APPLICABLE",
          ].includes(c.state),
        );
        if (c.state !== "NOT_APPLICABLE") return true;
        assert.ok(
          input.stage === "PRESEED" &&
            c.id === "commercial.retention" &&
            c.rule === "preseed.retention.not-yet-live",
          "Unsupported applicability rule",
        );
        return false;
      });
    assert.ok(
      applicable.length > 0,
      "No whole-dimension exclusion implemented",
    );
    const known = [];
    for (const c of applicable) {
      if (c.state === "CONFLICTED") {
        assert.ok(
          c.evidenceRefs.length >= 2,
          "Conflict needs both synthetic source references",
        );
        if (c.material) materialConflict = true;
      }
      if (c.state !== "OBSERVED") continue;
      assert.ok(Number.isInteger(c.anchor) && c.anchor >= 0 && c.anchor <= 4);
      assert.ok(c.sources.length > 0);
      const families = new Map();
      for (const s of c.sources) {
        assert.ok(
          s.ref.startsWith("synthetic:") && s.family.startsWith("synthetic:"),
        );
        assert.ok(Object.hasOwn(reliability, s.sourceClass));
        assert.ok(
          Number.isFinite(s.authority) && s.authority >= 0 && s.authority <= 1,
        );
        const age =
          (Date.parse(input.asOf) - Date.parse(s.observedAt)) / 86400000;
        assert.ok(
          Number.isFinite(age) && age >= 0,
          "Future or invalid source timestamp",
        );
        const q =
          reliability[s.sourceClass] *
          s.authority *
          2 ** (-age / halfLives[dimensionIndex]);
        families.set(s.family, Math.max(families.get(s.family) ?? 0, q));
      }
      const sources = [...families.values()].sort((a, b) => b - a);
      const confidence = Math.min(1, sources[0] + 0.15 * (sources[1] ?? 0));
      if (confidence > 0) known.push({ point: c.anchor * 2.5, confidence });
    }
    const coverage = known.length / applicable.length;
    const observedSum = sum(known.map((c) => c.point));
    return {
      dimension,
      point: known.length ? observedSum / known.length : null,
      lower: observedSum / applicable.length,
      upper:
        (observedSum + 10 * (applicable.length - known.length)) /
        applicable.length,
      coverage,
      confidence: sum(known.map((c) => c.confidence)) / applicable.length,
    };
  });
  function aggregate(count) {
    const weights = rawWeights.slice(0, count);
    const selected = rows.slice(0, count);
    const total = sum(weights);
    const knownWeight = sum(
      selected.map((r, i) => (r.point === null ? 0 : weights[i])),
    );
    return {
      observedPoint: knownWeight
        ? sum(selected.map((r, i) => (r.point ?? 0) * weights[i])) / knownWeight
        : null,
      lower: sum(selected.map((r, i) => r.lower * weights[i])) / total,
      upper: sum(selected.map((r, i) => r.upper * weights[i])) / total,
      coverage: sum(selected.map((r, i) => r.coverage * weights[i])) / total,
      confidence:
        sum(selected.map((r, i) => r.confidence * weights[i])) / total,
    };
  }
  const businessQuality = aggregate(5);
  const institutionalDiagnostic = aggregate(7);
  const eligible =
    businessQuality.coverage >= 1 - Number.EPSILON &&
    institutionalDiagnostic.coverage >= 0.8 &&
    rows.every((r) => r.coverage >= 0.5) &&
    institutionalDiagnostic.confidence >= 0.65 &&
    !materialConflict;
  return {
    version,
    status: eligible ? "EXPERIMENT_ELIGIBLE" : "INSUFFICIENT_EVIDENCE",
    finalBusinessQuality: eligible
      ? round(businessQuality.observedPoint)
      : null,
    businessQuality,
    institutionalDiagnostic,
    rows,
    materialConflict,
    inputHash: createHash("sha256")
      .update(
        JSON.stringify({
          version,
          ...input,
          criteria: [...input.criteria]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((c) => ({
              ...c,
              ...(c.sources
                ? {
                    sources: [...c.sources].sort((a, b) =>
                      JSON.stringify(a).localeCompare(JSON.stringify(b)),
                    ),
                  }
                : {}),
            })),
        }),
      )
      .digest("hex"),
  };
}

function fixture(stage = "SEED", anchor = 3) {
  return {
    synthetic: true,
    stage,
    sector: "GENERAL",
    model: "GENERAL",
    asOf: "2026-10-11T00:00:00Z",
    criteria: criteriaIds.map((id) => ({
      id,
      state: "OBSERVED",
      anchor,
      sources: [
        {
          ref: `synthetic:${id}`,
          family: `synthetic:${id}`,
          sourceClass: "VERIFIED_PRIMARY",
          authority: 1,
          observedAt: "2026-10-11T00:00:00Z",
        },
      ],
    })),
  };
}
const criterion = (input, id) => input.criteria.find((c) => c.id === id);
const outcomes = [];
function check(label, input, assertions) {
  const result = evaluate(input);
  assertions(result);
  const perturbations = dimensions
    .flatMap((_, i) =>
      [0.8, 1.2].map(
        (factor) =>
          evaluate(
            input,
            dimensions.map((_, j) => (i === j ? factor : 1)),
          ).businessQuality.observedPoint,
      ),
    )
    .filter((n) => n !== null);
  outcomes.push({
    scenario: label,
    status: result.status,
    finalBusinessQuality: result.finalBusinessQuality,
    observedBusinessQuality:
      result.businessQuality.observedPoint === null
        ? null
        : round(result.businessQuality.observedPoint),
    confidence: round(result.institutionalDiagnostic.confidence * 100),
    bounds: [
      round(result.businessQuality.lower),
      round(result.businessQuality.upper),
    ],
    sensitivity: perturbations.length
      ? [round(Math.min(...perturbations)), round(Math.max(...perturbations))]
      : null,
  });
  return result;
}
const early = fixture("PRESEED");
criterion(early, "commercial.retention").state = "NOT_APPLICABLE";
criterion(early, "commercial.retention").rule =
  "preseed.retention.not-yet-live";
check("preseed-strong-product-no-revenue", early, (r) =>
  assert.equal(r.finalBusinessQuality, 7.5),
);
const governance = fixture();
for (const c of governance.criteria.filter((c) =>
  c.id.startsWith("governance."),
))
  c.anchor = 0;
check("seed-traction-weak-governance", governance, (r) => {
  assert.equal(r.finalBusinessQuality, 7.5);
  assert.equal(r.rows[5].point, 0);
});
const economics = fixture("GROWTH");
criterion(economics, "financial.unitEconomics").anchor = 0;
check("growth-revenue-bad-unit-economics", economics, (r) => {
  assert.ok(r.finalBusinessQuality < 7.5);
  assert.ok(r.rows[4].point < r.rows[3].point);
});
const claims = fixture("SEED", 4);
for (const c of claims.criteria) c.sources[0].sourceClass = "PROMOTIONAL";
check("impressive-unsupported-claims", claims, (r) => {
  assert.equal(r.finalBusinessQuality, null);
  assert.ok(r.institutionalDiagnostic.confidence < 0.2);
});
const conflicting = fixture();
Object.assign(criterion(conflicting, "financial.liquidity"), {
  state: "CONFLICTED",
  material: true,
  evidenceRefs: ["synthetic:cash-record", "synthetic:financial-record"],
});
check("contradictory-financials", conflicting, (r) => {
  assert.equal(r.finalBusinessQuality, null);
  assert.equal(r.materialConflict, true);
  assert.ok(r.businessQuality.upper > r.businessQuality.lower);
});
const missing = fixture();
for (const c of missing.criteria) c.state = "UNKNOWN";
check("insufficient-evidence", missing, (r) => {
  assert.equal(r.finalBusinessQuality, null);
  assert.equal(r.businessQuality.observedPoint, null);
  assert.equal(r.businessQuality.lower, 0);
  assert.equal(r.businessQuality.upper, 10);
});
const base = evaluate(fixture());
const outOfMandate = fixture();
outOfMandate.syntheticMandateFit = 0;
check("out-of-mandate", outOfMandate, (r) =>
  assert.equal(r.finalBusinessQuality, base.finalBusinessQuality),
);
const strong = fixture("SEED", 4);
strong.syntheticMandateFit = 1;
check("strong-quality-poor-fit", strong, (r) =>
  assert.equal(r.finalBusinessQuality, 10),
);
const weak = fixture("SEED", 1);
weak.syntheticMandateFit = 10;
check("weak-quality-strong-fit", weak, (r) =>
  assert.equal(r.finalBusinessQuality, 2.5),
);
const lessEvidence = fixture();
for (const c of lessEvidence.criteria)
  c.sources[0].sourceClass = "FOUNDER_CLAIM";
check("similar-strength-materially-different-evidence", lessEvidence, (r) => {
  assert.equal(
    r.businessQuality.observedPoint,
    base.businessQuality.observedPoint,
  );
  assert.ok(
    r.institutionalDiagnostic.confidence <
      base.institutionalDiagnostic.confidence,
  );
  assert.equal(r.finalBusinessQuality, null);
});
const duplicated = fixture();
for (const c of duplicated.criteria)
  c.sources.push(...Array.from({ length: 10 }, () => ({ ...c.sources[0] })));
assert.equal(
  evaluate(duplicated).institutionalDiagnostic.confidence,
  base.institutionalDiagnostic.confidence,
);
const stale = fixture();
for (const c of stale.criteria)
  c.sources[0].observedAt = "2020-10-11T00:00:00Z";
assert.equal(
  evaluate(stale).businessQuality.observedPoint,
  base.businessQuality.observedPoint,
);
assert.equal(evaluate(stale).finalBusinessQuality, null);
assert.ok(
  evaluate(stale).institutionalDiagnostic.confidence <
    base.institutionalDiagnostic.confidence,
);
const reordered = fixture();
reordered.criteria.reverse();
assert.equal(evaluate(reordered).inputHash, base.inputHash);
assert.deepEqual(evaluate(reordered).rows, base.rows);
assert.throws(() => evaluate({ ...fixture(), synthetic: false }));
assert.throws(() => evaluate({ ...fixture(), stage: "UNSUPPORTED" }));
const future = fixture();
future.criteria[0].sources[0].observedAt = "2027-10-11T00:00:00Z";
assert.throws(() => evaluate(future));
const invalid = fixture();
invalid.criteria[0].anchor = 8.8;
assert.throws(() => evaluate(invalid));
const invalidApplicability = fixture();
invalidApplicability.criteria[0].state = "NOT_APPLICABLE";
assert.throws(() => evaluate(invalidApplicability));
assert.equal(outcomes.length, 10);
const selectivelyWithheld = fixture();
selectivelyWithheld.criteria[0].anchor = 0;
const completeWeakness = evaluate(selectivelyWithheld);
selectivelyWithheld.criteria[0].state = "UNKNOWN";
const withheldWeakness = evaluate(selectivelyWithheld);
assert.equal(withheldWeakness.finalBusinessQuality, null);
assert.ok(
  withheldWeakness.businessQuality.lower <=
    completeWeakness.finalBusinessQuality,
);
console.log(
  JSON.stringify({
    status: "PASS",
    version,
    syntheticOnly: true,
    productionIntegration: false,
    scenarios: outcomes,
    invariants: [
      "withholding-known-weakness-cannot-improve-final-score",
      "duplicate-source-no-confidence-increase",
      "stale-confidence-not-merit",
      "source-order-invariance",
      "non-synthetic-refused",
      "unknown-context-refused",
      "future-source-refused",
      "invalid-anchor-refused",
      "unsupported-applicability-refused",
    ],
  }),
);
