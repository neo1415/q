"use server";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ApiProblemError,
  decideAdminBreakGlass,
  decideAdminReview,
  getAdminKybDocument,
  decideAdminVerification,
  getAdminQErrors,
  grantAdminRole,
  postAdminStepUp,
  requestAdminBreakGlass,
  reviewAdminReport,
  revokeAdminRole,
  setAdminAccountSuspension,
  setAdminFlag,
  setAdminOrganisationSuspension,
  type ApiSession,
} from "@capital-q/api-client";
import type { AdminQErrorsDto } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { createServerSupabaseClient } from "@/auth/supabase-server";
import { apiSession } from "@/features/q/context";

/**
 * The operations console's writes (ADR 0033). Server actions, so the
 * session and the re-authentication never reach the browser; the API
 * decides every permission. A STEP_UP_REQUIRED answer comes back as
 * `stepUp: true` and the console asks for the password, then retries.
 */

export type ConsoleResult =
  | { readonly ok: true; readonly message?: string | undefined }
  | {
      readonly ok: false;
      readonly stepUp?: true | undefined;
      readonly message: string;
    };

const Id = z.string().uuid();
const Reason = z.string().trim().min(3).max(500);

async function run(
  work: (session: ApiSession) => Promise<unknown>,
  done: string,
): Promise<ConsoleResult> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
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
      if (
        error.status === 409 ||
        error.status === 403 ||
        error.status === 422
      ) {
        return { ok: false, message: error.message };
      }
    }
    return {
      ok: false,
      message: "That didn't go through. Nothing changed. Try again.",
    };
  }
}

/**
 * Step-up: the admin proves it's them again, on a throwaway client that
 * keeps no session -- with their password, or (for an admin who signs in by
 * email link) with a one-time code sent to their own email. The fresh token
 * goes to the API, which verifies it with the Auth server and records a
 * 15-minute step-up. The throwaway session is then signed out (it alone).
 */
async function ownEmail(): Promise<string | null> {
  const current = await createServerSupabaseClient();
  const { data } = await current.auth.getUser();
  return data.user?.email ?? null;
}

function throwawayClient() {
  const { auth } = loadWebServerConfig();
  return createClient(auth.supabase.url, auth.supabase.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Sends a one-time sign-in code to the admin's own email (never an address from the form). */
export async function sendStepUpCodeAction(): Promise<ConsoleResult> {
  const email = await ownEmail();
  if (email === null)
    return { ok: false, message: "Sign in again to continue." };
  const { error } = await throwawayClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  return error === null
    ? { ok: true, message: `Code sent to ${email}.` }
    : {
        ok: false,
        message: "The code couldn't be sent. Try again in a minute.",
      };
}

export async function stepUpAction(input: {
  readonly password?: string | undefined;
  readonly code?: string | undefined;
}): Promise<ConsoleResult> {
  const password = z.string().min(1).max(200).safeParse(input.password);
  const code = z
    .string()
    .trim()
    .regex(/^\d{6,10}$/)
    .safeParse(input.code);
  if (!password.success && !code.success) {
    return {
      ok: false,
      message: "Enter your password or the code we emailed you.",
    };
  }
  const session = await apiSession();
  if (session === null)
    return { ok: false, message: "Sign in again to continue." };
  const email = await ownEmail();
  if (email === null)
    return { ok: false, message: "Sign in again to continue." };
  const fresh = throwawayClient();
  const signedIn = password.success
    ? await fresh.auth.signInWithPassword({ email, password: password.data })
    : await fresh.auth.verifyOtp({
        email,
        token: code.success ? code.data : "",
        type: "email",
      });
  const token = signedIn.data.session?.access_token;
  if (signedIn.error !== null || token === undefined) {
    return {
      ok: false,
      message: password.success
        ? "That password didn't match. Try again."
        : "That code didn't match or has expired. Send a new one.",
    };
  }
  try {
    await postAdminStepUp(session, token);
    return { ok: true, message: "Confirmed for 15 minutes." };
  } catch {
    return { ok: false, message: "That couldn't be confirmed. Try again." };
  } finally {
    await fresh.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

export async function suspendAccountAction(input: {
  readonly userId: string;
  readonly suspend: boolean;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const userId = Id.safeParse(input.userId);
  const reason = Reason.safeParse(input.reason);
  if (!userId.success || !reason.success) {
    return { ok: false, message: "Give a reason of at least 3 characters." };
  }
  return run(
    (session) =>
      setAdminAccountSuspension(session, userId.data, {
        suspend: input.suspend,
        reason: reason.data,
      }),
    input.suspend ? "Account suspended." : "Suspension lifted.",
  );
}

export async function suspendOrganisationAction(input: {
  readonly organisationId: string;
  readonly suspend: boolean;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.organisationId);
  const reason = Reason.safeParse(input.reason);
  if (!id.success || !reason.success) {
    return { ok: false, message: "Give a reason of at least 3 characters." };
  }
  return run(
    (session) =>
      setAdminOrganisationSuspension(session, id.data, {
        suspend: input.suspend,
        reason: reason.data,
      }),
    input.suspend ? "Members suspended." : "Suspensions lifted.",
  );
}

export async function decideVerificationAction(input: {
  readonly claimId: string;
  readonly verified: boolean;
  readonly basis: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.claimId);
  const basis = z.string().trim().min(3).max(1000).safeParse(input.basis);
  if (!id.success || !basis.success) {
    return {
      ok: false,
      message: "Say what the decision rests on (at least 3 characters).",
    };
  }
  let decided = false;
  const result = await run(
    async (session) => {
      const outcome = await decideAdminVerification(session, id.data, {
        status: input.verified ? "VERIFIED" : "REVOKED",
        decisionBasis: basis.data,
        revocationReason: input.verified ? null : basis.data.slice(0, 500),
      });
      decided = outcome.decided;
    },
    input.verified ? "Verified." : "Declined.",
  );
  if (result.ok && !decided) {
    return { ok: false, message: "Someone already decided this request." };
  }
  return result;
}

export async function reviewReportAction(input: {
  readonly reportId: string;
  readonly outcome: "NO_ACTION" | "WARNED" | "ACCOUNT_SUSPENDED" | "ESCALATED";
  readonly note: string;
  readonly suspendUserId: string | null;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.reportId);
  const note = z.string().trim().min(3).max(1000).safeParse(input.note);
  if (!id.success || !note.success) {
    return { ok: false, message: "Add a note of at least 3 characters." };
  }
  return run(
    (session) =>
      reviewAdminReport(session, id.data, {
        outcome: input.outcome,
        note: note.data,
        suspendUserId: input.suspendUserId,
      }),
    "Review recorded.",
  );
}

export async function requestBreakGlassAction(input: {
  readonly targetType: "RELATIONSHIP_CHAT" | "Q_RUN";
  readonly targetId: string;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.targetId);
  const reason = z.string().trim().min(20).max(1000).safeParse(input.reason);
  if (!id.success || !reason.success) {
    return {
      ok: false,
      message: "State the reason in at least 20 characters.",
    };
  }
  return run(
    (session) =>
      requestAdminBreakGlass(session, {
        targetType: input.targetType,
        targetId: id.data,
        reason: reason.data,
      }),
    "Request sent for a second admin's approval.",
  );
}

export async function decideBreakGlassAction(input: {
  readonly requestId: string;
  readonly approve: boolean;
  readonly note: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.requestId);
  const note = Reason.safeParse(input.note);
  if (!id.success || !note.success) {
    return { ok: false, message: "Add a note of at least 3 characters." };
  }
  return run(
    (session) =>
      decideAdminBreakGlass(session, id.data, {
        approve: input.approve,
        note: note.data,
      }),
    input.approve ? "Approved for 30 minutes." : "Denied.",
  );
}

export async function setFlagAction(input: {
  readonly key: string;
  readonly enabled: boolean;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const reason = Reason.safeParse(input.reason);
  if (!reason.success)
    return { ok: false, message: "Give a reason of at least 3 characters." };
  return run(
    (session) =>
      setAdminFlag(session, input.key, {
        enabled: input.enabled,
        reason: reason.data,
      }),
    input.enabled ? "Turned on." : "Turned off.",
  );
}

export async function grantRoleAction(input: {
  readonly email: string;
  readonly role: string;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const email = z.email().safeParse(input.email.trim());
  const reason = Reason.safeParse(input.reason);
  if (!email.success)
    return { ok: false, message: "Enter the person's email." };
  if (!reason.success)
    return { ok: false, message: "Give a reason of at least 3 characters." };
  return run(
    (session) =>
      grantAdminRole(session, {
        email: email.data,
        role: input.role,
        reason: reason.data,
      }),
    "Role saved.",
  );
}

export async function revokeRoleAction(input: {
  readonly userId: string;
  readonly reason: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.userId);
  const reason = Reason.safeParse(input.reason);
  if (!id.success || !reason.success) {
    return { ok: false, message: "Give a reason of at least 3 characters." };
  }
  return run(
    (session) => revokeAdminRole(session, id.data, reason.data),
    "Role removed.",
  );
}

/** The live error stream, polled while the Q monitor is on screen. */
export async function qErrorsAction(): Promise<AdminQErrorsDto["rows"] | null> {
  const session = await apiSession();
  if (session === null) return null;
  return getAdminQErrors(session)
    .then((result) => result.rows)
    .catch(() => null);
}

// ADMIN-3 block --------------------------------------------------------------

export async function decideReviewAction(input: {
  readonly reviewId: string;
  readonly outcome: "UPHELD" | "CHANGED" | "NEEDS_EVIDENCE";
  readonly reason: string;
}): Promise<ConsoleResult> {
  const id = Id.safeParse(input.reviewId);
  const reason = z.string().trim().min(3).max(2000).safeParse(input.reason);
  if (!id.success || !reason.success) {
    return { ok: false, message: "Give a reason of at least 3 characters." };
  }
  return run(
    (session) =>
      decideAdminReview(session, id.data, {
        outcome: input.outcome,
        reason: reason.data,
      }),
    "Decided. They have been told.",
  );
}

/** A one-minute signed link to a KYB document, for the operator deciding it. */
export async function kybDocumentAction(
  submissionId: string,
): Promise<{ readonly url: string } | null> {
  const id = Id.safeParse(submissionId);
  const session = await apiSession();
  if (!id.success || session === null) return null;
  return getAdminKybDocument(session, id.data)
    .then((link) => ({ url: link.url }))
    .catch(() => null);
}
// end ADMIN-3 block
