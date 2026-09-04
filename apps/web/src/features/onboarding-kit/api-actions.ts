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
  listTaxonomyNodes,
  skipOnboardingStep,
  startOnboardingSession,
  submitOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  OnboardingJourneyTypeSchema,
  OnboardingResponseValueSchema,
  OnboardingStepKeySchema,
  TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH,
  TaxonomyVocabularyCodeSchema,
  type OnboardingJourneyType,
  type OnboardingSessionView,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

import type { ClientFailureKind, TaxonomyCandidateView } from "./client";

/**
 * Onboarding server actions: the only place a journey in the browser
 * reaches the Capital Q API. Each action forwards the HttpOnly session's
 * access token server-to-server, validates its own arguments (a client is
 * input, never authority), and returns a plain result the browser can reason
 * about -- never a raw problem document, never the token.
 *
 * Journey-agnostic transport for the runtime contract, one call per action;
 * the journey type is validated input, not trust.
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
    return failure("UNAVAILABLE", "Setup isn't available on this build yet.");
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

export async function onboardingCurrentAction(
  rawJourney: string,
): Promise<ActionResult<OnboardingSessionView | null>> {
  const journeyType = OnboardingJourneyTypeSchema.parse(rawJourney);
  return run(async (session) => {
    try {
      return await getCurrentOnboardingSession(session, journeyType);
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 404) {
        return null;
      }
      throw error;
    }
  });
}

export async function onboardingStartAction(
  rawJourney: string,
  rawIdempotencyKey: string,
): Promise<ActionResult<OnboardingSessionView>> {
  const journeyType: OnboardingJourneyType =
    OnboardingJourneyTypeSchema.parse(rawJourney);
  const idempotencyKey = Uuid.parse(rawIdempotencyKey);
  return run((session) =>
    startOnboardingSession(session, { journeyType }, idempotencyKey),
  );
}

export async function onboardingGetAction(
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

export async function onboardingSubmitAction(
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

export async function onboardingSkipAction(
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

export async function onboardingNavigateAction(
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

export async function onboardingCompleteAction(
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
  regulatory_profile: "Regulatory profile",
  impact_theme: "Impact theme",
};

const vocabularyLabel = (code: string) => VOCABULARY_LABELS[code] ?? code;

const CandidatesInput = z.object({
  text: z.string().trim().min(1).max(TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH),
  vocabularyCodes: z.array(TaxonomyVocabularyCodeSchema).min(1).max(8),
});

/** Suggested categories for the user's own words. Nothing is assigned. */
export async function onboardingCandidatesAction(
  raw: unknown,
): Promise<ActionResult<readonly TaxonomyCandidateView[]>> {
  const input = CandidatesInput.parse(raw);
  return run(async (session) => {
    const result = await findTaxonomyCandidates(session, {
      text: input.text,
      vocabularyCodes: input.vocabularyCodes,
    });
    return result.candidates.map((candidate) => ({
      nodeId: candidate.nodeId,
      label: candidate.displayName,
      vocabularyLabel: vocabularyLabel(candidate.vocabularyCode),
      reason: candidate.rationaleSummary,
    }));
  });
}

const DescribeInput = z.array(Uuid).max(40);

export async function onboardingDescribeNodesAction(
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

/** Root nodes of one vocabulary, for small pick-lists. Active nodes only. */
export async function onboardingListNodesAction(
  rawVocabulary: string,
): Promise<ActionResult<readonly TaxonomyCandidateView[]>> {
  const vocabularyCode = TaxonomyVocabularyCodeSchema.parse(rawVocabulary);
  return run(async (session) => {
    const page = await listTaxonomyNodes(session, vocabularyCode, {
      roots: true,
      limit: 50,
    });
    return page.items.map((node) => ({
      nodeId: node.id,
      label: node.displayName,
      vocabularyLabel: vocabularyLabel(node.vocabularyCode),
    }));
  });
}
