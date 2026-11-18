"use server";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ApiProblemError,
  cancelAccountDeletion,
  createDataExportLink,
  requestAccountDeletion,
  requestDataExport,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { createServerSupabaseClient } from "@/auth/supabase-server";
import { apiSession } from "@/features/q/context";

/**
 * "Your data" (decision 107). Server actions, so the session and the
 * re-authentication never reach the browser; the API decides everything
 * and acts only on the signed-in person.
 */

export type DataRightsResult =
  | { readonly ok: true; readonly url?: string | undefined }
  | { readonly ok: false; readonly message: string };

const SIGN_IN_AGAIN = {
  ok: false,
  message: "Sign in again to continue.",
} as const;

function problemMessage(error: unknown, fallback: string): string {
  return error instanceof ApiProblemError &&
    error.status >= 400 &&
    error.status < 500
    ? error.message
    : fallback;
}

export async function requestDataExportAction(): Promise<DataRightsResult> {
  const session = await apiSession();
  if (session === null) return SIGN_IN_AGAIN;
  try {
    await requestDataExport(session, `web:${randomUUID()}`);
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemMessage(
        error,
        "Your download couldn't be started. Try again in a moment.",
      ),
    };
  }
}

export async function downloadLinkAction(
  exportId: string,
): Promise<DataRightsResult> {
  const id = z.string().uuid().safeParse(exportId);
  if (!id.success) return { ok: false, message: "That download has expired." };
  const session = await apiSession();
  if (session === null) return SIGN_IN_AGAIN;
  try {
    const link = await createDataExportLink(session, id.data);
    return { ok: true, url: link.url };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemMessage(error, "The link couldn't be made. Try again."),
    };
  }
}

async function ownEmail(): Promise<string | null> {
  const current = await createServerSupabaseClient();
  const { data } = await current.auth.getUser();
  return data.user?.email ?? null;
}

/** A client that signs in once, keeps nothing and is signed out after. */
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

/** Emails a one-time code to the person's own address (never one from the form). */
export async function sendDeletionCodeAction(): Promise<DataRightsResult> {
  const email = await ownEmail();
  if (email === null) return SIGN_IN_AGAIN;
  const { error } = await throwawayClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  return error === null
    ? { ok: true }
    : {
        ok: false,
        message: "The code couldn't be sent. Try again in a minute.",
      };
}

/**
 * Confirms it is them (password or emailed code) and schedules the
 * deletion with the words they typed and the organisations they saw.
 */
export async function scheduleDeletionAction(input: {
  readonly password?: string | undefined;
  readonly code?: string | undefined;
  readonly confirmation: string;
  readonly organisationsToClose: readonly string[];
}): Promise<DataRightsResult> {
  const password = z.string().min(1).max(200).safeParse(input.password);
  const code = z
    .string()
    .trim()
    .regex(/^\d{6,10}$/u)
    .safeParse(input.code);
  const organisations = z
    .array(z.string().uuid())
    .max(200)
    .safeParse(input.organisationsToClose);
  if ((!password.success && !code.success) || !organisations.success) {
    return {
      ok: false,
      message: "Enter your password or the code we emailed you.",
    };
  }
  const session = await apiSession();
  const email = await ownEmail();
  if (session === null || email === null) return SIGN_IN_AGAIN;
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
    await requestAccountDeletion(session, {
      accessToken: token,
      confirmation: input.confirmation.slice(0, 60),
      organisationsToClose: organisations.data,
    });
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemMessage(error, "That couldn't be scheduled. Try again."),
    };
  } finally {
    await fresh.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

export async function cancelDeletionAction(): Promise<DataRightsResult> {
  const session = await apiSession();
  if (session === null) return SIGN_IN_AGAIN;
  try {
    await cancelAccountDeletion(session);
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemMessage(error, "That couldn't be cancelled. Try again."),
    };
  }
}
