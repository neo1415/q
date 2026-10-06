"use server";

import { z } from "zod";

import {
  ApiProblemError,
  getMyCompanyMembership,
  updateMyFounderProfile,
  upsertMyCompanyMembership,
} from "@capital-q/api-client";
import {
  BUSINESS_TITLE_MAX_LENGTH,
  FOUNDER_SUMMARY_MAX_LENGTH,
} from "@capital-q/contracts";

import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * F4: the founder's own background from /profile: their title at the
 * company, previous roles and education. Their own record only: the
 * company is the context the server resolves, never one the browser names.
 */
export type BackgroundResult =
  | { readonly ok: true; readonly version: number | null }
  | { readonly ok: false; readonly message: string };

const Input = z
  .object({
    businessTitle: z.string().trim().max(BUSINESS_TITLE_MAX_LENGTH),
    previousRoles: z.string().trim().max(FOUNDER_SUMMARY_MAX_LENGTH),
    education: z.string().trim().max(FOUNDER_SUMMARY_MAX_LENGTH),
    titleChanged: z.boolean(),
    summariesChanged: z.boolean(),
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();

const blank = (value: string) => (value === "" ? null : value);

export async function saveFounderBackgroundAction(
  raw: unknown,
): Promise<BackgroundResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "That's longer than we can keep." };
  }
  const input = parsed.data;
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (context.kind !== "FOUNDER" || session === null) {
    return { ok: false, message: "Sign in to your company to edit this." };
  }
  try {
    let version = input.expectedVersion;
    if (input.summariesChanged) {
      const saved = await updateMyFounderProfile(session, context.companyId, {
        ...(input.expectedVersion === null
          ? {}
          : { expectedVersion: input.expectedVersion }),
        professionalSummary: blank(input.previousRoles),
        backgroundSummary: blank(input.education),
      });
      version = saved.version;
    }
    if (input.titleChanged) {
      // Keep the relationship they already have; only the title changes.
      const mine = await getMyCompanyMembership(
        session,
        context.companyId,
      ).catch(() => null);
      await upsertMyCompanyMembership(session, context.companyId, {
        relationshipType: mine?.relationshipType ?? "team_member",
        isFounder: mine?.isFounder ?? true,
        businessTitle: blank(input.businessTitle),
      });
    }
    return { ok: true, version };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status === 409) {
      return {
        ok: false,
        message: "This changed since the page was opened. Reload to see it.",
      };
    }
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : "That didn't save. Try again.",
    };
  }
}
