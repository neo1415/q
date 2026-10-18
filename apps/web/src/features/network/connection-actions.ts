"use server";

import { z } from "zod";

import {
  answerConnectionRequest,
  ApiProblemError,
  requestConnection,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type {
  ConnectionRequestAnswerDto,
  ConnectionRequestResultDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Founder Connection Requests, server side (ADR 0023).
 *
 * Server actions so the access token never reaches the browser, and
 * server-confirmed like Express Interest: "Request sent" is shown only from
 * the server's own answer. Whether this founder may reach this investor
 * (the investor's own inbound choice, and for QUALIFIED their declared
 * rules) is the API's decision, never the page's.
 */

export type ConnectionActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly message: string;
      /** A refusal will not change on retry; a failure might. */
      readonly retryable: boolean;
    };

const IdInput = z.string().uuid();
const DecisionInput = z.enum(["ACCEPTED", "DECLINED"]);
const IdempotencyKeyInput = z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/);

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

const SIGNED_OUT = {
  ok: false,
  message: "You are signed out. Sign in and try again.",
  retryable: false,
} as const;

const INVALID = {
  ok: false,
  message: "That didn't go through. Reload and try again.",
  retryable: false,
} as const;

function refusal(
  error: unknown,
  failed: string,
  forbidden: string,
  missing: string,
): { ok: false; message: string; retryable: boolean } {
  if (error instanceof ApiProblemError) {
    if (error.status === 401) return SIGNED_OUT;
    if (error.status === 403) {
      return { ok: false, message: forbidden, retryable: false };
    }
    if (error.status === 404) {
      return { ok: false, message: missing, retryable: false };
    }
    if (error.status === 409) {
      // The API's own sentence: the investor's choice, or an answer already
      // recorded. Neither says anything private.
      return {
        ok: false,
        message: error.problem?.detail ?? failed,
        retryable: false,
      };
    }
  }
  return { ok: false, message: failed, retryable: true };
}

/** A founder asks, for their company, to connect with an investor. */
export async function requestConnectionAction(input: {
  readonly investorOrganisationId: string;
  readonly idempotencyKey: string;
}): Promise<ConnectionActionResult<ConnectionRequestResultDto>> {
  const active = await session();
  if (active === null) return SIGNED_OUT;
  const investorId = IdInput.safeParse(input.investorOrganisationId);
  const key = IdempotencyKeyInput.safeParse(input.idempotencyKey);
  if (!investorId.success || !key.success) return INVALID;
  try {
    return {
      ok: true,
      value: await requestConnection(active, investorId.data, key.data),
    };
  } catch (error) {
    return refusal(
      error,
      "Your request was not sent. Try again.",
      "Only a member of a company on Capital Q can send a Connection Request.",
      "This investor isn't available to you any more.",
    );
  }
}

/** The investor's answer to a company request. */
export async function answerConnectionRequestAction(input: {
  readonly interestId: string;
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly idempotencyKey: string;
}): Promise<ConnectionActionResult<ConnectionRequestAnswerDto>> {
  const active = await session();
  if (active === null) return SIGNED_OUT;
  const interestId = IdInput.safeParse(input.interestId);
  const decision = DecisionInput.safeParse(input.decision);
  const key = IdempotencyKeyInput.safeParse(input.idempotencyKey);
  if (!interestId.success || !decision.success || !key.success) {
    return INVALID;
  }
  try {
    return {
      ok: true,
      value: await answerConnectionRequest(
        active,
        interestId.data,
        decision.data,
        key.data,
      ),
    };
  } catch (error) {
    return refusal(
      error,
      "Your answer was not recorded. Try again.",
      "Your role in this organisation doesn't include answering company requests.",
      "This request isn't available to answer any more.",
    );
  }
}
