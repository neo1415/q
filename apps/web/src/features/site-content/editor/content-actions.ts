"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ApiProblemError,
  getAdminSiteVersion,
  publishAdminSitePage,
  restoreAdminSiteVersion,
  saveAdminSiteDraft,
  unpublishAdminSitePage,
  updateAdminSiteSettings,
  type ApiSession,
} from "@capital-q/api-client";
import {
  SiteSettingsSchema,
  SiteSlugSchema,
  type AdminSiteVersionDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The content editor's writes (decision 107). Server actions, so the
 * session never reaches the browser; the API decides every permission and
 * re-validates every block. A STEP_UP_REQUIRED answer comes back as
 * `stepUp: true` and the console's guard asks for the password, then
 * retries; a VERSION_CONFLICT is `conflict: true` (another window saved).
 */

export type ContentResult<T = undefined> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly message?: string | undefined;
    }
  | {
      readonly ok: false;
      readonly stepUp?: true | undefined;
      readonly conflict?: true | undefined;
      readonly message: string;
    };

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
  done?: string,
): Promise<ContentResult<T>> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    const value = await work(session);
    return { ok: true, value, message: done };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) {
      if (error.code === "STEP_UP_REQUIRED") {
        return {
          ok: false,
          stepUp: true,
          message: "Confirm it's you to continue.",
        };
      }
      if (error.code === "VERSION_CONFLICT") {
        return { ok: false, conflict: true, message: error.message };
      }
      if (error.status === 404) {
        return {
          ok: false,
          message: "That isn't available to your role, or it no longer exists.",
        };
      }
      if (
        error.status === 409 ||
        error.status === 422 ||
        error.status === 400
      ) {
        return { ok: false, message: error.message };
      }
    }
    return {
      ok: false,
      message: "That didn't go through. Nothing changed. Try again.",
    };
  }
}

const Slug = SiteSlugSchema;
const Revision = z.number().int().min(1);

/** Where a page appears to visitors, so a publish shows at once. */
function revalidateFor(slug: string): void {
  revalidatePath("/");
  if (slug === "pricing") revalidatePath("/pricing");
  else if (slug === "faq") revalidatePath("/faq");
  else if (!slug.startsWith("landing-")) revalidatePath(`/legal/${slug}`);
}

export async function saveSiteDraftAction(
  rawSlug: string,
  raw: {
    readonly title: string;
    readonly summary: string;
    readonly blocks: unknown;
    readonly expectedRevision: number;
  },
): Promise<
  ContentResult<{ readonly revision: number; readonly updatedAt: string }>
> {
  const slug = Slug.parse(rawSlug);
  const expectedRevision = Revision.parse(raw.expectedRevision);
  return run((session) =>
    saveAdminSiteDraft(session, slug, {
      title: z.string().trim().min(1).max(200).parse(raw.title),
      summary: z.string().max(600).parse(raw.summary),
      // Validated (and sanitised) by the API, never trusted here.
      blocks: raw.blocks,
      expectedRevision,
    }),
  );
}

export async function publishSitePageAction(
  rawSlug: string,
  raw: {
    readonly expectedRevision: number;
    readonly reason?: string | undefined;
    readonly confirmLegalReview?: boolean | undefined;
  },
): Promise<ContentResult<{ readonly versionNumber: number }>> {
  const slug = Slug.parse(rawSlug);
  const reason = raw.reason?.trim() ?? "";
  const result = await run(
    (session) =>
      publishAdminSitePage(session, slug, {
        expectedRevision: Revision.parse(raw.expectedRevision),
        ...(reason.length >= 3 ? { reason: reason.slice(0, 500) } : {}),
        ...(raw.confirmLegalReview === true
          ? { confirmLegalReview: true }
          : {}),
      }),
    "Published.",
  );
  if (result.ok) revalidateFor(slug);
  return result;
}

export async function unpublishSitePageAction(
  rawSlug: string,
  rawReason: string,
): Promise<ContentResult> {
  const slug = Slug.parse(rawSlug);
  const reason = z.string().trim().min(3).max(500).parse(rawReason);
  const result = await run(async (session) => {
    await unpublishAdminSitePage(session, slug, { reason });
    return undefined;
  }, "Taken down. Its versions are kept.");
  if (result.ok) revalidateFor(slug);
  return result;
}

export async function restoreSiteVersionAction(
  rawSlug: string,
  raw: { readonly versionNumber: number; readonly expectedRevision: number },
): Promise<ContentResult> {
  const slug = Slug.parse(rawSlug);
  return run(async (session) => {
    await restoreAdminSiteVersion(session, slug, {
      versionNumber: z.number().int().min(1).parse(raw.versionNumber),
      expectedRevision: Revision.parse(raw.expectedRevision),
    });
    return undefined;
  }, "Restored to the draft. Publish to make it live.");
}

export async function loadSiteVersionAction(
  rawSlug: string,
  versionNumber: number,
): Promise<ContentResult<AdminSiteVersionDto>> {
  const slug = Slug.parse(rawSlug);
  return run((session) =>
    getAdminSiteVersion(
      session,
      slug,
      z.number().int().min(1).parse(versionNumber),
    ),
  );
}

export async function saveSiteSettingsAction(raw: {
  readonly settings: unknown;
  readonly expectedRevision: number;
}): Promise<ContentResult> {
  const parsed = SiteSettingsSchema.safeParse(raw.settings);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        "Check the fields: the brand name is required and the email must be an address.",
    };
  }
  const result = await run(async (session) => {
    await updateAdminSiteSettings(session, {
      settings: parsed.data,
      expectedRevision: Revision.parse(raw.expectedRevision),
    });
    return undefined;
  }, "Saved. Every page uses the new details.");
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/pricing");
    revalidatePath("/faq");
    revalidatePath("/legal/[slug]", "page");
  }
  return result;
}
