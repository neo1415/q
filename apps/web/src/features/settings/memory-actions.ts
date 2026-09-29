"use server";

import { z } from "zod";

import { forgetQMemory } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Forget one thing Q remembered about the person (ADR 0012). The id is
 * input; the Q API forgets only the caller's own memory.
 */
export async function forgetMemoryAction(
  memoryItemId: string,
): Promise<{ readonly ok: boolean }> {
  const id = z.string().uuid().safeParse(memoryItemId);
  if (!id.success) return { ok: false };
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) return { ok: false };
  try {
    await forgetQMemory({ baseUrl: qApiBaseUrl, accessToken }, id.data);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
