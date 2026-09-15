"use server";

import {
  ApiProblemError,
  createQVoiceSession,
  getQVoiceTurnState,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  CreateQVoiceSessionRequestSchema,
  type CreateQVoiceSessionRequest,
  type CreateQVoiceSessionResponse,
  type QVoiceTurnState,
  UuidSchema,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The one place the browser asks for a voice session (CQ-Q-VOICE-001 C
 * §31). The Q API issues the ephemeral, scoped provider credential and
 * binds it to the actor resolved from this session; the provider API key
 * never exists on this side. The session token is forwarded server to
 * server and never reaches the browser.
 *
 * Every failure is a plain sentence a person can act on.
 */

export type VoiceActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const failure = (message: string): VoiceActionResult<never> => ({
  ok: false,
  message,
});

function translate(error: unknown): VoiceActionResult<never> {
  if (error instanceof ApiProblemError) {
    if (error.status === 401 || error.status === 403) {
      return failure("Please sign in again to continue.");
    }
    if (error.status === 404) {
      return failure("Voice isn't available on this build yet.");
    }
    if (error.status === 429) {
      return failure(
        "You already have a few voice sessions open. End one and try again.",
      );
    }
    if (error.status >= 500) {
      return failure("I couldn't start voice right now. Please try again.");
    }
    return failure(error.problem?.detail ?? "I couldn't start voice.");
  }
  return failure("I couldn't reach Q. Please try again.");
}

const InputSchema = CreateQVoiceSessionRequestSchema;

/** Ask the Q API for a voice session bound to the thread the person is in. */
export async function startVoiceSessionAction(
  rawInput: unknown,
): Promise<VoiceActionResult<CreateQVoiceSessionResponse>> {
  const parsed = InputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return failure("I couldn't start voice for this conversation.");
  }
  const input: CreateQVoiceSessionRequest = parsed.data;
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure("Q isn't connected on this build yet.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Please sign in again to continue.");
  }
  try {
    const value = await createQVoiceSession(
      { baseUrl: qApiBaseUrl, accessToken },
      input,
    );
    return { ok: true, value };
  } catch (error) {
    return translate(error);
  }
}

/** What Q is asking after its latest spoken turn, for the stage; the owner's session only. */
export async function readVoiceTurnAction(
  rawVoiceSessionId: unknown,
): Promise<VoiceActionResult<QVoiceTurnState>> {
  const parsed = UuidSchema.safeParse(rawVoiceSessionId);
  if (!parsed.success) {
    return failure("That voice session isn't valid.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Please sign in again to continue.");
  }
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure("Q isn't connected on this build yet.");
  }
  try {
    const value = await getQVoiceTurnState(
      { baseUrl: qApiBaseUrl, accessToken },
      parsed.data,
    );
    return { ok: true, value };
  } catch (error: unknown) {
    return translate(error);
  }
}
