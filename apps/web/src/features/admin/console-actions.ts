"use server";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ApiProblemError,
  decideAdminBreakGlass,
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
 * Step-up: the admin's password, checked by signing in again on a
 * throwaway client that keeps no session; the fresh token goes to the API,
 * which verifies it with the Auth server and records a 15-minute step-up.
 * The throwaway session is then signed out (this session only).
 */
export async function stepUpAction(password: string): Promise<ConsoleResult> {
  const parsed = z.string().min(1).max(200).safeParse(password);
  if (!parsed.success) return { ok: false, message: "Enter your password." };
  const session = await apiSession();
  if (session === null)
    return { ok: false, message: "Sign in again to continue." };
  const current = await createServerSupabaseClient();
  const { data } = await current.auth.getUser();
  const email = data.user?.email;
  if (email === undefined) {
    return {
      ok: false,
      message:
        "This account has no password sign-in. Sign in with a password to use the console.",
    };
  }
  const { auth } = loadWebServerConfig();
  const fresh = createClient(auth.supabase.url, auth.supabase.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const signedIn = await fresh.auth.signInWithPassword({
    email,
    password: parsed.data,
  });
  const token = signedIn.data.session?.access_token;
  if (signedIn.error !== null || token === undefined) {
    return { ok: false, message: "That password didn't match. Try again." };
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
