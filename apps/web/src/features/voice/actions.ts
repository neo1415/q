"use server";

import { z } from "zod";

import {
  ApiProblemError,
  createQVoiceSession,
  getQVoiceTurnState,
  setQVoiceScreen,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  CreateQVoiceSessionRequestSchema,
  type CreateQVoiceSessionRequest,
  type CreateQVoiceSessionResponse,
  type QVoiceTurnState,
  QVoiceScreenUpdateSchema,
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
  | {
      readonly ok: false;
      readonly message: string;
      /**
       * The session this asked about no longer exists on the server. A
       * caller still holding a socket for it is talking to nobody, and
       * should come back on a fresh one rather than wait.
       */
      readonly gone?: true;
    };

const failure = (message: string): VoiceActionResult<never> => ({
  ok: false,
  message,
});

function translate(error: unknown): VoiceActionResult<never> {
  if (error instanceof ApiProblemError) {
    if (error.status === 401 || error.status === 403) {
      return failure("Your session ended. Sign in again to continue.");
    }
    if (error.status === 404) {
      return failure("Voice isn't available right now. You can keep typing.");
    }
    if (error.status === 429) {
      return failure(
        "You already have a few voice sessions open. End one and try again.",
      );
    }
    if (error.status >= 500) {
      return failure("I couldn't start voice right now. Try again.");
    }
    return failure(
      error.problem?.detail ??
        "I couldn't start voice. Try again, or keep typing.",
    );
  }
  return failure("I couldn't reach Q. Try again.");
}

const InputSchema = CreateQVoiceSessionRequestSchema;

/** CQ_VOICE_REALTIME on the web service; read on the server only. */
function duplexVoiceAllowed(): boolean {
  const flag = process.env.CQ_VOICE_REALTIME?.trim().toLowerCase();
  return flag === "on" || flag === "true" || flag === "1";
}

/** Ask the Q API for a voice session bound to the thread the person is in. */
export async function startVoiceSessionAction(
  rawInput: unknown,
): Promise<VoiceActionResult<CreateQVoiceSessionResponse>> {
  const parsed = InputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return failure("I couldn't start voice for this conversation.");
  }
  // DUPLEX: both services must have the flag on. Off here, the Q API is
  // asked for the standard line whatever it would offer.
  const input: CreateQVoiceSessionRequest = duplexVoiceAllowed()
    ? parsed.data
    : { ...parsed.data, duplex: false };
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure("Q isn't available right now. Try again later.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Your session ended. Sign in again to continue.");
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
/** The line's sealed session, as the create response gave it; opaque here. */
const SessionTokenSchema = z.string().min(1).max(8192).optional();

export async function readVoiceTurnAction(
  rawVoiceSessionId: unknown,
  rawSessionToken?: unknown,
): Promise<VoiceActionResult<QVoiceTurnState>> {
  const parsed = UuidSchema.safeParse(rawVoiceSessionId);
  const sessionToken = SessionTokenSchema.safeParse(rawSessionToken);
  if (!parsed.success) {
    return failure("That voice session ended. Start voice again.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Your session ended. Sign in again to continue.");
  }
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure("Q isn't available right now. Try again later.");
  }
  try {
    const value = await getQVoiceTurnState(
      { baseUrl: qApiBaseUrl, accessToken },
      parsed.data,
      sessionToken.success ? sessionToken.data : undefined,
    );
    return { ok: true, value };
  } catch (error) {
    // The one refusal that means something specific here: the server has
    // let this session go. Seen live as a screen that read "Thinking"
    // for good while the provider was refused three times a second.
    if (error instanceof ApiProblemError && error.status === 404) {
      return {
        ok: false,
        gone: true,
        message: "I lost the connection for a moment. Reconnecting.",
      };
    }
    return translate(error);
  }
}

/**
 * Where the person is now, while the line is open (R21), so a spoken turn
 * reaches Q with the screen exactly as a typed one does. Best effort: a
 * screen that fails to arrive only means Q knows the previous one.
 */
export async function sendVoiceScreenAction(
  rawVoiceSessionId: unknown,
  rawScreen: unknown,
  rawSessionToken?: unknown,
): Promise<VoiceActionResult<null>> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const sessionToken = SessionTokenSchema.safeParse(rawSessionToken);
  const screen = QVoiceScreenUpdateSchema.safeParse(rawScreen);
  if (!id.success || !screen.success) {
    return failure("That screen can't be shared with Q. Reload and try again.");
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Your session ended. Sign in again to continue.");
  }
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure("Q isn't available right now. Try again later.");
  }
  try {
    await setQVoiceScreen(
      { baseUrl: qApiBaseUrl, accessToken },
      id.data,
      screen.data,
      sessionToken.success ? sessionToken.data : undefined,
    );
    return { ok: true, value: null };
  } catch (error) {
    return translate(error);
  }
}
