// InvestIQ shadow comparison (ADR 0068, PROPOSED). READ-ONLY.
//
// Reads the latest stored readiness-rules/v1 assessment per company from the
// hosted staging DB (one `select`, read_only), computes the InvestIQ shadow
// assessment from it offline, and prints aggregate differences. Writes
// nothing anywhere; prints no company names, ids or statements.
//
//   cd packages/readiness && node_modules/.bin/tsc -p .   # build dist first
//   /root/sb node scripts/handoff/live/investiq-shadow-compare.mjs
//
// Offline: pass a JSON file of [{assessment, assessed_at}] rows instead:
//   node scripts/handoff/live/investiq-shadow-compare.mjs rows.json
import { readFileSync } from "node:fs";

const m = await import("../../../packages/readiness/dist/index.js");

const SQL = `select distinct on (company_id) assessment, assessed_at
  from core.company_readiness_assessments
 order by company_id, revision desc`;

async function hostedRows() {
  const r = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: SQL, read_only: true }),
    },
  );
  if (!r.ok) throw new Error(`hosted read ${r.status}`);
  return r.json();
}

const rows = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], "utf8"))
  : await hostedRows();

const diffCounts = {};
const perDim = {};
const exclusions = {};
const states = {};
const assumptions = new Set();
let conflicts = 0;
let finalisable = 0;

rows.forEach((row, i) => {
  const asOf = new Date(row.assessed_at).toISOString();
  const shadowIn = m.investiqInputFromLegacyReadiness(row.assessment, {
    companyRef: `row-${i + 1}`,
    asOf,
  });
  shadowIn.assumptions.forEach((a) => assumptions.add(a));
  for (const e of shadowIn.excluded)
    exclusions[e.reason] = (exclusions[e.reason] ?? 0) + 1;
  const a = m.assessInvestIQ(shadowIn.input);
  if (a.finalisation.reasons.length === 1) finalisable += 1;
  for (const d of a.dimensions) {
    for (const c of d.criteria) states[c.state] = (states[c.state] ?? 0) + 1;
    if (d.subscore.hasUnresolvedConflict) conflicts += 1;
  }
  for (const c of m.compareShadowWithLegacy(shadowIn, a)) {
    const k = `${c.dimension} (v1 ${c.legacyPillar})`;
    perDim[k] ??= {
      legacy: {},
      observedCriteria: 0,
      applicableCriteria: 0,
      highest: {},
    };
    const p = perDim[k];
    p.legacy[c.legacyStatus ?? "absent"] =
      (p.legacy[c.legacyStatus ?? "absent"] ?? 0) + 1;
    p.observedCriteria += c.observedCriteria;
    p.applicableCriteria += c.applicableCriteria;
    const h = c.highestEvidenceStatus ?? "none";
    p.highest[h] = (p.highest[h] ?? 0) + 1;
    for (const d of c.differences) diffCounts[d] = (diffCounts[d] ?? 0) + 1;
  }
});

console.log(
  JSON.stringify(
    {
      method: m.INVESTIQ_SHADOW_METHOD_V0.version,
      companies: rows.length,
      productionValuesChanged: 0,
      differences: diffCounts,
      criterionStates: states,
      dimensionsWithOpenConflict: conflicts,
      companiesWithOnlyMethodNotApprovedReason: finalisable,
      adapterExclusions: exclusions,
      adapterAssumptions: [...assumptions],
      perDimension: perDim,
    },
    null,
    2,
  ),
);
