"use server";

import { z } from "zod";

import { downloadCompanyDeck } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The profile's deck download, server side: the access token never leaves
 * the server, and the answer is only a short-lived signed URL the browser
 * then follows straight to storage. The bytes never pass through here.
 * Whether the reader may have the deck is entirely the API's decision.
 */

const CompanyIdInput = z.string().uuid();

export type DeckDownloadResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly message: string };

export async function downloadDeckAction(
  rawCompanyId: string,
): Promise<DeckDownloadResult> {
  const companyId = CompanyIdInput.safeParse(rawCompanyId);
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (!companyId.success || apiBaseUrl === undefined || accessToken === null) {
    return { ok: false, message: "The deck couldn't be opened. Try again." };
  }
  try {
    const link = await downloadCompanyDeck(
      { baseUrl: apiBaseUrl, accessToken },
      companyId.data,
    );
    return { ok: true, url: link.url };
  } catch {
    // Not shared, unshared since, or unavailable: the reader is told it
    // could not be opened, never which.
    return { ok: false, message: "The deck couldn't be opened. Try again." };
  }
}
