import { z } from "zod";

/**
 * Registration's one decision (owner directive 2026-10-16, "Registration").
 *
 * Somebody creating an account says which journey they are here for:
 * raising (the founder journey) or investing (the investor journey). That
 * choice initialises the first journey and nothing more. It is NOT a
 * classification of the person: Person ≠ Organisation ≠ Membership/Role,
 * so the same person may later start the other journey, hold memberships
 * on both sides, or join somebody else's team. Authority still comes only
 * from memberships the server resolves; this is text the person chose.
 *
 * Somebody arriving from an invitation link chooses nothing: the
 * invitation already says which organisation, and in which role, they are
 * joining. Asking them "founder or investor?" would invite them to set up
 * a second company next to the one they were invited into.
 */

export const REGISTRATION_JOURNEYS = ["founder", "investor"] as const;
export type RegistrationJourney = (typeof REGISTRATION_JOURNEYS)[number];
export const RegistrationJourneySchema = z.enum(REGISTRATION_JOURNEYS);

/** The `user_metadata` key the choice is carried under across a confirmation email. */
export const INTENDED_JOURNEY_KEY = "intended_journey";

/** A return path that is an invitation link (`/join/<token>`). */
export function isInvitationReturn(next: string): boolean {
  return /^\/join\/[A-Za-z0-9_-]+$/u.test(next);
}

/** How the organisation field reads, for whichever journey is chosen. */
export function organisationFieldFor(journey: RegistrationJourney | null): {
  readonly label: string;
  readonly description: string;
} {
  switch (journey) {
    case "founder":
      return {
        label: "Company name",
        description:
          "Optional. Q starts your company from it; you confirm it before it is saved.",
      };
    case "investor":
      return {
        label: "Fund or firm name",
        description:
          "Optional. Leave it empty if you invest under your own name.",
      };
    case null:
      return {
        label: "Company or fund",
        description: "Optional. It helps Q find the right you.",
      };
  }
}

/** A workspace the person can act in, as the arrival chooser shows it. */
export type ArrivalWorkspace = {
  readonly organisationId: string;
  readonly active: boolean;
};

/**
 * What `/welcome` does with somebody who has arrived.
 *
 *   - UNFINISHED  → back into their own unfinished setup (live re-check
 *     2026-10-31: a founder signed in mid-setup and landed on Home, the
 *     setup out of sight). Supersedes the 2026-10-16 "Home offers it back"
 *     arrival rule; the app itself still never holds them to the setup
 *     (`?again=1`, "Continue later" and every other page stay open).
 *   - DONE, with more than one workspace and none chosen in this browser
 *     session → the workspace chooser, so a person who is a founder at one
 *     company and an investor at one firm picks where they are working
 *     rather than being dropped into whichever context was last active.
 *   - DONE        → Home.
 *   - NEW with a journey chosen at registration → the welcome, set for that
 *     journey: Q does not ask "raising or investing?" a second time.
 *   - NEW without one (Google sign-up, an older account) → the welcome
 *     with the role question, as before.
 */
export type Arrival =
  | { readonly kind: "CHOOSE_WORKSPACE" }
  | { readonly kind: "HOME" }
  | { readonly kind: "RESUME"; readonly journey: RegistrationJourney }
  | { readonly kind: "WELCOME"; readonly journey: RegistrationJourney | null };

export function decideArrival(input: {
  readonly state:
    | { readonly kind: "UNFINISHED"; readonly journey: RegistrationJourney }
    | { readonly kind: "DONE" }
    | { readonly kind: "NEW" }
    | { readonly kind: "UNKNOWN" };
  readonly again: boolean;
  readonly workspaces: readonly ArrivalWorkspace[];
  readonly workspaceChosen: boolean;
  readonly intendedJourney: RegistrationJourney | null;
}): Arrival {
  const { state } = input;
  if (!input.again) {
    // Somebody with several workspaces picks one first, as on any arrival.
    if (
      (state.kind === "UNFINISHED" || state.kind === "DONE") &&
      input.workspaces.length > 1 &&
      !input.workspaceChosen
    ) {
      return { kind: "CHOOSE_WORKSPACE" };
    }
    // Live re-check 2026-10-31: an unfinished setup is where a person who
    // signs in mid-setup carries on, in their own journey (never the
    // other side's).
    if (state.kind === "UNFINISHED") {
      return { kind: "RESUME", journey: state.journey };
    }
    if (state.kind === "DONE") return { kind: "HOME" };
  }
  return {
    kind: "WELCOME",
    // Somebody who already belongs somewhere and came back on purpose
    // (`?again=1`) is offered both journeys, not the one they signed up for.
    journey:
      state.kind === "NEW" && input.workspaces.length === 0
        ? input.intendedJourney
        : null,
  };
}

/**
 * Set once the person picks a workspace on arrival. A session cookie: it
 * lasts for this browser session, so the chooser appears once per sign-in
 * rather than on every visit to `/`. It decides nothing about authority;
 * the active context is still the server's to resolve.
 */
export const WORKSPACE_CHOSEN_COOKIE = "cq_workspace_chosen";
