# Evidence: packages/q-orchestrator/src/workforce/plan.ts lines 56-143

- Original path: `packages/q-orchestrator/src/workforce/plan.ts`
- Line range: 56-143 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: boundPlan keeps WRITER/REVIEWER steps with no tools (DRAFT_ROLES).

```ts
   56  export type PlanBounds = {
   57    /** What the person allowed for this job (tool and action names). */
   58    readonly permitted: ReadonlySet<string>;
   59    /** What the whole job may spend, USD. */
   60    readonly budgetUsd: number;
   61    readonly maxSteps?: number | undefined;
   62  };
   63  
   64  export const MAX_JOB_STEPS = 12;
   65  
   66  /** Roles that only work on drafts: no tools needed to be useful. */
   67  const DRAFT_ROLES: ReadonlySet<AgentRole> = new Set(["WRITER", "REVIEWER"]);
   68  
   69  export function boundPlan(
   70    steps: readonly ProposedStep[],
   71    bounds: PlanBounds,
   72  ): {
   73    readonly steps: readonly BoundStep[];
   74    readonly refused: readonly {
   75      readonly key: string;
   76      readonly reason: StepRefusal;
   77    }[];
   78    readonly budgetUsd: number;
   79  } {
   80    const kept: BoundStep[] = [];
   81    const refused: { key: string; reason: StepRefusal }[] = [];
   82    const keys = new Set<string>();
   83    let spent = 0;
   84    const maxSteps = Math.min(bounds.maxSteps ?? MAX_JOB_STEPS, MAX_JOB_STEPS);
   85    for (const step of steps) {
   86      const refuse = (reason: StepRefusal) => {
   87        refused.push({ key: step.key, reason });
   88      };
   89      if (keys.has(step.key)) {
   90        refuse("DUPLICATE_KEY");
   91        continue;
   92      }
   93      keys.add(step.key);
   94      if (!isAgentRole(step.role)) {
   95        refuse("UNKNOWN_ROLE");
   96        continue;
   97      }
   98      const role = step.role;
   99      if (role === "LEAD") {
  100        refuse("LEAD_IS_NOT_A_STEP");
  101        continue;
  102      }
  103      if (kept.length >= maxSteps) {
  104        refuse("TOO_MANY_STEPS");
  105        continue;
  106      }
  107      const roleTools: ReadonlySet<string> =
  108        role === "AD_HOC" ? ALL_ROLE_TOOLS : new Set(AGENT_REGISTRY[role].tools);
  109      const tools = [...new Set(step.tools)].filter(
  110        (tool) => roleTools.has(tool) && bounds.permitted.has(tool),
  111      );
  112      if (tools.length === 0 && !DRAFT_ROLES.has(role)) {
  113        refuse("NO_PERMITTED_TOOL");
  114        continue;
  115      }
  116      // Only steps already kept can be waited on: a plan runs in order.
  117      if (step.dependsOn.some((key) => !kept.some((one) => one.key === key))) {
  118        refuse("WAITS_ON_MISSING_STEP");
  119        continue;
  120      }
  121      const budgetUsd = AGENT_REGISTRY[role].budgetUsd;
  122      if (spent + budgetUsd > bounds.budgetUsd + 1e-9) {
  123        refuse("OVER_BUDGET");
  124        continue;
  125      }
  126      spent += budgetUsd;
  127      kept.push({
  128        key: step.key,
  129        role,
  130        agentName:
  131          role === "AD_HOC"
  132            ? (step.agentName ?? "Agent").slice(0, 60)
  133            : AGENT_REGISTRY[role].title,
  134        goal: step.goal,
  135        tools,
  136        dependsOn: [...step.dependsOn],
  137        budgetUsd,
  138        outward: tools.some((tool) => OUTWARD_TOOLS.has(tool)),
  139        spawned: role === "AD_HOC",
  140      });
  141    }
  142    return { steps: kept, refused, budgetUsd: spent };
  143  }
```
