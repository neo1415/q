import { NextResponse, type NextRequest } from "next/server";

import { loadWebServerConfig } from "@capital-q/config/web";

import { resolveSafeReturnPath } from "@/auth/redirect-safety";
import { createServerSupabaseClient } from "@/auth/supabase-server";

/**
 * Where emailed links land: sign-up confirmation, sign-in link, password
 * recovery. The one-time code (or token hash) is exchanged for a session on
 * the server; the session cookies are set on this response; the browser is
 * sent on to a safe same-origin path.
 *
 * The PKCE code is bound to the verifier cookie this browser received when
 * the flow started, so a link opened elsewhere -- or by someone who merely
 * intercepted it -- cannot complete the exchange.
 *
 * Failure of any kind ends at sign-in with a generic notice. The response is
 * never cacheable and the redirect target is built from the configured
 * origin, not the request's Host header.
 */

const EMAIL_OTP_TYPES = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const);

type EmailOtpType = typeof EMAIL_OTP_TYPES extends Set<infer T> ? T : never;

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as Set<string>).has(value);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { auth } = loadWebServerConfig();
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const otpType = params.get("type");
  const isRecovery =
    params.get("flow") === "recovery" || otpType === "recovery";
  const next = resolveSafeReturnPath(params.get("next"));

  const supabase = await createServerSupabaseClient();

  let established = false;

  if (code !== null && code.length > 0 && code.length <= 512) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    established = error === null;
  } else if (
    tokenHash !== null &&
    tokenHash.length > 0 &&
    tokenHash.length <= 512 &&
    isEmailOtpType(otpType)
  ) {
    const { error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash,
    });
    established = error === null;
  }

  const destination = established
    ? isRecovery
      ? "/auth/update-password"
      : next
    : "/auth/sign-in?notice=link-invalid";

  const response = NextResponse.redirect(new URL(destination, auth.appOrigin));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
