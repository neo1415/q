"use server";

import {
  ApiProblemError,
  confirmAccountApplicationContact,
  confirmApplicationContact,
  getApplicationCoverage,
  getApplicationSession,
  getApplicationTranscript,
  saveApplicationContact,
} from "@capital-q/api-client";
import { ApplicationContactRequestSchema } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";
import { cookies } from "next/headers";
import { z } from "zod";

import { apiSession } from "@/features/q/context";

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };
const Token = z.string().min(16).max(128);

async function run<T>(
  token: string,
  action: (url: string, credential: string) => Promise<T>,
): Promise<Result<T>> {
  const parsed = Token.safeParse(token);
  const url = loadWebServerConfig().apiBaseUrl;
  if (!parsed.success || !url)
    return {
      ok: false,
      message: "Please reopen your application and try again.",
    };
  try {
    return { ok: true, value: await action(url, parsed.data) };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.status < 500
          ? (error.problem?.detail ?? "Please try again.")
          : "Couldn't reach Capital Q. Your application has not been submitted. Please try again.",
    };
  }
}

export async function contactApplicationAction(
  token: string,
  input: unknown,
  account: boolean,
) {
  const contact = ApplicationContactRequestSchema.safeParse(input);
  if (!contact.success)
    return {
      ok: false as const,
      message: "Check your name, company, role and email.",
    };
  return run(token, async (url, credential) => {
    if (account) {
      const session = await apiSession();
      if (session !== null)
        return confirmAccountApplicationContact(
          session,
          credential,
          contact.data,
        );
    }
    return saveApplicationContact(url, credential, contact.data);
  });
}

export async function confirmContactAction(token: string, code: string) {
  if (!/^[0-9]{6}$/.test(code))
    return {
      ok: false as const,
      message: "Enter the six-digit code from your email.",
    };
  return run(token, (url, credential) =>
    confirmApplicationContact(url, credential, code),
  );
}

export async function resumeInterviewAction(token: string) {
  return run(token, async (url, credential) => {
    const [application, transcript, coverage] = await Promise.all([
      getApplicationSession(url, credential),
      getApplicationTranscript(url, credential),
      getApplicationCoverage(url, credential),
    ]);
    return { application, transcript, coverage };
  });
}

/** The cookie is scoped by published gateway; API still authorises its exact application. */
export async function resumeGatewayApplicationAction(publicId: string) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(publicId))
    return { ok: false as const, message: "No saved application." };
  const token = (await cookies()).get(`cq-gateq-${publicId}`)?.value;
  if (!token) return { ok: false as const, message: "No saved application." };
  const result = await resumeInterviewAction(token);
  if (!result.ok) return result;
  return { ok: true as const, value: { ...result.value, sessionToken: token } };
}
