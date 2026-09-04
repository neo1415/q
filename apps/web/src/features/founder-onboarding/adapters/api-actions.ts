"use server";

import { z } from "zod";

import {
  ApiProblemError,
  completeOnboardingSession,
  findTaxonomyCandidates,
  getCurrentOnboardingSession,
  getOnboardingSession,
  getTaxonomyNode,
  goBackInOnboarding,
  skipOnboardingStep,
  startOnboardingSession,
  submitOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  OnboardingResponseValueSchema,
  OnboardingStepKeySchema,
  TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH,
  type OnboardingSessionView,
} from "@capital-q/contracts";
import { CATEGORY_VOCABULARIES } from "@capital-q/founder-onboarding/definition";

import { getSessionAccessToken } from "@/auth/session";

import type { TaxonomyCandidateView } from "../models/presentation";
import type { ClientFailureKind } from "./client";

/**
 * Founder onboarding server actions: the only place the browser's journey
 * reaches the Capital Q API. Each action forwards the HttpOnly session's
 * access token server-to-server, validates its own arguments (a client is
 * input, never authority), and returns a plain result the browser can
 * reason about -- never a raw problem document, never the token.
 *
 * Nothing here decides journey logic: it is transport for the runtime
 * contract, one call per action.
 */

export type ActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: ClientFailureKind;
      readonly message: string;
    };

const Uuid = z.string().uuid();
const Version = z.number().int().min(1);

const failure = (
  kind: ClientFailureKind,
  message: string,
): ActionResult<never> => ({ ok: false, kind, message });

async function apiSession(): Promise<ApiSession | ActionResult<never>> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) {
    return failure(
      "UNAVAILABLE",
      "Founder setup isn't available on this build yet.",
    );
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("UNAVAILABLE", "Please sign in again to continue.");
  }
  return { baseUrl: apiBaseUrl, accessToken };
}

function isSession(
  value: ApiSession | ActionResult<never>,
): value is ApiSession {
  return "baseUrl" in value;
}

/** Problem details → a frontend outcome. Server-authored detail only. */
function translate(error: unknown): ActionResult<never> {
  if (error instanceof ApiProblemError) {
    const detail = error.problem?.detail ?? error.message;
    if (error.code === "VERSION_CONFLICT") {
      return failure(
        "CONFLICT",
        "This step changed in another tab. Showing the latest.",
      );
    }
    if (error.status === 401) {
      return failure("UNAVAILABLE", "Please sign in again to continue.");
    }
    if (error.status >= 500) {
      return failure(
        "NETWORK",
        "Capital Q couldn't save that. Please try again.",
      );
    }
    return failure("REJECTED", detail);
  }
  return failure("NETWORK", "Couldn't reach Capital Q. Please try again.");
}

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
): Promise<ActionResult<T>> {
  const session = await apiSession();
  if (!isSession(session)) {
    return session;
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error) {
    return translate(error);
  }
}

export async function founderCurrentAction(): Promise<
  ActionResult<OnboardingSessionView | null>
> {
  return run(async (session) => {
    try {
      return await getCurrentOnboardingSession(session, "founder");
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 404) {
        return null;
      }
      throw error;
    }
  });
}

export async function founderStartAction(
  rawIdempotencyKey: string,
): Promise<ActionResult<OnboardingSessionView>> {
  const idempotencyKey = Uuid.parse(rawIdempotencyKey);
  return run((session) =>
    startOnboardingSession(session, { journeyType: "founder" }, idempotencyKey),
  );
}

export async function founderGetAction(
  rawSessionId: string,
): Promise<ActionResult<OnboardingSessionView>> {
  const sessionId = Uuid.parse(rawSessionId);
  return run((session) => getOnboardingSession(session, sessionId));
}

const SubmitInput = z.object({
  sessionId: Uuid,
  stepKey: OnboardingStepKeySchema,
  value: OnboardingResponseValueSchema,
  expectedSessionVersion: Version,
  idempotencyKey: Uuid,
});

export async function founderSubmitAction(
  raw: unknown,
): Promise<ActionResult<OnboardingSessionView>> {
  const input = SubmitInput.parse(raw);
  return run((session) =>
    submitOnboardingResponse(
      session,
      input.sessionId,
      {
        stepKey: input.stepKey,
        response: { value: input.value },
        expectedSessionVersion: input.expectedSessionVersion,
      },
      input.idempotencyKey,
    ),
  );
}

const SkipInput = z.object({
  sessionId: Uuid,
  stepKey: OnboardingStepKeySchema,
  expectedSessionVersion: Version,
  idempotencyKey: Uuid,
});

export async function founderSkipAction(
  raw: unknown,
): Promise<ActionResult<OnboardingSessionView>> {
  const input = SkipInput.parse(raw);
  return run((session) =>
    skipOnboardingStep(
      session,
      input.sessionId,
      input.stepKey,
      { expectedSessionVersion: input.expectedSessionVersion },
      input.idempotencyKey,
    ),
  );
}

const NavigateInput = z.object({
  sessionId: Uuid,
  expectedSessionVersion: Version,
  targetStepKey: OnboardingStepKeySchema.optional(),
});

export async function founderNavigateAction(
  raw: unknown,
): Promise<ActionResult<OnboardingSessionView>> {
  const input = NavigateInput.parse(raw);
  return run((session) =>
    goBackInOnboarding(session, input.sessionId, {
      expectedSessionVersion: input.expectedSessionVersion,
      ...(input.targetStepKey === undefined
        ? {}
        : { targetStepKey: input.targetStepKey }),
    }),
  );
}

const CompleteInput = z.object({
  sessionId: Uuid,
  expectedSessionVersion: Version,
});

export async function founderCompleteAction(
  raw: unknown,
): Promise<ActionResult<OnboardingSessionView>> {
  const input = CompleteInput.parse(raw);
  return run((session) =>
    completeOnboardingSession(session, input.sessionId, {
      expectedSessionVersion: input.expectedSessionVersion,
    }),
  );
}

const VOCABULARY_LABELS: Readonly<Record<string, string>> = {
  industry: "Industry",
  product_category: "Product category",
  business_model: "Business model",
  customer_type: "Customer type",
  technology: "Technology",
  geography: "Geography",
};

const vocabularyLabel = (code: string) => VOCABULARY_LABELS[code] ?? code;

const CandidatesInput = z
  .string()
  .trim()
  .min(1)
  .max(TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH);

/** Suggested categories for the founder's own words. Nothing is assigned. */
export async function founderCandidatesAction(
  rawText: string,
): Promise<ActionResult<readonly TaxonomyCandidateView[]>> {
  const text = CandidatesInput.parse(rawText);
  return run(async (session) => {
    const result = await findTaxonomyCandidates(session, {
      text,
      vocabularyCodes: [...CATEGORY_VOCABULARIES],
    });
    return result.candidates.map((candidate) => ({
      nodeId: candidate.nodeId,
      label: candidate.displayName,
      vocabularyLabel: vocabularyLabel(candidate.vocabularyCode),
      reason: candidate.rationaleSummary,
    }));
  });
}

const DescribeInput = z.array(Uuid).max(8);

export async function founderDescribeNodesAction(
  rawIds: readonly string[],
): Promise<ActionResult<readonly TaxonomyCandidateView[]>> {
  const ids = DescribeInput.parse(rawIds);
  return run(async (session) => {
    const nodes = await Promise.all(
      ids.map((id) => getTaxonomyNode(session, id)),
    );
    return nodes.map((node) => ({
      nodeId: node.id,
      label: node.displayName,
      vocabularyLabel: vocabularyLabel(node.vocabularyCode),
    }));
  });
}
