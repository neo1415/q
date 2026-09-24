import "server-only";

import { cache } from "react";

import {
  ApiProblemError,
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
 *
 * `NONE` is only ever the API's own answer. When the API could not be
 * asked — the local stack restarting, a proxy answering in its place, a
 * session the API no longer accepts — the answer is still `NONE` for every
 * consumer's purposes, but it is marked `unavailable`, so a page can say
 * "couldn't load" instead of telling a real investor to set up first.
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
  | {
      readonly kind: "NONE";
      /**
       * Present when Capital Q was not asked successfully, so "no context"
       * is not known to be true. Absent when the API itself said so.
       */
      readonly unavailable?: true;
    };

export async function apiSession(): Promise<ApiSession | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) {
    return null;
  }
  const accessToken = await getSessionAccessToken();
  return accessToken === null ? null : { baseUrl: apiBaseUrl, accessToken };
}

/**
 * One lookup's outcome. ABSENT is the API's statement that this person has
 * no such thing; UNAVAILABLE is every other failure. The two were collapsed
 * into one `null` before, and a transport error during an API restart then
 * rendered a signed-in investor as a stranger (CQ-VERIFY-001, P1).
 */
type Lookup<T> =
  | { readonly status: "FOUND"; readonly value: T }
  | { readonly status: "ABSENT" }
  | { readonly status: "UNAVAILABLE" };

/**
 * Only a problem the Capital Q API itself produced can mean "absent". A
 * 404 without a problem body is another process on the port; a 401 is a
 * session the API no longer accepts; a 5xx, a rate limit or a thrown fetch
 * is the API being unreachable. None of those says anything about whether
 * this person has a company or an investor organisation.
 */
const ABSENCE_CODES: ReadonlySet<string> = new Set([
  "RESOURCE_NOT_FOUND",
  // No organisation context at all (CONTEXT_REQUIRED): a person who has
  // not set up as anyone yet. The API reports it as an invalid request
  // because there is nothing to act within, and that is an answer.
  "INVALID_REQUEST",
  // The API decided this person may not use the context. There is no
  // subject for Q either way, and "try again" would be a lie.
  "PERMISSION_DENIED",
]);

function classifyFailure(error: unknown): Lookup<never> {
  if (!(error instanceof ApiProblemError) || error.problem === undefined) {
    return { status: "UNAVAILABLE" };
  }
  return ABSENCE_CODES.has(error.code)
    ? { status: "ABSENT" }
    : { status: "UNAVAILABLE" };
}

/** One short pause between the two attempts; a restarting API is often back within it. */
const RETRY_AFTER_MS = 300;

/**
 * Ask once, and once more if the API could not answer. A journey script
 * asks the service to name itself before trusting an answer from the port
 * (scripts/recommendation-journey-smoke.mjs); this is the page-render
 * equivalent, bounded so a render never waits on an outage.
 */
async function lookup<T>(
  read: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
): Promise<Lookup<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { status: "FOUND", value: await read() };
    } catch (error: unknown) {
      const outcome = classifyFailure(error);
      if (outcome.status === "ABSENT" || attempt >= 1) {
        return outcome;
      }
      await wait(RETRY_AFTER_MS);
    }
  }
}

type ContextLookups = {
  readonly founder: (session: ApiSession) => Promise<Lookup<OwnContext>>;
  readonly investor: (session: ApiSession) => Promise<Lookup<OwnContext>>;
};

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function founderLookup(
  wait: (ms: number) => Promise<void>,
): ContextLookups["founder"] {
  return async (session) => {
    const journey = await lookup(
      () => getCurrentOnboardingSession(session, "founder"),
      wait,
    );
    if (journey.status !== "FOUND") {
      return journey;
    }
    const subject = journey.value.session.subject;
    if (subject === null || subject.type !== "COMPANY") {
      // A journey that has not bound a company yet is not a founder context.
      return { status: "ABSENT" };
    }
    let label: string | null = null;
    try {
      label = (await getCompany(session, subject.id)).canonicalName;
    } catch {
      // The subject stands; only the cue's wording is unknown.
    }
    return {
      status: "FOUND",
      value: { kind: "FOUNDER", companyId: subject.id, label },
    };
  };
}

function investorLookup(
  wait: (ms: number) => Promise<void>,
): ContextLookups["investor"] {
  return async (session) => {
    const investor = await lookup(
      () => getCurrentInvestorOrganisation(session),
      wait,
    );
    if (investor.status !== "FOUND") {
      return investor;
    }
    return {
      status: "FOUND",
      value: {
        kind: "INVESTOR",
        investorOrganisationId: investor.value.id,
        label: investor.value.displayName,
      },
    };
  };
}

/**
 * A person who is both (rare, and legitimate) is treated as the founder of
 * the company they are onboarding: that is the context whose evidence and
 * Q Knowledge exist. If neither resolves, Q has no subject and says so.
 *
 * Exported for the regression test; pages use `resolveOwnContext`.
 */
export async function resolveOwnContextWith(
  session: ApiSession | null,
  lookups: ContextLookups = {
    founder: founderLookup(defaultWait),
    investor: investorLookup(defaultWait),
  },
): Promise<OwnContext> {
  if (session === null) {
    return { kind: "NONE" };
  }
  const founder = await lookups.founder(session);
  if (founder.status === "FOUND") {
    return founder.value;
  }
  const investor = await lookups.investor(session);
  if (investor.status === "FOUND") {
    return investor.value;
  }
  // Founder first, as before; but an investor whose founder lookup failed
  // and whose own lookup then succeeded is an investor, and a person whose
  // lookups both failed is not known to be nobody.
  return founder.status === "UNAVAILABLE" || investor.status === "UNAVAILABLE"
    ? { kind: "NONE", unavailable: true }
    : { kind: "NONE" };
}

/** Test seam: the lookups with an injectable pause. */
export function createContextLookups(
  wait: (ms: number) => Promise<void>,
): ContextLookups {
  return { founder: founderLookup(wait), investor: investorLookup(wait) };
}

/**
 * The journey this person started and has not finished, if any: Home offers
 * the way back in ("Continue setup"), because once a company or investor
 * organisation exists the setup paths for a stranger are no longer shown
 * (CQ-PRE-REC-001 §22, §43–§44). Founder first, as for the context.
 */
export const resolveUnfinishedSetup = cache(
  async (): Promise<"founder" | "investor" | null> => {
    const session = await apiSession();
    if (session === null) {
      return null;
    }
    for (const journey of ["founder", "investor"] as const) {
      try {
        const view = await getCurrentOnboardingSession(session, journey);
        if (view.session.status === "ACTIVE") {
          return journey;
        }
      } catch {
        // No such journey for this person. A normal state, not an error.
      }
    }
    return null;
  },
);

export const resolveOwnContext = cache(async (): Promise<OwnContext> =>
  resolveOwnContextWith(await apiSession()),
);
