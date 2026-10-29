"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { describeSecondStepFailure, GENERIC_FAILURE } from "./auth-errors";
import { forgetFactorLookup } from "./second-step";
import { getSessionUser } from "./session";
import { createServerSupabaseClient } from "./supabase-server";

/**
 * Settings → Security: turning two-step verification on and off.
 *
 * Supabase Auth holds the factor and its secret and checks every code;
 * Capital Q stores nothing. The secret is shown once, to the person whose
 * factor it is, so they can add it to their app, and is never logged.
 *
 * Turning it off asks for a code now, not merely an aal2 session: a
 * session left open on a borrowed laptop must not be enough to remove the
 * second step from the account.
 */

export type TwoStepSetupState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "enrolling";
      readonly factorId: string;
      /** An SVG data URI from the Auth server. */
      readonly qrCode: string;
      readonly secret: string;
    };

/** The code forms (confirm, turn off): nothing yet, or one sentence. */
export type TwoStepCodeState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string };

const CodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/));

const ENTER_CODE = "Enter the 6-digit code from your authenticator app.";
const FRIENDLY_NAME = "Authenticator app";

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

async function signedIn() {
  const user = await getSessionUser();
  if (user === null) {
    redirect("/auth/sign-in?next=%2Fsettings%2Fsecurity");
  }
  return { user, supabase: await createServerSupabaseClient() };
}

/** Step one: a new authenticator factor, and its QR code and secret. */
export async function startTwoStepAction(): Promise<TwoStepSetupState> {
  const { supabase } = await signedIn();
  const { data: factors, error: listError } =
    await supabase.auth.mfa.listFactors();
  if (listError !== null) {
    return { status: "error", message: GENERIC_FAILURE };
  }
  if (factors.totp.length > 0) {
    redirect("/settings/security");
  }
  // A setup abandoned before its code was entered leaves an unverified
  // factor behind; the Auth server refuses a second with the same name.
  for (const stale of factors.all) {
    if (stale.factor_type === "totp" && stale.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: FRIENDLY_NAME,
    issuer: "Capital Q",
  });
  if (error !== null) {
    return { status: "error", message: GENERIC_FAILURE };
  }
  return {
    status: "enrolling",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Step two: the first code proves the app holds the secret. */
export async function confirmTwoStepAction(
  _previous: TwoStepCodeState,
  formData: FormData,
): Promise<TwoStepCodeState> {
  const { user, supabase } = await signedIn();
  const code = CodeSchema.safeParse(field(formData, "code"));
  if (!code.success) {
    return { status: "error", message: ENTER_CODE };
  }
  // The factor id came back from the form, so it is input: the Auth server
  // verifies the factor belongs to this session's user before any code is
  // checked against it.
  const factorId = z.string().uuid().safeParse(field(formData, "factorId"));
  if (!factorId.success) {
    return { status: "error", message: GENERIC_FAILURE };
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factorId.data,
    code: code.data,
  });
  if (error !== null) {
    return { status: "error", message: describeSecondStepFailure(error) };
  }
  forgetFactorLookup(user.authUserId);
  redirect("/settings/security?two-step=on");
}

/** Turning it off: a fresh code, then the factor is removed. */
export async function turnOffTwoStepAction(
  _previous: TwoStepCodeState,
  formData: FormData,
): Promise<TwoStepCodeState> {
  const { user, supabase } = await signedIn();
  const code = CodeSchema.safeParse(field(formData, "code"));
  if (!code.success) {
    return { status: "error", message: ENTER_CODE };
  }
  const { data: factors, error: listError } =
    await supabase.auth.mfa.listFactors();
  if (listError !== null) {
    return { status: "error", message: GENERIC_FAILURE };
  }
  const factor = factors.totp[0];
  if (factor === undefined) {
    redirect("/settings/security");
  }
  const verified = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code.data,
  });
  if (verified.error !== null) {
    return {
      status: "error",
      message: describeSecondStepFailure(verified.error),
    };
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (error !== null) {
    return { status: "error", message: GENERIC_FAILURE };
  }
  forgetFactorLookup(user.authUserId);
  redirect("/settings/security?two-step=off");
}
