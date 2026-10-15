import type { PlanUnderTest, WorkforceScenarioRun } from "./run.js";
import type { WorkforceScenario } from "./scenarios.js";

/**
 * Scores a workforce job on plan quality and task completion (wf
 * 2026-10-16). Deterministic: every check is code over the plan and what
 * the job recorded -- never an LLM judge, never the wording of an answer.
 *
 * Plan quality: an outcome is stated; no plan step is refused; no invented
 * evidence; the right specialists; real dependencies (order) and no false
 * ones (parallel work); the gaps the situation shows are named as missing
 * or unknown; steps cite the situation when there is one.
 * Completion (fake runs only): the job ends as it should; an outward step
 * is held on a contradiction; a fallback stands in for a failed step; the
 * next actions are the valuable ones, flagged for approval by code.
 */

export type WorkforceCheck = {
  readonly name: string;
  readonly kind: "PLAN" | "COMPLETION";
  readonly weight: number;
  readonly ok: boolean;
  readonly detail?: string | undefined;
};

export type WorkforceGrade = {
  readonly scenarioId: string;
  /** 0-100, weighted share of checks passed. */
  readonly score: number;
  readonly planScore: number;
  readonly completionScore: number | null;
  readonly checks: readonly WorkforceCheck[];
};

function upstream(plan: PlanUnderTest, key: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (one: string) => {
    for (const dep of plan.steps.find((step) => step.key === one)?.dependsOn ??
      []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(key);
  return seen;
}

function roleOf(plan: PlanUnderTest, key: string): string | undefined {
  return plan.steps.find((step) => step.key === key)?.role;
}

function score(checks: readonly WorkforceCheck[]): number {
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  if (total === 0) return 100;
  const passed = checks
    .filter((check) => check.ok)
    .reduce((sum, check) => sum + check.weight, 0);
  return Math.round((passed / total) * 100);
}

export function gradePlan(
  scenario: WorkforceScenario,
  plan: PlanUnderTest,
): readonly WorkforceCheck[] {
  const expect = scenario.expect;
  const roles = new Set(plan.steps.map((step) => step.role));
  const checks: WorkforceCheck[] = [];
  const check = (
    name: string,
    weight: number,
    ok: boolean,
    detail?: string,
  ) => {
    checks.push({
      name,
      kind: "PLAN",
      weight,
      ok,
      ...(detail === undefined ? {} : { detail }),
    });
  };
  const outcome = plan.reasoning?.outcome ?? "";
  check(
    "states the outcome",
    2,
    outcome.trim().length >= 20,
    outcome || "none",
  );
  check("no step refused by code", 3, plan.refused === 0, String(plan.refused));
  if (plan.droppedRefs !== null) {
    check(
      "no invented evidence",
      2,
      plan.droppedRefs === 0,
      String(plan.droppedRefs),
    );
  }
  const missingRoles = expect.roles.filter((role) => !roles.has(role));
  check(
    "the right specialists",
    2,
    missingRoles.length === 0,
    missingRoles.join(", ") || undefined,
  );
  for (const [before, after] of expect.order) {
    const ok = plan.steps
      .filter((step) => step.role === after)
      .some((step) =>
        [...upstream(plan, step.key)].some(
          (key) => roleOf(plan, key) === before,
        ),
      );
    check(`${after} waits on ${before}`, 2, ok);
  }
  for (const [a, b] of expect.parallel) {
    const tied = plan.steps.some(
      (one) =>
        one.role === a &&
        plan.steps.some(
          (two) =>
            two.role === b &&
            (upstream(plan, two.key).has(one.key) ||
              upstream(plan, one.key).has(two.key)),
        ),
    );
    check(
      `${a} and ${b} run side by side`,
      1,
      roles.has(a) && roles.has(b) && !tied,
    );
  }
  const gaps = (plan.reasoning?.prerequisites ?? []).filter(
    (one) => one.status !== "MET",
  );
  for (const pattern of expect.gaps) {
    check(
      `names the gap ${pattern.source}`,
      2,
      gaps.some((one) => pattern.test(one.what)),
      gaps.map((one) => one.what).join(" | ") || "none",
    );
  }
  const facts = plan.reasoning?.situation.length ?? 0;
  if (facts > 0) {
    check(
      "steps rest on the situation",
      1,
      plan.steps.some((step) => step.evidence.length > 0),
    );
  }
  const unmet = (plan.reasoning?.prerequisites ?? []).filter(
    (one) => one.status === "MET" && one.evidence.length === 0,
  );
  check("never MET without a fact", 1, unmet.length === 0);
  return checks;
}

export function gradeRun(
  scenario: WorkforceScenario,
  run: WorkforceScenarioRun,
): readonly WorkforceCheck[] {
  const expect = scenario.expect;
  const checks: WorkforceCheck[] = [];
  const check = (
    name: string,
    weight: number,
    ok: boolean,
    detail?: string,
  ) => {
    checks.push({
      name,
      kind: "COMPLETION",
      weight,
      ok,
      ...(detail === undefined ? {} : { detail }),
    });
  };
  check(
    `job ends ${expect.jobStatus}`,
    2,
    run.jobStatus === expect.jobStatus,
    run.jobStatus,
  );
  const held = run.outward.some(
    (step) => step.status === "HELD" && /contradiction/iu.test(step.summary),
  );
  check(
    expect.holdsOutward
      ? "holds outward work on a contradiction"
      : "sends nothing it should hold",
    2,
    held === expect.holdsOutward,
  );
  if (expect.usesFallback) {
    check("a fallback stands in for a failed step", 2, run.fallbackStoodIn);
  }
  const next = run.progress.nextActions;
  for (const pattern of expect.next) {
    check(
      `recommends ${pattern.source}`,
      2,
      next.some((one) => pattern.test(one.action)),
      next.map((one) => one.action).join(" | ") || "none",
    );
  }
  for (const tool of expect.approvalFor) {
    const one = next.find((action) => action.tool === tool);
    check(`${tool} next needs approval`, 1, one?.needsApproval === true);
  }
  check(
    "reads never need approval",
    1,
    next.every(
      (one) =>
        one.tool === null ||
        one.needsApproval ||
        /^(list_|search_|find_|public_web)/u.test(one.tool),
    ),
  );
  return checks;
}

export function gradeWorkforce(
  scenario: WorkforceScenario,
  plan: PlanUnderTest,
  run?: WorkforceScenarioRun,
): WorkforceGrade {
  const planChecks = gradePlan(scenario, plan);
  const runChecks = run === undefined ? [] : gradeRun(scenario, run);
  const checks = [...planChecks, ...runChecks];
  return {
    scenarioId: scenario.id,
    score: score(checks),
    planScore: score(planChecks),
    completionScore: run === undefined ? null : score(runChecks),
    checks,
  };
}
