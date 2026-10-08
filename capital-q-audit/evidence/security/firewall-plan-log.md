# Context Firewall plan and log

Why included: Policy version, permittedScopeKinds, maxSensitivity logged per plan.

## `packages/contracts/src/q/firewall.ts` lines 30-36

```ts
   30   * The two are distinct axes and are never flattened into one.
   31   */
   32  
   33  /** The deterministic policy generation that produced a plan. Never "latest". */
   34  export const Q_CONTEXT_FIREWALL_POLICY_VERSION = "context-firewall-v2" as const;
   35  
   36  /** Context labels: exactly ADR-001's disclosure scopes. No alias vocabulary. */
```

## `packages/q-firewall/src/version.ts` lines 1-18

```ts
    1  import { Q_CONTEXT_FIREWALL_POLICY_VERSION } from "@capital-q/contracts";
    2  
    3  /**
    4   * The policy generation every plan is stamped with (packet §43-44). A
    5   * change to any rule in this package — a scope's default label or
    6   * sensitivity, a purpose's candidate set, a combination rule, the
    7   * evaluation order — is a new version, so a stored run can be audited
    8   * against exactly the policy that allowed its context. Never "latest".
    9   */
   10  export const CONTEXT_FIREWALL_POLICY_VERSION =
   11    Q_CONTEXT_FIREWALL_POLICY_VERSION;
   12  
   13  /**
   14   * How long a plan is trusted before retrieval must ask again. A plan is a
   15   * decision at an instant, not a bearer token: membership, shares and
   16   * relationships change, and a resumed run always re-plans regardless.
   17   */
   18  export const CONTEXT_PLAN_REVALIDATE_AFTER_MS = 15 * 60 * 1000;
```

## `packages/q-firewall/src/firewall.ts` lines 595-625

```ts
  595      plan: async (request): Promise<ContextFirewallDecision> => {
  596        const started = Date.now();
  597        const decision = await evaluateRequest(request);
  598        logger?.info(
  599          {
  600            qRunId: request.runId,
  601            correlationId: request.correlationId,
  602            policyVersion: CONTEXT_FIREWALL_POLICY_VERSION,
  603            outcome: decision.outcome,
  604            ...(decision.outcome === "AUTHORISED"
  605              ? {
  606                  taskClass: decision.plan.purpose.taskClass,
  607                  permittedScopeKinds: decision.plan.scopes.map((s) => s.kind),
  608                  deniedReasons: decision.plan.denied.map((d) => d.reason),
  609                  maxSensitivity: decision.plan.maxSensitivity,
  610                  combinationRules: decision.plan.combinationConstraints.map(
  611                    (c) => c.ruleId,
  612                  ),
  613                }
  614              : {
  615                  reason: decision.reason,
  616                  deniedReasons: decision.denied.map((d) => d.reason),
  617                }),
  618            durationMs: Date.now() - started,
  619          },
  620          "context firewall evaluated",
  621        );
  622        return decision;
  623      },
  624    };
  625  
```

