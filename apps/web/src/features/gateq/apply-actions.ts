"use server";

import { z } from "zod";

import {
  ApiProblemError,
  applicationTurn,
  startApplication,
  submitApplication,
} from "@capital-q/api-client";
import type { ApplicationSummaryDto } from "@capital-q/contracts";
import { GATEQ_TURN_MAX_CHARS } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

/**
 * A founder applying through a gateway (CQ-GATE-002), often inside an
 * investor's own website. Anonymous: the only credential is the
 * application's own session token, which the API issued and which the
 * browser holds for this application alone.
 */
export type ApplyResult =
  | {
      readonly ok: true;
      readonly sessionToken: string;
      readonly reply: string | null;
      readonly application: ApplicationSummaryDto;
    }
  | { readonly ok: false; readonly message: string };

const PublicId = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);
const Token = z.string().min(16).max(128);
const Key = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof ApiProblemError && error.status === 429) {
    return {
      ok: false,
      message: "Too many messages. Try again in a few minutes.",
    };
  }
  return {
    ok: false,
    message:
      error instanceof ApiProblemError &&
      error.status < 500 &&
      error.problem?.detail !== undefined
        ? error.problem.detail
        : "Couldn't reach Capital Q just now. Please try again.",
  };
}

function base(): string | null {
  return loadWebServerConfig().apiBaseUrl ?? null;
}

export async function startApplicationAction(
  publicId: string,
): Promise<ApplyResult> {
  const id = PublicId.safeParse(publicId);
  const url = base();
  if (!id.success || url === null) return { ok: false, message: "Not found." };
  try {
    const started = await startApplication(url, id.data);
    return {
      ok: true,
      sessionToken: started.sessionToken,
      reply: started.reply,
      application: started.application,
    };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function applicationTurnAction(
  sessionToken: string,
  message: string,
  clientTurnId: string,
): Promise<ApplyResult> {
  const token = Token.safeParse(sessionToken);
  const key = Key.safeParse(clientTurnId);
  const text = message.trim().slice(0, GATEQ_TURN_MAX_CHARS);
  const url = base();
  if (!token.success || !key.success || text === "" || url === null) {
    return { ok: false, message: "Please try again." };
  }
  try {
    const turned = await applicationTurn(url, token.data, {
      message: text,
      clientTurnId: key.data,
    });
    return {
      ok: true,
      sessionToken: token.data,
      reply: turned.reply,
      application: turned.application,
    };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function submitApplicationAction(
  sessionToken: string,
  clientRequestId: string,
): Promise<ApplyResult> {
  const token = Token.safeParse(sessionToken);
  const key = Key.safeParse(clientRequestId);
  const url = base();
  if (!token.success || !key.success || url === null) {
    return { ok: false, message: "Please try again." };
  }
  try {
    const submitted = await submitApplication(url, token.data, key.data);
    return {
      ok: true,
      sessionToken: token.data,
      reply: null,
      application: submitted.application,
    };
  } catch (error: unknown) {
    return failure(error);
  }
}
