"use server";

import { z } from "zod";

import {
  ApiProblemError,
  getCurrentOnboardingSession,
  listTaxonomyNodes,
  reviseOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { OnboardingResponseValueSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Profile edits of what the person first said in setup (ADR 0024), server
 * side: the answer is revised on their own completed onboarding session
 * through the API, so the step's write targets change the mandate or the
 * company exactly as setup did. Which steps may be revised, and whether
 * this person may, is the API's decision.
 */

export type AnswerActionResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

const JourneyInput = z.enum(["founder", "investor"]);
const StepKeyInput = z.string().min(1).max(120);

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

export async function reviseProfileAnswerAction(input: {
  readonly journey: string;
  readonly stepKey: string;
  readonly value: unknown;
}): Promise<AnswerActionResult> {
  const journey = JourneyInput.safeParse(input.journey);
  const stepKey = StepKeyInput.safeParse(input.stepKey);
  const value = OnboardingResponseValueSchema.safeParse(input.value);
  if (!journey.success || !stepKey.success || !value.success) {
    return { ok: false, message: "That didn't fit. Check it and try again." };
  }
  const active = await session();
  if (active === null) {
    return { ok: false, message: "You are signed out. Sign in and try again." };
  }
  try {
    const current = await getCurrentOnboardingSession(active, journey.data);
    if (current.session.status !== "COMPLETED") {
      return {
        ok: false,
        message: "Finish your setup first; this is still one of its answers.",
      };
    }
    await reviseOnboardingResponse(
      active,
      current.session.id,
      {
        stepKey: stepKey.data,
        response: { value: value.data },
        expectedSessionVersion: current.session.version,
      },
      `profile:${crypto.randomUUID()}`,
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) {
        return {
          ok: false,
          message: "You are signed out. Sign in and try again.",
        };
      }
      if (error.status === 409) {
        return {
          ok: false,
          message:
            "Your profile changed in the meantime. Reload and make the change again.",
        };
      }
      if (error.status === 422 || error.status === 400) {
        return {
          ok: false,
          message: error.problem?.detail ?? "That didn't fit. Check it.",
        };
      }
    }
    return { ok: false, message: "Your change was not saved. Try again." };
  }
}

export type TaxonomyChoice = { readonly id: string; readonly name: string };

const VocabularyInput = z
  .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
  .min(1)
  .max(4);

/** Every active category of these vocabularies, by name (at most 400 each). */
export async function taxonomyChoicesAction(
  vocabularies: readonly string[],
): Promise<readonly TaxonomyChoice[] | null> {
  const parsed = VocabularyInput.safeParse(vocabularies);
  const active = await session();
  if (!parsed.success || active === null) return null;
  try {
    const out: TaxonomyChoice[] = [];
    for (const vocabulary of parsed.data) {
      let cursor: string | undefined;
      for (let page = 0; page < 4; page += 1) {
        const result = await listTaxonomyNodes(active, vocabulary, {
          status: "ACTIVE",
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const node of result.items) {
          out.push({ id: node.id, name: node.displayName });
        }
        cursor = result.nextCursor;
        if (cursor === undefined) break;
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return null;
  }
}
