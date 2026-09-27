"use server";

import { z } from "zod";

import {
  ApiProblemError,
  claimHandle,
  updateQCard,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QCardFieldScopesSchema,
  QCardSubjectTypeSchema,
  type QCardDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The Q Card from the profile page (BIZ-004), server side. Claiming a
 * handle and changing what the card shows go through the public-identity
 * service -- the same command Q's approved `handle.claim` runs -- under
 * the person's own session. Nothing here decides who may do what.
 */

export type QCardActionResult =
  | { readonly ok: true; readonly card: QCardDto }
  | { readonly ok: false; readonly message: string };

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

function translate(error: unknown): QCardActionResult {
  if (error instanceof ApiProblemError) {
    if (error.status === 409 && error.code === "VERSION_CONFLICT") {
      return {
        ok: false,
        message:
          "The card changed since this page was opened. Reload and try again.",
      };
    }
    if (error.status === 409 || error.status === 422) {
      return {
        ok: false,
        message: error.problem?.detail ?? "That handle isn't available.",
      };
    }
    if (error.status === 403) {
      return {
        ok: false,
        message:
          "Only an administrator of your organisation can change its handle or card.",
      };
    }
    if (error.status === 401) {
      return {
        ok: false,
        message: "Your session ended. Sign in again to continue.",
      };
    }
    if (error.status === 404) {
      return { ok: false, message: "This profile isn't available to you." };
    }
  }
  return {
    ok: false,
    message: "Capital Q couldn't save that just now. Try again.",
  };
}

const Subject = z.object({
  subjectType: QCardSubjectTypeSchema,
  subjectId: z.string().uuid(),
});

export async function claimHandleAction(
  rawSubject: unknown,
  rawHandle: string,
): Promise<QCardActionResult> {
  const subject = Subject.safeParse(rawSubject);
  const handle = z.string().trim().min(1).max(40).safeParse(rawHandle);
  if (!subject.success || !handle.success) {
    return { ok: false, message: "Enter a handle first." };
  }
  const current = await session();
  if (current === null) {
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
  }
  try {
    return {
      ok: true,
      card: await claimHandle(
        current,
        subject.data.subjectType,
        subject.data.subjectId,
        handle.data,
      ),
    };
  } catch (error) {
    return translate(error);
  }
}

export async function updateQCardAction(
  rawSubject: unknown,
  rawInput: unknown,
): Promise<QCardActionResult> {
  const subject = Subject.safeParse(rawSubject);
  const input = z
    .object({
      expectedVersion: z.number().int().min(1),
      fieldScopes: QCardFieldScopesSchema.optional(),
      indexable: z.boolean().optional(),
    })
    .strict()
    .safeParse(rawInput);
  if (!subject.success || !input.success) {
    return { ok: false, message: "That change couldn't be made." };
  }
  const current = await session();
  if (current === null) {
    return {
      ok: false,
      message: "Your session ended. Sign in again to continue.",
    };
  }
  try {
    return {
      ok: true,
      card: await updateQCard(
        current,
        subject.data.subjectType,
        subject.data.subjectId,
        input.data,
      ),
    };
  } catch (error) {
    return translate(error);
  }
}
