"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import {
  claimHandle,
  updateQCard,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QCardFieldScopesSchema,
  QCardSubjectTypeSchema,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";
import { PUBLIC_CARD_TAG, publicCardTag } from "./public-card-data";
import {
  translateQCardError as translate,
  type QCardActionResult,
} from "./q-card-errors";

/**
 * The Q Card from the profile page (BIZ-004), server side. Claiming a
 * handle and changing what the card shows go through the public-identity
 * service -- the same command Q's approved `handle.claim` runs -- under
 * the person's own session. Nothing here decides who may do what.
 */

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
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
    const card = await claimHandle(
      current,
      subject.data.subjectType,
      subject.data.subjectId,
      handle.data,
    );
    // The old handle now redirects: no anonymous read may keep it live.
    updateTag(PUBLIC_CARD_TAG);
    return { ok: true, card };
  } catch (error) {
    return translate(error, subject.data.subjectType);
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
    const card = await updateQCard(
      current,
      subject.data.subjectType,
      subject.data.subjectId,
      input.data,
    );
    // A field the owner just hid must leave the public page now, not when
    // the cache next revalidates.
    updateTag(
      card.handle === null ? PUBLIC_CARD_TAG : publicCardTag(card.handle),
    );
    return { ok: true, card };
  } catch (error) {
    return translate(error, subject.data.subjectType);
  }
}
