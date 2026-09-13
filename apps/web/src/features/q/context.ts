import "server-only";

import { cache } from "react";

import {
  getCompany,
  getCurrentInvestorOrganisation,
  getCurrentOnboardingSession,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The context this person's Q questions are about (CQ-PRE-REC-001 §7).
 *
 * Resolved on the server, once per request, from what Capital Q already
 * knows: a founder's journey binds a canonical company; an investor's
 * organisation is read through the investor API under their own token.
 * Nothing here is authority — a subject named from this is a request the
 * Q API resolves and authorises again — and nothing here guesses: a person
 * with no company and no investor organisation is `NONE`, and Q still
 * answers generic questions for them. Never "the first row in the database".
 */
export type OwnContext =
  | {
      readonly kind: "FOUNDER";
      readonly companyId: string;
      /** The company's canonical name, for the context cue. */
      readonly label: string | null;
    }
  | {
      readonly kind: "INVESTOR";
      readonly investorOrganisationId: string;
      readonly label: string | null;
    }
  | { readonly kind: "NONE" };

async function apiSession(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) {
    return null;
  }
  const accessToken = await getSessionAccessToken();
  return accessToken === null ? null : { baseUrl: apiBaseUrl, accessToken };
}

async function founderContext(session: ApiSession): Promise<OwnContext | null> {
  try {
    const view = await getCurrentOnboardingSession(session, "founder");
    const subject = view.session.subject;
    if (subject === null || subject.type !== "COMPANY") {
      return null;
    }
    let label: string | null = null;
    try {
      label = (await getCompany(session, subject.id)).canonicalName;
    } catch {
      // The subject stands; only the cue's wording is unknown.
    }
    return { kind: "FOUNDER", companyId: subject.id, label };
  } catch {
    // Not a founder, or no journey yet. A normal state, not an error.
    return null;
  }
}

async function investorContext(
  session: ApiSession,
): Promise<OwnContext | null> {
  try {
    const investor = await getCurrentInvestorOrganisation(session);
    return {
      kind: "INVESTOR",
      investorOrganisationId: investor.id,
      label: investor.displayName,
    };
  } catch {
    return null;
  }
}

/**
 * A person who is both (rare, and legitimate) is treated as the founder of
 * the company they are onboarding: that is the context whose evidence and
 * Q Knowledge exist. If neither resolves, Q has no subject and says so.
 */
export const resolveOwnContext = cache(async (): Promise<OwnContext> => {
  const session = await apiSession();
  if (session === null) {
    return { kind: "NONE" };
  }
  const founder = await founderContext(session);
  if (founder !== null) {
    return founder;
  }
  const investor = await investorContext(session);
  return investor ?? { kind: "NONE" };
});
