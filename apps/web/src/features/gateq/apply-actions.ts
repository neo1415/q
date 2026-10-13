"use server";

import { headers } from "next/headers";
import { z } from "zod";

import {
  ApiProblemError,
  applicationTurn,
  confirmApplicationContact,
  getApplicationCoverage,
  getApplicationTranscript,
  saveApplicationAnswers,
  saveApplicationContact,
  startApplication,
  submitApplication,
} from "@capital-q/api-client";
import type {
  ApplicationContactDto,
  ApplicationCoverageDto,
  ApplicationSummaryDto,
  ApplicationTranscriptTurnDto,
} from "@capital-q/contracts";
import {
  ApplicationAnswersRequestSchema,
  ApplicationContactRequestSchema,
  GATEQ_TURN_MAX_CHARS,
} from "@capital-q/contracts";
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
      /**
       * Slice 1: Submit refused with 409 because the contact email is not
       * confirmed yet. The founder fixes it on the contact step.
       */
      readonly contactNotConfirmed?: boolean;
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
  message:
    "That's a lot in a short time. Give it a few minutes, then carry on.",
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
    // The submit route's only 409 is CONTACT_NOT_CONFIRMED (every other
    // refusal is a 404 that says nothing).
    if (error instanceof ApiProblemError && error.status === 409) {
      return {
        ok: false,
        contactNotConfirmed: true,
        message: "Confirm your contact email before submitting.",
      };
    }
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// F1: the GateQ form. The same anonymous, credential-scoped surface; no model.
// ---------------------------------------------------------------------------

export type FormResult =
  | {
      readonly ok: true;
      readonly sessionToken: string;
      readonly application: ApplicationSummaryDto;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly rateLimited?: boolean;
    };

function formFailure(error: unknown): FormResult {
  const failed = failure(error);
  return failed.ok
    ? { ok: false, message: "Please try again." }
    : {
        ok: false,
        message: failed.message,
        ...(failed.rateLimited === true ? { rateLimited: true } : {}),
      };
}

export async function startFormAction(publicId: string): Promise<FormResult> {
  const id = PublicId.safeParse(publicId);
  const url = base();
  if (!id.success || url === null) return { ok: false, message: "Not found." };
  if (!(await visitorMayStart())) return RATE_LIMITED;
  try {
    const started = await startApplication(url, id.data, "form");
    return {
      ok: true,
      sessionToken: started.sessionToken,
      application: started.application,
    };
  } catch (error: unknown) {
    return formFailure(error);
  }
}

export async function saveAnswersAction(
  sessionToken: string,
  answers: unknown,
): Promise<FormResult> {
  const token = Token.safeParse(sessionToken);
  // Validated here too: the API is the authority, but a malformed answer
  // should never leave the web tier.
  const parsed = ApplicationAnswersRequestSchema.safeParse(answers);
  const url = base();
  if (!token.success || !parsed.success || url === null) {
    return { ok: false, message: "Please check your answers and try again." };
  }
  try {
    const saved = await saveApplicationAnswers(url, token.data, parsed.data);
    return {
      ok: true,
      sessionToken: token.data,
      application: saved.application,
    };
  } catch (error: unknown) {
    return formFailure(error);
  }
}

// ---------------------------------------------------------------------------
// GateQ slice 1: contact first, the durable interview and the review.
// Still anonymous and credential-scoped: the session token names exactly one
// application, and the API derives everything else.
// ---------------------------------------------------------------------------

type Failed = {
  readonly ok: false;
  readonly message: string;
  readonly rateLimited?: boolean;
};

function failed(error: unknown): Failed {
  const result = failure(error);
  return result.ok
    ? { ok: false, message: "Please try again." }
    : {
        ok: false,
        message: result.message,
        ...(result.rateLimited === true ? { rateLimited: true } : {}),
      };
}

export type ContactResult =
  | {
      readonly ok: true;
      readonly contact: ApplicationContactDto;
      readonly codeSent: boolean;
      readonly codeExpiresInMinutes: number | null;
    }
  | Failed;

/** A guest's contact: saved, and a six-digit code sent to the email. */
export async function saveContactAction(
  sessionToken: string,
  contact: unknown,
): Promise<ContactResult> {
  const token = Token.safeParse(sessionToken);
  const parsed = ApplicationContactRequestSchema.safeParse(contact);
  const url = base();
  if (!token.success || !parsed.success || url === null) {
    return { ok: false, message: "Please check your details and try again." };
  }
  try {
    const saved = await saveApplicationContact(url, token.data, parsed.data);
    return {
      ok: true,
      contact: saved.contact,
      codeSent: saved.codeSent,
      codeExpiresInMinutes: saved.codeExpiresInMinutes,
    };
  } catch (error: unknown) {
    return failed(error);
  }
}

export type ConfirmResult =
  | {
      readonly ok: true;
      readonly status: "CONFIRMED" | "WRONG_CODE" | "EXPIRED" | "NOT_FOUND";
      readonly contact: ApplicationContactDto | null;
    }
  | Failed;

const Code = z.string().regex(/^[0-9]{6}$/);

export async function confirmContactAction(
  sessionToken: string,
  code: string,
): Promise<ConfirmResult> {
  const token = Token.safeParse(sessionToken);
  const digits = Code.safeParse(code.replace(/\s/g, ""));
  const url = base();
  if (!token.success || url === null) {
    return { ok: false, message: "Please try again." };
  }
  if (!digits.success) {
    return { ok: false, message: "The code is six digits." };
  }
  try {
    const confirmed = await confirmApplicationContact(
      url,
      token.data,
      digits.data,
    );
    return { ok: true, status: confirmed.status, contact: confirmed.contact };
  } catch (error: unknown) {
    return failed(error);
  }
}

export type TranscriptResult =
  | {
      readonly ok: true;
      readonly turns: readonly ApplicationTranscriptTurnDto[];
    }
  | Failed;

/** The interview so far, as the server recorded it: what a resume shows. */
export async function transcriptAction(
  sessionToken: string,
): Promise<TranscriptResult> {
  const token = Token.safeParse(sessionToken);
  const url = base();
  if (!token.success || url === null) {
    return { ok: false, message: "Please try again." };
  }
  try {
    const transcript = await getApplicationTranscript(url, token.data);
    return { ok: true, turns: transcript.turns };
  } catch (error: unknown) {
    return failed(error);
  }
}

export type CoverageResult =
  { readonly ok: true; readonly coverage: ApplicationCoverageDto } | Failed;

/** The deterministic completeness check the review screen shows. */
export async function coverageAction(
  sessionToken: string,
): Promise<CoverageResult> {
  const token = Token.safeParse(sessionToken);
  const url = base();
  if (!token.success || url === null) {
    return { ok: false, message: "Please try again." };
  }
  try {
    const coverage = await getApplicationCoverage(url, token.data);
    return { ok: true, coverage };
  } catch (error: unknown) {
    return failed(error);
  }
}
