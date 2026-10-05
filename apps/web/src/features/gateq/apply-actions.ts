"use server";

import { headers } from "next/headers";
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
 * Starts per visitor, on this instance (P7). The API caps starts per
 * gateway; this keeps one visitor on someone's website from spending that
 * ceiling for everyone. The address comes from the platform's own
 * forwarding header (Vercel sets it; a client cannot), and is only ever a
 * map key in memory: never logged, stored or sent on.
 */
const VISITOR_STARTS = new Map<string, { count: number; resetAt: number }>();
const VISITOR_START_LIMIT = 8;
const VISITOR_WINDOW_MS = 10 * 60_000;

async function visitorMayStart(): Promise<boolean> {
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const visitor = forwarded.split(",")[0]?.trim() ?? "";
  if (visitor === "") return true;
  const now = Date.now();
  if (VISITOR_STARTS.size > 10_000) {
    for (const [key, bucket] of VISITOR_STARTS) {
      if (bucket.resetAt <= now) VISITOR_STARTS.delete(key);
    }
  }
  const bucket = VISITOR_STARTS.get(visitor);
  if (bucket === undefined || bucket.resetAt <= now) {
    VISITOR_STARTS.set(visitor, { count: 1, resetAt: now + VISITOR_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= VISITOR_START_LIMIT;
}

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
  | {
      readonly ok: false;
      readonly message: string;
      /** A spent allowance: wait, nothing is lost (P7 rate-limited state). */
      readonly rateLimited?: boolean;
    };

const PublicId = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);
const Token = z.string().min(16).max(128);
const Key = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);

const RATE_LIMITED = {
  ok: false,
  rateLimited: true,
  message: "That's a lot in a short time. Give it a few minutes, then carry on.",
} as const;

function failure(error: unknown): ApplyResult {
  if (error instanceof ApiProblemError && error.status === 429) {
    return RATE_LIMITED;
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
  if (!(await visitorMayStart())) return RATE_LIMITED;
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
