// README and print HTML for one scenario, from the scenario data and the
// engine result only (no hand-typed scores).

import { BANNER, CRITERIA, SCENARIO_ID } from "./scenario.mjs";

const pct = (n) => `${Math.round(n * 1000) / 10}%`;
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const md = (s) => String(s).replaceAll("|", "\\|");

function rows(scenario, result) {
  const evidence = new Map();
  for (const f of scenario.founders)
    evidence.set(f.criterion, `Founder ${f.title} ${f.detail}`);
  for (const c of scenario.claims) evidence.set(c.criterion, c.statement);
  const graded = new Map(
    result.unicornPotential.pillars.flatMap((p) =>
      p.criteria.map((c) => [c.id, c]),
    ),
  );
  const ungraded = new Map(scenario.ungraded.map((u) => [u.criterion, u]));
  return CRITERIA.map((c) => {
    const g = graded.get(c.id);
    return {
      ...c,
      evidence: evidence.get(c.id) ?? "(none: left ungraded)",
      state: g?.state ?? "UNKNOWN",
      grade: g?.grade ?? null,
      sources: g?.sourceIds ?? [],
      ungraded: ungraded.get(c.id) ?? null,
    };
  });
}

function summary(result) {
  const u = result.unicornPotential;
  const i = result.investability.view;
  return {
    u,
    i,
    line: `${u.overallScore ?? "not scored"}/100 · ${u.band ?? u.status} · confidence ${u.confidence} · coverage ${pct(u.coverage)} · stage band ${u.stage}`,
    invLine: `${i.score ?? "not scored"}/100 · ${i.band ?? i.status} · confidence ${i.confidence ?? "n/a"}${i.provisional ? " · provisional" : ""} · ${i.coverage.criteriaScored}/${i.coverage.criteriaApplicable} criteria, ${i.coverage.areasScored}/${i.coverage.areasTotal} areas`,
  };
}

const CEILING = [
  "Every synthetic source is USER_CLAIM with evidence status SELF_REPORTED, the most conservative status the rubric still grades (reliability 0.5).",
  "The engine caps any source at reliability 0.5 or below at grade 3, and grade 4 additionally needs reliability 0.85 or more (MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED) plus sustained, dated execution. Structured metric rules never exceed 3.",
  "This scenario never claims verification or independent corroboration, so every graded criterion is at most 3 and the overall score is at most 25 × 3 = 75. A score of 90 or more is not legitimately reachable on synthetic evidence; reaching it would need corroborated or verified real evidence across most pillars.",
  "DOCUMENT_SUPPORTED (0.7) would not change the score, only confidence; it was not used because no supporting document exists for a synthetic figure.",
  "Confidence follows source reliability, not the score: with every source at 0.5 the confidence index equals 0.5 × coverage, so it reads MODERATE only when all 24 criteria are graded and LOW otherwise.",
];

export function renderReadme(scenario, result) {
  const { u, i, line, invLine } = summary(result);
  const r = rows(scenario, result);
  const out = [];
  out.push(`# ${scenario.company}: illustrative high-growth scenario`, "");
  out.push(`> **${BANNER}**`, "");
  out.push(
    `Scenario \`${SCENARIO_ID}\`. Every input object carries \`{synthetic: true, scenario: "${SCENARIO_ID}", label: "Illustrative high-growth scenario — synthetic evidence"}\`. All figures are invented for illustration. The company's real assessment is separate and is computed only from its own evidence; nothing here is written to production.`,
    "",
  );
  out.push(
    `- Unicorn Potential method \`${u.methodVersion}\`, input rules \`${u.inputRulesVersion}\`; clock ${result.asOf}.`,
    `- Investability method \`${i.methodVersion}\`.`,
    "- Engine code, weights, thresholds and gates are unchanged (`packages/readiness`, built dist, public entrypoint).",
    "",
  );
  out.push("## Result", "");
  out.push(`- **Unicorn Potential:** ${line}.`);
  out.push(
    `- **Investability (separate, investor-facing):** ${invLine}. It reads the same inputs through its own rules; most of its criteria need deck sections, verification or documents this scenario does not supply.`,
    "",
  );
  out.push("## Stage", "", scenario.stageNote, "");
  out.push("## Assumptions", "", scenario.overview, "");
  out.push("| Assumption | Synthetic value |", "| --- | --- |");
  for (const [k, v] of scenario.keyFigures) out.push(`| ${md(k)} | ${md(v)} |`);
  out.push("");
  out.push("## Why the score stops at 75", "");
  for (const c of CEILING) out.push(`- ${c}`);
  out.push("");
  out.push("## Mapping to the 24 criteria", "");
  out.push(
    "| Criterion | Synthetic evidence (self-reported) | State | Grade |",
    "| --- | --- | --- | --- |",
  );
  for (const x of r)
    out.push(
      `| ${x.id} ${md(x.label)} | ${md(x.evidence)} | ${x.state} | ${x.grade ?? "—"} |`,
    );
  out.push("");
  out.push(
    `Additional dated metric claims (structured, same status): ${scenario.structured.map((s) => `\`${s.claimKey}\` (${md(s.statement)})`).join("; ")}.`,
    "",
  );
  out.push("## Criteria left ungraded", "");
  if (scenario.ungraded.length === 0) out.push("None.");
  for (const x of scenario.ungraded)
    out.push(`- **${x.criterion}**: ${x.reason}`);
  out.push("");
  out.push("## What real evidence would be needed", "");
  out.push(
    "Each criterion needs the rubric's evidence (below) as real, current, investor-visible records, at least DOCUMENT_SUPPORTED, and corroborated or verified for a grade of 4:",
    "",
  );
  for (const x of r) out.push(`- ${x.id} ${x.label}: ${x.gap}.`);
  out.push("", "Company-specific gaps from the public research:", "");
  for (const g of scenario.realEvidenceGaps) out.push(`- ${g}`);
  out.push("");
  out.push("## Reproduce", "");
  out.push(
    "```bash",
    "pnpm exec turbo run build --filter=@capital-q/readiness",
    `node scripts/seed/flagship/scenario/run.mjs ${scenario.slug}          # inputs.json, result.json, README.md`,
    `node scripts/seed/flagship/scenario/run.mjs ${scenario.slug} --pdf    # also the PDF (Chromium)`,
    "pnpm exec vitest run --config scripts/seed/flagship/scenario/vitest.config.mjs",
    "```",
    "",
  );
  return out.join("\n");
}

export function renderHtml(scenario, result) {
  const { u, i, line, invLine } = summary(result);
  const r = rows(scenario, result);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(scenario.company)} illustrative scenario</title>
<style>
:root{--ink:#14171c;--muted:#5a6270;--line:#d7dbe1;--warn-bg:#fff4d6;--warn-ink:#5c3d00}
*{box-sizing:border-box}body{margin:0;font:10pt/1.4 "Helvetica Neue",Arial,sans-serif;color:var(--ink);background:#fff}
h1{font-size:19pt;margin:0 0 4pt}h2{font-size:12pt;margin:11pt 0 4pt;border-bottom:1px solid var(--line);padding-bottom:2pt}
p{margin:0 0 6pt}.muted{color:var(--muted)}.big{font-size:13pt;font-weight:600}
.notice{border:1.5px solid #b98a00;background:var(--warn-bg);color:var(--warn-ink);padding:7pt 9pt;border-radius:4pt;margin:6pt 0 10pt}
table{width:100%;border-collapse:collapse;font-size:8.2pt}th,td{border-bottom:1px solid var(--line);padding:3pt 4pt;text-align:left;vertical-align:top}
th{background:#f2f4f7}tr{page-break-inside:avoid}td.g{text-align:center;white-space:nowrap}
ul{margin:0 0 6pt 14pt;padding:0}li{margin:0 0 2pt}.kv td:first-child{width:42%;color:var(--muted)}
</style></head><body>
<h1>${esc(scenario.company)} — illustrative high-growth scenario</h1>
<div class="notice"><strong>${esc(BANNER)}</strong> Every figure below is invented for illustration. The company's real Capital Q assessment is separate and is computed only from its own evidence.</div>
<p class="muted">Scenario ${esc(SCENARIO_ID)} · Unicorn Potential method ${esc(u.methodVersion)} (input rules ${esc(u.inputRulesVersion)}) · Investability method ${esc(i.methodVersion)} · engine unchanged · clock ${esc(result.asOf)}</p>
<h2>Result on synthetic evidence</h2>
<p class="big">Unicorn Potential: ${esc(line)}</p>
<p>Investability (reported separately): ${esc(invLine)}.</p>
<p><strong>Stage.</strong> ${esc(scenario.stageNote)}</p>
<h2>Scenario assumptions</h2>
<p>${esc(scenario.overview)}</p>
<table class="kv"><tbody>${scenario.keyFigures.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
<h2>Why the score stops at 75</h2>
<ul>${CEILING.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
<h2>The 24 criteria</h2>
<table><thead><tr><th style="width:22%">Criterion</th><th>Synthetic evidence (self-reported)</th><th style="width:11%">State</th><th style="width:6%">Grade</th></tr></thead><tbody>
${r.map((x) => `<tr><td><strong>${esc(x.id)}</strong> ${esc(x.label)}</td><td>${esc(x.evidence)}</td><td>${esc(x.state)}</td><td class="g">${x.grade ?? "—"}</td></tr>`).join("\n")}
</tbody></table>
<h2>Criteria left ungraded</h2>
<ul>${scenario.ungraded.length === 0 ? "<li>None.</li>" : scenario.ungraded.map((x) => `<li><strong>${esc(x.criterion)}</strong>: ${esc(x.reason)}</li>`).join("")}</ul>
<h2>What real evidence would be needed</h2>
<p>Real, current, investor-visible records for each criterion, at least document-supported, and corroborated or verified for a grade of 4. Company-specific gaps from public research:</p>
<ul>${scenario.realEvidenceGaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
</body></html>`;
}
