"use server";

import { randomUUID } from "node:crypto";

import { decideQPlan, getQPlan } from "@capital-q/api-client";
import {
  QPlanDecisionRequestSchema,
  type QPlanDecisionResult,
  type QPlanView,
} from "@capital-q/contracts";
import { z } from "zod";

import { qApiSession } from "@/features/q/context";

/**
 * Situation-first planning (S5): the plan card's read and its three
 * affordances, on the server as the person (the session never reaches the
 * browser). The Q API answers only for the person's own plan; an id grants
 * nothing, and a decision on a version the card no longer shows is STALE.
 */

const Id = z.string().uuid();
const Version = z.number().int().min(1).max(1000);

export type PlanRead =
  | { readonly ok: true; readonly view: QPlanView }
  | { readonly ok: false; readonly message: string };

export async function readPlanAction(
  rawPlanId: string,
  rawVersion?: number,
): Promise<PlanRead> {
  const planId = Id.safeParse(rawPlanId);
  const version =
    rawVersion === undefined ? null : Version.safeParse(rawVersion);
  const session = await qApiSession();
  if (
    !planId.success ||
    session === null ||
    (version !== null && !version.success)
  ) {
    return { ok: false, message: "This plan isn't available here." };
  }
  try {
    return {
      ok: true,
      view: await getQPlan(
        session,
        planId.data,
        version === null ? undefined : version.data,
      ),
    };
  } catch {
    return { ok: false, message: "This plan isn't available here." };
  }
}

export async function decidePlanAction(
  rawPlanId: string,
  rawRequest: unknown,
): Promise<
  | QPlanDecisionResult
  | { readonly outcome: "UNAVAILABLE"; readonly message: string }
> {
  const planId = Id.safeParse(rawPlanId);
  const request = QPlanDecisionRequestSchema.safeParse(rawRequest);
  const session = await qApiSession();
  if (!planId.success || !request.success || session === null) {
    return { outcome: "UNAVAILABLE", message: "That couldn't be done here." };
  }
  try {
    return await decideQPlan(session, planId.data, request.data, randomUUID());
  } catch {
    return {
      outcome: "UNAVAILABLE",
      message: "That didn't go through. Try again in a moment.",
    };
  }
}
