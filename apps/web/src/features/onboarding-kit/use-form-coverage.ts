"use client";

import { useMemo } from "react";

import type {
  OnboardingCoverage,
  OnboardingSessionView,
} from "@capital-q/contracts";

import { coverageFor, type CoverageJourney } from "./coverage";
import { useRegistrationDefaults } from "./registration-defaults";

/**
 * The coverage of the session the form is showing, recomputed whenever the
 * runtime's view changes (every save returns a new version). Null when the
 * composed client carries no runtime view (fixture previews), in which case
 * the form shows its progress bar alone.
 */
export function useFormCoverage(
  journey: CoverageJourney,
  session:
    | {
        readonly raw?: OnboardingSessionView | undefined;
        readonly labels?: Readonly<Record<string, string>> | undefined;
      }
    | undefined,
): OnboardingCoverage | null {
  const registered = useRegistrationDefaults().organisationName;
  const raw = session?.raw;
  const labels = session?.labels;
  return useMemo(() => {
    if (raw === undefined) return null;
    try {
      return coverageFor({
        journey,
        view: raw,
        registeredOrganisation: registered,
        labels,
      });
    } catch {
      // A view the derivation cannot read is a form without the overview,
      // never a broken form.
      return null;
    }
  }, [journey, raw, registered, labels]);
}
