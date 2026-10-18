"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ApiProblemError,
  openBillingPortal,
  startPlanCheckout,
} from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * BILLING (ADR 0034): hosted checkout and the billing portal. Server
 * actions, so the session never reaches the browser; the API decides who
 * may buy for the organisation and answers 503 while payment is off.
 */

export type BillingRedirectResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly message: string };

async function redirectOf(
  work: (
    session: NonNullable<Awaited<ReturnType<typeof apiSession>>>,
  ) => Promise<{ url: string }>,
): Promise<BillingRedirectResult> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    const { url } = await work(session);
    return { ok: true, url };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.problem?.detail !== undefined
          ? error.problem.detail
          : "That didn't go through. Try again in a moment.",
    };
  }
}

export async function checkoutAction(
  planKey: unknown,
): Promise<BillingRedirectResult> {
  const key = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(40)
    .safeParse(planKey);
  if (!key.success) return { ok: false, message: "Choose a plan." };
  return redirectOf((session) =>
    startPlanCheckout(session, key.data, `checkout-${randomUUID()}`),
  );
}

export async function portalAction(): Promise<BillingRedirectResult> {
  return redirectOf((session) => openBillingPortal(session));
}
