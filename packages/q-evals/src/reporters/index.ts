import {
  Q_EVAL_HARD_INVARIANTS,
  Q_EVAL_SUITE_STATUS,
  Q_EVAL_SUITES,
  QEvalBaselineSchema,
  QEvalComparisonSchema,
  type QEvalBaseline,
  type QEvalComparison,
  type QEvalRunResult,
} from "../contracts/index.js";

/**
 * Reports (CQ-Q-010 §76-§84): the machine-readable result is the typed
 * contract serialised; the human summary shows what a reviewer or a CI
 * log needs — hard invariants first and separate from quality, then
 * versions, cost and the failed or review-needed case ids. No key, no
 * chain of thought, no fixture body.
 */

const pad = (value: string, width: number) => value.padEnd(width);

export function renderSummary(
  result: QEvalRunResult,
  options: { readonly showAnswers?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`# Q eval — ${result.profile} — ${result.status}`);
  lines.push("");
  lines.push(`run ${result.runId}`);
  lines.push(
    `datasets: ${result.datasets.map((d) => `${d.datasetId}@v${d.version} (${d.type})`).join(", ")}`,
  );
  lines.push(
    `versions: contracts ${result.environment.contractsVersion} · orchestration ${result.environment.orchestrationVersion} · firewall ${result.environment.firewallPolicyVersion} · prompt bundles [${result.environment.promptBundleVersions.join(", ")}] · routing policies [${result.environment.routingPolicyCodes.join(", ")}]`,
  );
  lines.push(`tools: ${result.environment.toolVersions.join(", ")}`);
  lines.push(
    `providers: ${result.environment.providers.map((p) => `${p.code} (${p.mode}${p.keyPresent === null ? "" : p.keyPresent ? ", key PRESENT" : ", key MISSING"})`).join(", ")}${result.environment.providerOverride === null ? "" : ` · override ${result.environment.providerOverride}`}`,
  );
  lines.push("");
  lines.push("## HARD INVARIANTS");
  for (const invariant of Q_EVAL_HARD_INVARIANTS) {
    lines.push(`${pad(invariant, 30)} ${result.hardInvariants[invariant]}`);
  }
  lines.push(
    `${pad("release gate", 30)} ${Object.values(result.hardInvariants).includes("FAIL") ? "FAIL" : Object.values(result.hardInvariants).includes("BLOCKED") ? "BLOCKED" : "PASS"}`,
  );
  lines.push("");
  lines.push("## Q QUALITY (observed; thresholds not yet calibrated)");
  for (const suite of Q_EVAL_SUITES) {
    const s = result.quality.bySuite[suite];
    const status = Q_EVAL_SUITE_STATUS[suite];
    if (status.status === "DEFERRED") {
      lines.push(`${pad(suite, 18)} DEFERRED — ${status.reason}`);
      continue;
    }
    lines.push(
      `${pad(suite, 18)} pass ${s.pass} · fail ${s.fail} · warn ${s.warn} · blocked ${s.blocked}`,
    );
  }
  lines.push("");
  lines.push("## CASES");
  for (const c of result.cases) {
    const failing = c.grades.filter(
      (g) => g.verdict === "FAIL" || g.verdict === "WARN",
    );
    const exec = c.execution;
    const attribution =
      exec === null
        ? ""
        : ` · ${exec.providerCode ?? "-"}/${exec.modelCode ?? "-"} · ${exec.latencyMs} ms · ${exec.inputTokens}/${exec.outputTokens} tok · $${exec.costUsd.toFixed(6)}${exec.runFailureCode === null ? "" : ` · failure ${exec.runFailureCode}`}`;
    lines.push(
      `${pad(c.caseId, 12)} ${pad(c.status, 8)} ${pad(c.suite, 16)} ${c.thresholdClass}${c.hardInvariant === undefined ? "" : ` [${c.hardInvariant}]`}${attribution}`,
    );
    for (const g of failing) {
      lines.push(`             ${g.verdict} ${g.graderId}: ${g.detail}`);
    }
    if (c.blockedReason !== undefined) {
      lines.push(`             BLOCKED: ${c.blockedReason}`);
    }
    if (options.showAnswers === true && exec?.answerText) {
      lines.push(
        `             answer: ${exec.answerText.replace(/\s+/g, " ").slice(0, 600)}`,
      );
    }
  }
  lines.push("");
  lines.push("## COST / LATENCY");
  lines.push(
    `cases ${result.cost.cases} · provider attempts ${result.cost.providerAttempts} · tokens ${result.cost.inputTokens}/${result.cost.outputTokens} · est. cost $${result.cost.estimatedCostUsd.toFixed(6)} · total latency ${result.cost.totalLatencyMs} ms · median ${result.cost.medianLatencyMs} ms · fallbacks ${result.cost.fallbacks}`,
  );
  lines.push("");
  const failed = result.cases
    .filter((c) => c.status === "FAIL")
    .map((c) => c.caseId);
  const blocked = result.cases
    .filter((c) => c.status === "BLOCKED")
    .map((c) => c.caseId);
  lines.push(`failed: ${failed.length === 0 ? "none" : failed.join(", ")}`);
  lines.push(`blocked: ${blocked.length === 0 ? "none" : blocked.join(", ")}`);
  lines.push(
    `human review needed: ${result.quality.humanReviewNeeded.length === 0 ? "none" : result.quality.humanReviewNeeded.join(", ")}`,
  );
  lines.push(`exit code ${result.exitCode}`);
  return lines.join("\n");
}

export function toBaseline(result: QEvalRunResult): QEvalBaseline {
  return QEvalBaselineSchema.parse({
    schemaVersion: 1,
    profile: result.profile,
    recordedAt: result.finishedAt,
    environment: {
      orchestrationVersion: result.environment.orchestrationVersion,
      firewallPolicyVersion: result.environment.firewallPolicyVersion,
      promptBundleVersions: result.environment.promptBundleVersions,
      toolVersions: result.environment.toolVersions,
    },
    cases: result.cases.map((c) => ({
      caseId: c.caseId,
      caseVersion: c.caseVersion,
      status: c.status,
      ...(c.hardInvariant === undefined
        ? {}
        : { hardInvariant: c.hardInvariant }),
    })),
    cost: {
      estimatedCostUsd: result.cost.estimatedCostUsd,
      medianLatencyMs: result.cost.medianLatencyMs,
    },
  });
}

/** Baseline vs candidate (§81): what changed, no significance claim. */
export function compareToBaseline(
  baseline: QEvalBaseline,
  candidate: QEvalRunResult,
): QEvalComparison {
  const before = new Map(baseline.cases.map((c) => [c.caseId, c]));
  const after = new Map(candidate.cases.map((c) => [c.caseId, c]));
  const newHardFailures: string[] = [];
  const resolvedFailures: string[] = [];
  const changed: QEvalComparison["changed"] = [];
  for (const [caseId, now] of after) {
    const was = before.get(caseId);
    if (was === undefined) {
      continue;
    }
    if (was.status !== now.status) {
      changed.push({ caseId, from: was.status, to: now.status });
      if (now.status === "FAIL" && now.hardInvariant !== undefined) {
        newHardFailures.push(caseId);
      }
      if (was.status === "FAIL" && now.status === "PASS") {
        resolvedFailures.push(caseId);
      }
    }
  }
  const versionChanges: QEvalComparison["versionChanges"] = [];
  const compareVersion = (field: string, from: string, to: string) => {
    if (from !== to) {
      versionChanges.push({ field, from, to });
    }
  };
  compareVersion(
    "orchestrationVersion",
    baseline.environment.orchestrationVersion,
    candidate.environment.orchestrationVersion,
  );
  compareVersion(
    "firewallPolicyVersion",
    baseline.environment.firewallPolicyVersion,
    candidate.environment.firewallPolicyVersion,
  );
  compareVersion(
    "promptBundleVersions",
    baseline.environment.promptBundleVersions.join(","),
    candidate.environment.promptBundleVersions.join(","),
  );
  compareVersion(
    "toolVersions",
    baseline.environment.toolVersions.join(","),
    candidate.environment.toolVersions.join(","),
  );
  const regressed =
    newHardFailures.length > 0 || changed.some((c) => c.to === "FAIL");
  return QEvalComparisonSchema.parse({
    baselineRecordedAt: baseline.recordedAt,
    newHardFailures,
    resolvedFailures,
    changed,
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    costDeltaUsd:
      Math.round(
        (candidate.cost.estimatedCostUsd - baseline.cost.estimatedCostUsd) *
          1e6,
      ) / 1e6,
    medianLatencyDeltaMs:
      candidate.cost.medianLatencyMs - baseline.cost.medianLatencyMs,
    versionChanges,
    regressed,
  });
}

export function renderComparison(comparison: QEvalComparison): string {
  const lines = [
    `# Baseline comparison — ${comparison.regressed ? "REGRESSED" : "no regression"}`,
    `baseline recorded ${comparison.baselineRecordedAt}`,
    `new hard failures: ${comparison.newHardFailures.join(", ") || "none"}`,
    `resolved failures: ${comparison.resolvedFailures.join(", ") || "none"}`,
    `changed: ${comparison.changed.map((c) => `${c.caseId} ${c.from}→${c.to}`).join(", ") || "none"}`,
    `added: ${comparison.added.join(", ") || "none"} · removed: ${comparison.removed.join(", ") || "none"}`,
    `cost delta $${comparison.costDeltaUsd.toFixed(6)} · median latency delta ${comparison.medianLatencyDeltaMs} ms`,
    `version changes: ${comparison.versionChanges.map((v) => `${v.field} ${v.from} → ${v.to}`).join("; ") || "none"}`,
  ];
  return lines.join("\n");
}
