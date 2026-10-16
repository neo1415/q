import type { RegistrationJourney } from "@/auth/registration";

import type { RegistrationDefaults } from "./registration-defaults";

/**
 * The defaults one journey may use. An organisation typed while signing up
 * as an investor is a fund's name, not a company's: it is offered only to
 * the journey it was typed for (or to either, when no journey was chosen).
 */
export function registrationDefaultsFor(
  journey: RegistrationJourney,
  details: {
    readonly organisationName: string | null;
    readonly intendedJourney: RegistrationJourney | null;
  },
): RegistrationDefaults {
  const matches =
    details.intendedJourney === null || details.intendedJourney === journey;
  return { organisationName: matches ? details.organisationName : null };
}
