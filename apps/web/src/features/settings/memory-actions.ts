"use server";

import { z } from "zod";

import {
  ApiProblemError,
  correctQMemory,
  forgetQMemory,
  getQPreferenceLearning,
  setQPreferenceLearning,
} from "@capital-q/api-client";
import {
  QMemoryCorrectionRequestSchema,
  type QPreferenceLearningDto,
} from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Forget one thing Q remembered about the person (ADR 0012). The id is
 * input; the Q API forgets only the caller's own memory.
 */
export async function forgetMemoryAction(
  memoryItemId: string,
): Promise<{ readonly ok: boolean }> {
  const id = z.string().uuid().safeParse(memoryItemId);
  if (!id.success) return { ok: false };
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) return { ok: false };
  try {
    await forgetQMemory({ baseUrl: qApiBaseUrl, accessToken }, id.data);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Replace one thing Q remembered with the person's own words. The Q API
 * puts it through the memory Write Gate; the old memory stays in history,
 * marked superseded. The message is safe to show.
 */
export async function correctMemoryAction(
  memoryItemId: string,
  content: string,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> {
  const id = z.string().uuid().safeParse(memoryItemId);
  const words = QMemoryCorrectionRequestSchema.safeParse({ content });
  if (!id.success || !words.success) {
    return {
      ok: false,
      message: "Say what Q should remember, in a few words.",
    };
  }
  const session = await qSession();
  if (session === null)
    return { ok: false, message: "Sign in again to continue." };
  try {
    await correctQMemory(session, id.data, words.data);
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.status === 422
          ? error.message
          : "That correction didn't save. Try again in a moment.",
    };
  }
}

async function qSession() {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  return qApiBaseUrl === undefined || accessToken === null
    ? null
    : { baseUrl: qApiBaseUrl, accessToken };
}

/** Whether Q may learn how they like to work (lane ob1). Null: unknown. */
export async function preferenceLearningAction(): Promise<QPreferenceLearningDto | null> {
  // Unknown stays unknown: a missing session, config or API answer hides
  // the prompt rather than failing the page.
  try {
    const session = await qSession();
    if (session === null) return null;
    return await getQPreferenceLearning(session);
  } catch {
    return null;
  }
}

const Choice = z.object({
  choice: z.enum(["ALLOW", "NOT_NOW", "TURN_OFF"]),
  via: z.enum(["PROMPT", "SETTINGS"]),
});

/** Their choice, for their current workspace only. Null when it did not save. */
export async function choosePreferenceLearningAction(
  raw: unknown,
): Promise<QPreferenceLearningDto | null> {
  const input = Choice.safeParse(raw);
  if (!input.success) return null;
  const session = await qSession();
  if (session === null) return null;
  return setQPreferenceLearning(session, input.data).catch(() => null);
}
