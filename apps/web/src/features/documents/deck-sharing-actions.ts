"use server";

import { z } from "zod";

import { setDocumentDownloadAudience } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  DocumentDownloadAudienceSchema,
  type DocumentDownloadAudienceDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Who may download a pitch deck (ADR 0041), server side: the token never
 * leaves the server, and the API decides (the owner's own deck, the
 * capability, the version the screen saw), audits and records the event.
 */

const Input = z
  .object({
    documentId: z.string().uuid(),
    audience: DocumentDownloadAudienceSchema,
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export type DeckSharingResult =
  | { readonly ok: true; readonly value: DocumentDownloadAudienceDto }
  | { readonly ok: false; readonly message: string };

export async function setDeckAudienceAction(
  raw: z.input<typeof Input>,
): Promise<DeckSharingResult> {
  const input = Input.safeParse(raw);
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (!input.success || apiBaseUrl === undefined || accessToken === null) {
    return { ok: false, message: "That didn't save. Reload and try again." };
  }
  try {
    return {
      ok: true,
      value: await setDocumentDownloadAudience(
        { baseUrl: apiBaseUrl, accessToken },
        input.data.documentId,
        {
          audience: input.data.audience,
          expectedVersion: input.data.expectedVersion,
        },
      ),
    };
  } catch {
    return {
      ok: false,
      message:
        "That didn't save. It may have changed elsewhere: reload and try again.",
    };
  }
}
