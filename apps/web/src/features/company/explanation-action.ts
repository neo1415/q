"use server";

import { z } from "zod";

import { getRecommendationExplanation } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { RecommendationExplanationDto } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Why this company is in the reader's feed (CQ-WEB-024; CQ-REC-007).
 *
 * A server action so the access token stays on the server. Both ids are
 * input, never proof: the Q API resolves the reader's own investor
 * organisation and answers not-found for a slate it does not own, or a
 * company that slate does not hold. Every refusal comes back here as the
 * same `UNAVAILABLE`, so the page cannot tell — and so cannot say — which.
 */

export type ExplanationActionResult =
  | { readonly kind: "EXPLAINED"; readonly value: RecommendationExplanationDto }
  | { readonly kind: "UNAVAILABLE" };

const IdInput = z.string().uuid();

export async function explainRecommendationAction(
  slateId: string,
  companyId: string,
): Promise<ExplanationActionResult> {
  const slate = IdInput.safeParse(slateId);
  const company = IdInput.safeParse(companyId);
  if (!slate.success || !company.success) return { kind: "UNAVAILABLE" };

  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return { kind: "UNAVAILABLE" };
  }

  try {
    const value = await getRecommendationExplanation(
      { baseUrl: qApiBaseUrl, accessToken },
      slate.data,
      company.data,
    );
    return { kind: "EXPLAINED", value };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
