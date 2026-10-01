import { createHash } from "node:crypto";

import { z } from "zod";

import {
  Q_TASK_CLASSES,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * BILLING (ADR 0034): what the person's plan includes, and the gate on
 * Q's model-heavy, plan-controlled tools.
 *
 * The gate is deterministic code outside any model (doc 12 §51.1). A tool
 * whose feature the plan does not cover (or whose monthly units are used)
 * is DENIED with ENTITLEMENT_REQUIRED and one plain sentence -- the plan,
 * the counts, the reset and where to see plans -- which Q relays and then
 * offers to open the plan page. Q never pitches an upgrade unprompted, and
 * nothing here touches what Q may know or how anything ranks (PADL #85).
 */

export const GET_MY_PLAN = "plan.get_mine" as const;

export type QEntitlementVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string };

export type QPlanFeature = {
  readonly key: string;
  readonly name: string;
  readonly included: boolean;
  readonly limit: number | null;
  readonly used: number | null;
  readonly unitSingular: string;
  readonly unitPlural: string;
  readonly resetsAt: string | null;
};

export type QEntitlementPort = {
  /** May this account start one more unit of `feature` now? Records nothing. */
  readonly check: (
    actor: ActorContext,
    feature: string,
  ) => Promise<QEntitlementVerdict>;
  /** Record one unit, once per key; refuses past the limit. */
  readonly consume: (
    actor: ActorContext,
    feature: string,
    idempotencyKey: string,
  ) => Promise<QEntitlementVerdict>;
  /** Give the unit back when the metered work failed. */
  readonly release: (
    actor: ActorContext,
    feature: string,
    idempotencyKey: string,
  ) => Promise<void>;
  readonly summary: (actor: ActorContext) => Promise<{
    readonly planName: string;
    readonly source: string;
    readonly endsAt: string | null;
    readonly features: readonly QPlanFeature[];
  }>;
};

/** Which plan feature each gated tool draws on, and how. */
export type QToolGate = {
  readonly feature: string;
  /**
   * CHECK: the tool only prepares (a proposal approved later); the unit is
   * taken when the approved action runs. CONSUME: the tool itself is the
   * metered work (a web research request).
   */
  readonly mode: "CHECK" | "CONSUME";
};

/**
 * Wraps a tool's authorize (and, for CONSUME, its execute) with the plan
 * gate. The original authorize runs first, so a person who may not use the
 * tool at all still learns nothing about plans.
 */
export function gateQTool(
  tool: AnyQToolDefinition,
  gate: QToolGate,
  entitlements: QEntitlementPort,
): AnyQToolDefinition {
  // One unit per distinct request in a run: the same call repeated (a
  // retry) is the same unit.
  const keyOf = (input: unknown, runId: string) =>
    `${tool.id}:${runId}:${createHash("sha256")
      .update(JSON.stringify(input) ?? "")
      .digest("hex")
      .slice(0, 32)}`;
  return {
    ...tool,
    authorize: async (input, context) => {
      const own = await tool.authorize(input, context);
      if (own.outcome !== "ALLOW") return own;
      // CONSUME takes the unit here, atomically with the limit check, so
      // the work never starts past the limit; a failed run gives it back.
      const verdict =
        gate.mode === "CHECK"
          ? await entitlements.check(context.actor, gate.feature)
          : await entitlements.consume(
              context.actor,
              gate.feature,
              keyOf(input, context.runId),
            );
      return verdict.allowed
        ? own
        : deny("ENTITLEMENT_REQUIRED", verdict.message);
    },
    execute:
      gate.mode === "CHECK"
        ? tool.execute
        : async (input, context, grant) => {
            try {
              return await tool.execute(input, context, grant);
            } catch (error: unknown) {
              await entitlements
                .release(
                  context.actor,
                  gate.feature,
                  keyOf(input, context.runId),
                )
                .catch(() => undefined);
              throw error;
            }
          },
  };
}

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export const MyPlanOutputSchema = z
  .object({
    planName: z.string().max(60),
    source: z.string().max(40),
    endsAt: z.string().nullable(),
    features: z
      .array(
        z
          .object({
            name: z.string().max(80),
            included: z.boolean(),
            allowance: z.string().max(120),
            resetsAt: z.string().nullable(),
          })
          .strict(),
      )
      .max(20),
    planPage: z.literal("/settings/plan"),
  })
  .strict();
export type MyPlanOutput = z.infer<typeof MyPlanOutputSchema>;

function allowance(feature: QPlanFeature): string {
  if (!feature.included) return "Not included";
  if (feature.limit === null) return "Unlimited";
  const used = feature.used === null ? "" : `, ${String(feature.used)} used`;
  const units = feature.limit === 1 ? feature.unitSingular : feature.unitPlural;
  return `${String(feature.limit)} ${units}${
    feature.resetsAt === null ? "" : " a month"
  }${used}`.slice(0, 120);
}

export function createGetMyPlanTool(
  entitlements: QEntitlementPort,
): AnyQToolDefinition {
  return defineQTool<Record<string, never>, MyPlanOutput, null>({
    id: GET_MY_PLAN,
    version: 1,
    status: "ACTIVE",
    providerName: "get_my_plan",
    description:
      "Reads the plan of the person's own account (their organisation, or them alone): its name, and for each plan-controlled feature (rehearsals, Q handling things, AI images in documents, web research, the Q Daily, GateQ gateways) whether it is included, the allowance, how much is used this month and when it resets. Call it when they ask what their plan includes, how many rehearsals they have left, or why Q could not do something because of their plan. Their plan page is /settings/plan. Never suggest an upgrade unless they ask or a limit stopped them.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: z.object({}).strict(),
    output: MyPlanOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (_input, context) => {
      const summary = await entitlements.summary(context.actor);
      return {
        planName: summary.planName.slice(0, 60),
        source: summary.source.slice(0, 40),
        endsAt: summary.endsAt,
        features: summary.features.slice(0, 20).map((feature) => ({
          name: feature.name.slice(0, 80),
          included: feature.included,
          allowance: allowance(feature),
          resetsAt: feature.resetsAt,
        })),
        planPage: "/settings/plan",
      };
    },
  });
}
