import "server-only";

import { cache } from "react";

import {
  ApiProblemError,
  getCompany,
  getCurrentInvestorOrganisation,
  getCurrentOnboardingSession,
  getMyOrganisations,
  getQStanding,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { MyOrganisationDto, QStandingDto } from "@capital-q/contracts";

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

/** The same person's session against the Q API. */
export async function qApiSession(): Promise<ApiSession | null> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return null;
  }
  const accessToken = await getSessionAccessToken();
  return accessToken === null ? null : { baseUrl: qApiBaseUrl, accessToken };
}

/**
 * Q's standing with this person (founder direction 2026-09-30): their
 * chosen personality and whether Q paused the account. Null when the Q API
 * could not be asked; a pause is then enforced by Q itself, never guessed.
 */
export const resolveQStanding = cache(
  async (): Promise<QStandingDto | null> => {
    const session = await qApiSession();
    if (session === null) return null;
    return getQStanding(session).catch(() => null);
  },
);

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

/** The person's organisations, or null when they could not be read. */
type OrganisationsReader = (
  session: ApiSession,
) => Promise<readonly MyOrganisationDto[] | null>;

const readNoOrganisations: OrganisationsReader = () => Promise.resolve(null);

const readMyOrganisations: OrganisationsReader = (session) =>
  getMyOrganisations(session)
    .then((mine) => mine.items)
    .catch(() => null);

/**
 * F11/F23: the company a person works in through a membership, whatever
 * journey made them a member. The one they act for (the active context)
 * wins; with none active, their only company. `FIRM` means they act for
 * an investment firm now, so no company is their context. Null: their
 * memberships do not decide it.
 */
export function companyFromMemberships(
  mine: readonly MyOrganisationDto[] | null,
): { readonly companyId: string; readonly label: string } | "FIRM" | null {
  if (mine === null || mine.length === 0) return null;
  const active = mine.find((organisation) => organisation.active);
  if (active !== undefined) {
    if (active.companyId !== null) {
      return { companyId: active.companyId, label: active.name };
    }
    return active.kind === "FIRM" ? "FIRM" : null;
  }
  const companies = mine.filter((organisation) => organisation.companyId);
  const only = companies.length === 1 ? companies[0] : undefined;
  return only === undefined || only.companyId === null
    ? null
    : { companyId: only.companyId, label: only.name };
}

function founderLookup(
  wait: (ms: number) => Promise<void>,
  readOrganisations: OrganisationsReader,
): ContextLookups["founder"] {
  return async (session) => {
    const [journey, mine] = await Promise.all([
      lookup(() => getCurrentOnboardingSession(session, "founder"), wait),
      readOrganisations(session),
    ]);
    // F11: a member who joined (rather than onboarded) has no journey
    // subject; their membership is their context. The server still
    // authorises every read of that company.
    const member = companyFromMemberships(mine);
    if (member === "FIRM") return { status: "ABSENT" };
    if (member !== null) {
      return {
        status: "FOUND",
        value: {
          kind: "FOUNDER",
          companyId: member.companyId,
          label: member.label,
        },
      };
    }
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
    founder: founderLookup(defaultWait, readMyOrganisations),
    investor: investorLookup(defaultWait),
  },
): Promise<OwnContext> {
  if (session === null) {
    return { kind: "NONE" };
  }
  // Both at once (founder live 2026-09-29: every click waited on these one
  // after the other); founder still wins when both exist.
  const [founder, investor] = await Promise.all([
    lookups.founder(session),
    lookups.investor(session),
  ]);
  if (founder.status === "FOUND") {
    return founder.value;
  }
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
  readOrganisations: OrganisationsReader = readNoOrganisations,
): ContextLookups {
  return {
    founder: founderLookup(wait, readOrganisations),
    investor: investorLookup(wait),
  };
}

/** The person's companies and firms, read once per render (switcher + context). */
export const resolveMyOrganisations = cache(
  async (): Promise<readonly MyOrganisationDto[]> => {
    const session = await apiSession();
    if (session === null) return [];
    return (await readMyOrganisations(session)) ?? [];
  },
);

/**
 * Both journeys' current sessions, asked side by side and once per render
 * (L1 latency sweep, 2026-10-06: the app layout asked founder, then
 * investor, one after the other on every page, ~180 ms each hosted, and
 * the setup check asked the same two again). Founder first, as before.
 */
const currentOnboardingViews = cache(async () => {
  const session = await apiSession();
  if (session === null) return null;
  return Promise.all(
    (["founder", "investor"] as const).map(async (journey) => {
      try {
        const value = await getCurrentOnboardingSession(session, journey);
        return { journey, view: { status: "fulfilled", value } as const };
      } catch (reason: unknown) {
        return { journey, view: { status: "rejected", reason } as const };
      }
    }),
  );
});

/**
 * The journey this person started and has not finished, if any: Home offers
 * the way back in ("Continue setup"), because once a company or investor
 * organisation exists the setup paths for a stranger are no longer shown
 * (CQ-PRE-REC-001 §22, §43–§44). Founder first, as for the context.
 */
export const resolveUnfinishedSetup = cache(
  async (): Promise<"founder" | "investor" | null> => {
    const views = await currentOnboardingViews();
    if (views === null) {
      return null;
    }
    for (const { journey, view } of views) {
      // A rejection is no such journey for this person: a normal state.
      if (
        view.status === "fulfilled" &&
        view.value.session.status === "ACTIVE"
      ) {
        return journey;
      }
    }
    return null;
  },
);

/**
 * Where this person stands with onboarding (founder direction 2026-09-30:
 * "the user must always onboard"). DONE once either journey completed, or
 * when an account from before onboarding existed has a context and no
 * session at all. UNKNOWN when Capital Q could not be asked: routing then
 * never traps anybody.
 */
export type OnboardingState =
  | { readonly kind: "DONE" }
  | { readonly kind: "UNFINISHED"; readonly journey: "founder" | "investor" }
  | { readonly kind: "NEW" }
  | { readonly kind: "UNKNOWN" };

export const resolveOnboardingState = cache(
  async (): Promise<OnboardingState> => {
    const views = await currentOnboardingViews();
    if (views === null) return { kind: "UNKNOWN" };
    let active: "founder" | "investor" | null = null;
    let failed = false;
    for (const { journey, view } of views) {
      if (view.status === "fulfilled") {
        if (view.value.session.status === "COMPLETED") return { kind: "DONE" };
        if (view.value.session.status === "ACTIVE" && active === null) {
          active = journey;
        }
      } else if (
        // No such journey for this person is a normal 404; anything else
        // means Capital Q was not asked successfully.
        !(view.reason instanceof ApiProblemError && view.reason.status === 404)
      ) {
        failed = true;
      }
    }
    if (active !== null) {
      // F11: someone let in to a team they did not create (a Member or an
      // Admin there) has somewhere to work; a setup they once started does
      // not send them back to it.
      const mine = await resolveMyOrganisations();
      if (mine.some((organisation) => organisation.role !== "OWNER")) {
        return { kind: "DONE" };
      }
      return { kind: "UNFINISHED", journey: active };
    }
    if (failed) return { kind: "UNKNOWN" };
    const context = await resolveOwnContext();
    return context.kind === "NONE" ? { kind: "NEW" } : { kind: "DONE" };
  },
);

/** Where somebody who has not finished onboarding continues it, with Q. */
export function onboardingPath(state: OnboardingState): string | null {
  if (state.kind === "UNFINISHED") {
    // F15: resuming opens the screen they were on (the form), never live
    // voice nobody asked for; "Talk it through" is the explicit way in.
    return `/onboarding/${state.journey}?from=home`;
  }
  return state.kind === "NEW" ? "/welcome" : null;
}

export const resolveOwnContext = cache(async (): Promise<OwnContext> =>
  resolveOwnContextWith(await apiSession(), {
    // The switcher's own read, shared within the render.
    founder: founderLookup(defaultWait, () => resolveMyOrganisations()),
    investor: investorLookup(defaultWait),
  }),
);
