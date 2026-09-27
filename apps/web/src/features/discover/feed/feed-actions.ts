"use server";

import { z } from "zod";

import {
  discoverCompanies,
  passCompany,
  saveCompany,
  unsaveCompany,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  DiscoverFiltersSchema,
  type DiscoveryCompanySlateDto,
  type InteractionRecordedDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The feed's wire, server side (CQ-WEB-022).
 *
 * The controller was built against an injected port so that it never had
 * to know how a slate arrives. This is the answer in the browser's case,
 * and it is a server action rather than a client-side client for one
 * reason: the access token never leaves the server. A `fetch` from the
 * feed component would need the token in the bundle, which is the thing
 * doc 15 forbids and which no amount of care in the component would undo.
 *
 * Every action re-reads the session. A client that called one of these
 * with someone else's company id gets whatever the API says about that —
 * the id is input, never proof, and authorisation is the server's.
 */

export type FeedActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const CursorInput = z.string().min(1).max(200);
const CompanyIdInput = z.string().uuid();
const SlateIdInput = z.string().uuid();
const ClientEventIdInput = z.string().regex(/^[A-Za-z0-9_:-]{8,64}$/);
const IntentInput = z.enum(["SAVE", "UNSAVE", "PASS"]);

async function session(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null || apiBaseUrl === undefined) return null;
  return { baseUrl: apiBaseUrl, accessToken };
}

const NO_SESSION = "You are signed out. Sign in and try again.";

/** `GET /v1/discovery/companies` — one page of the slate, by cursor. */
export async function loadSlatePageAction(
  cursor: string | null,
  rawFilters: unknown = null,
): Promise<FeedActionResult<DiscoveryCompanySlateDto>> {
  const active = await session();
  if (active === null) return { ok: false, message: NO_SESSION };

  // The filters arrive from the browser: input, validated here, never
  // trusted as shape. The API validates them again at its own boundary.
  const filters =
    rawFilters === null ? null : DiscoverFiltersSchema.safeParse(rawFilters);
  if (filters !== null && !filters.success) {
    return {
      ok: false,
      message: "Those filters aren't valid. Clear them and try again.",
    };
  }

  const parsed = cursor === null ? null : CursorInput.safeParse(cursor);
  if (parsed !== null && !parsed.success) {
    return {
      ok: false,
      message: "That page link isn't valid. Reload Discover and try again.",
    };
  }

  try {
    const slate = await discoverCompanies(active, {
      ...(parsed === null ? {} : { cursor: parsed.data }),
      ...(filters === null ? {} : { filters: filters.data }),
    });
    return { ok: true, value: slate };
  } catch {
    // The message is deliberately plain: a failed page is not a verdict on
    // the reader's mandate, and saying so avoids implying it is.
    return { ok: false, message: "Discover could not load right now." };
  }
}

/**
 * One of save, unsave or pass.
 *
 * The client sends its own idempotency key and the slate it was looking
 * at, and nothing else. Rank, ranking version, organisation and tenant are
 * absent because they are the server's answers.
 */
export async function recordDecisionAction(input: {
  readonly companyId: string;
  readonly intent: "SAVE" | "UNSAVE" | "PASS";
  readonly slateId: string | null;
  readonly clientEventId: string;
}): Promise<FeedActionResult<InteractionRecordedDto>> {
  const active = await session();
  if (active === null) return { ok: false, message: NO_SESSION };

  const companyId = CompanyIdInput.safeParse(input.companyId);
  const intent = IntentInput.safeParse(input.intent);
  const clientEventId = ClientEventIdInput.safeParse(input.clientEventId);
  const slateId =
    input.slateId === null ? null : SlateIdInput.safeParse(input.slateId);

  if (
    !companyId.success ||
    !intent.success ||
    !clientEventId.success ||
    (slateId !== null && !slateId.success)
  ) {
    return {
      ok: false,
      message: "That didn't go through. Reload and try again.",
    };
  }

  const body = {
    clientEventId: clientEventId.data,
    surface: "RECOMMENDATION_FEED" as const,
    ...(slateId === null ? {} : { slateId: slateId.data }),
  };

  try {
    const recorded =
      intent.data === "SAVE"
        ? await saveCompany(active, companyId.data, body)
        : intent.data === "UNSAVE"
          ? await unsaveCompany(active, companyId.data, body)
          : // No reason is sent. Doc 17 §67: pass is fast, and a mandatory
            // feedback modal after every pass is explicitly not wanted.
            await passCompany(active, companyId.data, body);
    return { ok: true, value: recorded };
  } catch {
    return { ok: false, message: "That did not save. Try again." };
  }
}
