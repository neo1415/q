"use server";

import { z } from "zod";

import {
  accrueAdminFees,
  ApiProblemError,
  assignAdminBillingPlan,
  setAdminBillingOverride,
  setAdminFeeRate,
  type ApiSession,
} from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import type { ConsoleResult } from "./console-actions";

/**
 * BILLING (ADR 0034): the console's plan, limit and fee-rate writes.
 * Server actions; the API decides every permission, wants a live step-up
 * for each write and records it with its reason.
 */

const Id = z.string().uuid();
const Reason = z.string().trim().min(3).max(500);
const Key = z
  .string()
  .regex(/^[a-z][a-z0-9_.]*$/)
  .max(64);

async function run(
  work: (session: ApiSession) => Promise<unknown>,
  done: string,
): Promise<ConsoleResult> {
  const session = await apiSession();
  if (session === null)
    return { ok: false, message: "Sign in again to continue." };
  try {
    await work(session);
    return { ok: true, message: done };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) {
      if (error.code === "STEP_UP_REQUIRED") {
        return {
          ok: false,
          stepUp: true,
          message: "Confirm it's you to continue.",
        };
      }
      if (error.status === 404) {
        return {
          ok: false,
          message: "That isn't available to your role, or it no longer exists.",
        };
      }
      if (error.status === 422 || error.status === 409) {
        return { ok: false, message: error.message };
      }
    }
    return {
      ok: false,
      message: "That didn't go through. Nothing changed. Try again.",
    };
  }
}

export async function assignPlanAction(input: {
  readonly organisationId: string;
  readonly planKey: string;
  readonly trialDays: number | null;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.organisationId);
  const key = Key.safeParse(input.planKey);
  const reason = Reason.safeParse(input.reason);
  const days = z
    .number()
    .int()
    .min(1)
    .max(365)
    .nullable()
    .safeParse(input.trialDays);
  if (!id.success || !key.success || !reason.success || !days.success) {
    return { ok: false, message: "Choose a plan and give a reason." };
  }
  const endsAt =
    days.data === null
      ? null
      : new Date(Date.now() + days.data * 86_400_000).toISOString();
  return run(
    (session) =>
      assignAdminBillingPlan(session, id.data, {
        planKey: key.data,
        endsAt,
        reason: reason.data,
      }),
    days.data === null
      ? "Plan changed."
      : `Trial started for ${String(days.data)} days.`,
  );
}

export async function overrideLimitAction(input: {
  readonly organisationId: string;
  readonly featureKey: string;
  readonly limit: number | null;
  readonly revoke: boolean;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.organisationId);
  const key = Key.safeParse(input.featureKey);
  const reason = Reason.safeParse(input.reason);
  const limit = z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .nullable()
    .safeParse(input.limit);
  if (!id.success || !key.success || !reason.success || !limit.success) {
    return { ok: false, message: "Give a limit and a reason." };
  }
  return run(
    (session) =>
      setAdminBillingOverride(session, id.data, {
        featureKey: key.data,
        limit: limit.data,
        expiresAt: null,
        revoke: input.revoke,
        reason: reason.data,
      }),
    input.revoke
      ? "Back to the plan's limit."
      : "Limit changed for this account.",
  );
}

export async function accrueFeesAction(): Promise<ConsoleResult> {
  return run(
    (session) => accrueAdminFees(session),
    "The ledger is up to date.",
  );
}

export async function setFeeRateAction(input: {
  readonly rateBps: number;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const rate = z.number().int().min(0).max(10_000).safeParse(input.rateBps);
  const reason = Reason.safeParse(input.reason);
  if (!rate.success || !reason.success) {
    return {
      ok: false,
      message: "Give a rate between 0 and 10,000 basis points, and a reason.",
    };
  }
  return run(
    (session) =>
      setAdminFeeRate(session, {
        rateBps: rate.data,
        accrueLevels: ["INVESTED"],
        payerSide: "COMPANY",
        reason: reason.data,
      }),
    "Rate set; the ledger is recomputed.",
  );
}
