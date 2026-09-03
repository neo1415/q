"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { loadWebServerConfig } from "@capital-q/config/web";

import {
  describeAuthFailure,
  describeSignUpFailure,
  GENERIC_FAILURE,
  GENERIC_SIGN_IN_FAILURE,
} from "./auth-errors";
import type { AuthFormState } from "./form-state";
import { DEFAULT_RETURN_PATH, resolveSafeReturnPath } from "./redirect-safety";
import { getSessionUser } from "./session";
import { createServerSupabaseClient } from "./supabase-server";

/**
 * Authentication server actions. Every credential is handled here, on the
 * server, by Supabase Auth: nothing is hashed, stored, logged or forwarded by
 * Capital Q. Success is always a redirect; failure is one safe sentence.
 *
 * Next.js checks the Origin of every server action invocation against the
 * host, and the session cookie is SameSite=Lax, so a cross-site form cannot
 * drive these actions with a victim's session. That is transport safety only;
 * it grants no authority and replaces no authorization check.
 */

const EmailSchema = z.string().trim().min(3).max(254).email();
const PasswordSchema = z.string().min(8).max(72);
const SignInPasswordSchema = z.string().min(1).max(72);

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Emailed links come back through the callback, then on to a safe path. */
function callbackUrl(
  appOrigin: string,
  next: string,
  flow?: "recovery",
): string {
  const url = new URL("/auth/callback", appOrigin);
  if (next !== DEFAULT_RETURN_PATH) {
    url.searchParams.set("next", next);
  }
  if (flow !== undefined) {
    url.searchParams.set("flow", flow);
  }
  return url.toString();
}

export async function signInWithPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const next = resolveSafeReturnPath(field(formData, "next"));
  const input = z
    .object({ email: EmailSchema, password: SignInPasswordSchema })
    .safeParse({
      email: field(formData, "email"),
      password: field(formData, "password"),
    });

  if (!input.success) {
    return { status: "error", message: "Enter your email and password." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(input.data);

  if (error !== null) {
    return {
      status: "error",
      message: describeAuthFailure(error, GENERIC_SIGN_IN_FAILURE),
    };
  }

  redirect(next);
}

export async function signUpWithPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const next = resolveSafeReturnPath(field(formData, "next"));
  const input = z
    .object({ email: EmailSchema, password: PasswordSchema })
    .safeParse({
      email: field(formData, "email"),
      password: field(formData, "password"),
    });

  if (!input.success) {
    return {
      status: "error",
      message: "Enter a valid email and a password of at least 8 characters.",
    };
  }

  const { auth } = loadWebServerConfig();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.data.email,
    password: input.data.password,
    options: { emailRedirectTo: callbackUrl(auth.appOrigin, next) },
  });

  if (error !== null) {
    return { status: "error", message: describeSignUpFailure(error) };
  }

  // A session means the provider does not require email confirmation; the
  // account exists and the Person record was created by the database trigger.
  // Without one the provider has sent a confirmation email, and the callback
  // establishes the session when the link is opened.
  if (data.session !== null) {
    redirect(next);
  }

  redirect("/auth/check-email?purpose=confirm");
}

export async function sendSignInLinkAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const next = resolveSafeReturnPath(field(formData, "next"));
  const email = EmailSchema.safeParse(field(formData, "email"));

  if (!email.success) {
    return { status: "error", message: "Enter your email." };
  }

  const { auth } = loadWebServerConfig();
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: callbackUrl(auth.appOrigin, next),
      // The verified-email path doubles as low-friction account creation
      // (product: upload first, verify later). It still creates only the
      // auth identity and its Person record -- never an organisation.
      shouldCreateUser: true,
    },
  });

  if (error !== null) {
    return {
      status: "error",
      message: describeAuthFailure(error, GENERIC_FAILURE),
    };
  }

  redirect("/auth/check-email?purpose=link");
}

export async function requestPasswordResetAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = EmailSchema.safeParse(field(formData, "email"));

  if (!email.success) {
    return { status: "error", message: "Enter your email." };
  }

  const { auth } = loadWebServerConfig();
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: callbackUrl(auth.appOrigin, DEFAULT_RETURN_PATH, "recovery"),
  });

  // Only a rate limit is worth reporting. Any other outcome -- including an
  // unknown address -- looks exactly like success, so the form cannot be used
  // to discover which emails hold accounts.
  if (error !== null) {
    const message = describeAuthFailure(error, GENERIC_FAILURE);
    if (message !== GENERIC_FAILURE) {
      return { status: "error", message };
    }
  }

  redirect("/auth/check-email?purpose=recovery");
}

export async function updatePasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getSessionUser();

  if (user === null) {
    redirect("/auth/sign-in?notice=link-invalid");
  }

  const password = PasswordSchema.safeParse(field(formData, "password"));

  if (!password.success) {
    return {
      status: "error",
      message: "Use a password of at least 8 characters.",
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({
    password: password.data,
  });

  if (error !== null) {
    return {
      status: "error",
      message: describeAuthFailure(error, GENERIC_FAILURE),
    };
  }

  redirect(DEFAULT_RETURN_PATH);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  // Revokes this session's refresh token at the provider and clears the
  // cookies through the same adapter that set them. Other devices keep
  // their own sessions; ending those is a security-settings feature, not
  // a sign-out button.
  await supabase.auth.signOut({ scope: "local" });

  redirect("/auth/sign-in?notice=signed-out");
}
