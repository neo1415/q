"use server";

import { z } from "zod";

import {
  ApiProblemError,
  disconnectGoogle,
  getEmailDraft,
  getGoogleConnection,
  reviseEmailDraft,
  startGoogleConnect,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { EmailDraftDto, GoogleConnectionDto } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Gmail, server side (BIZ-007). Server actions so the session token never
 * reaches the browser; no Google token ever passes through here at all.
 * Connect returns Google's consent URL, and the browser goes there; the
 * callback lands on the API, which sends the browser back to Settings.
 */

export type IntegrationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const ApprovalId = z.string().uuid();
const Draft = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

async function session(which: "api" | "q"): Promise<ApiSession | null> {
  const config = loadWebServerConfig();
  const baseUrl = which === "api" ? config.apiBaseUrl : config.qApiBaseUrl;
  const accessToken = await getSessionAccessToken();
  return accessToken === null || baseUrl === undefined
    ? null
    : { baseUrl, accessToken };
}

async function run<T>(
  which: "api" | "q",
  work: (s: ApiSession) => Promise<T>,
): Promise<IntegrationResult<T>> {
  const s = await session(which);
  if (s === null)
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
  try {
    return { ok: true, value: await work(s) };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status < 500) {
      return {
        ok: false,
        message: error.problem?.detail ?? "That didn't work. Try again.",
      };
    }
    return {
      ok: false,
      message: "Gmail couldn't be reached. Try again.",
    };
  }
}

export async function readGmailConnection(): Promise<
  IntegrationResult<GoogleConnectionDto>
> {
  return run("api", (s) => getGoogleConnection(s));
}

export async function connectGmail(): Promise<IntegrationResult<string>> {
  return run(
    "api",
    async (s) => (await startGoogleConnect(s, "/settings")).authorizationUrl,
  );
}

export async function disconnectGmail(): Promise<IntegrationResult<null>> {
  return run("api", async (s) => {
    await disconnectGoogle(s);
    return null;
  });
}

export async function readEmailDraft(
  rawApprovalId: string,
): Promise<IntegrationResult<EmailDraftDto>> {
  const approvalId = ApprovalId.safeParse(rawApprovalId);
  if (!approvalId.success)
    return { ok: false, message: "That draft isn't available." };
  return run("q", (s) => getEmailDraft(s, approvalId.data));
}

/** The person's edit: the old approval is void; a new one waits for them. */
export async function reviseEmailDraftAction(
  rawApprovalId: string,
  input: { readonly subject: string; readonly body: string },
): Promise<IntegrationResult<null>> {
  const approvalId = ApprovalId.safeParse(rawApprovalId);
  const draft = Draft.safeParse(input);
  if (!approvalId.success || !draft.success) {
    return {
      ok: false,
      message: "The subject and the message both need some words.",
    };
  }
  return run("q", async (s) => {
    await reviseEmailDraft(s, approvalId.data, draft.data);
    return null;
  });
}
