import type { OnboardingResponseValue } from "@capital-q/contracts";
import {
  countryOfIso,
  countryOfName,
  countryOfNodeId,
  type IsoCountry,
} from "@capital-q/taxonomy/countries";

import { COUNTRY_OTHER_OPTION } from "./founder-v1.js";

/**
 * The country a founder's F1.country answer names, from any definition
 * version, read against the one canonical country list.
 *
 * - v8 onward: a reference to one geography node; a country when the node
 *   carries an ISO code, nothing for a region.
 * - v1-v7: an option key, which is a lowercase ISO 3166-1 code, so every
 *   stored option maps to its geography node; "other" with a note that is
 *   a country's name ("Uzbekistan") maps to that country, and any other
 *   note stays their words only.
 *
 * Browser-safe: the web, q-api and the write target read answers the same
 * way, and an older session's answer stays valid without rewriting it.
 */
export function founderCountryOf(
  value: OnboardingResponseValue | null | undefined,
  note: string | null = null,
): IsoCountry | null {
  if (value === null || value === undefined) return null;
  if (value.type === "RESOURCE_REFERENCE") {
    return value.resourceType === "TAXONOMY_NODE" &&
      value.resourceIds.length === 1
      ? countryOfNodeId(value.resourceIds[0])
      : null;
  }
  if (value.type === "SINGLE_SELECT") {
    return value.optionKey === COUNTRY_OTHER_OPTION
      ? countryOfName(note)
      : countryOfIso(value.optionKey);
  }
  return null;
}

/** The F1.country answer for a country, in the v8 shape. */
export function founderCountryAnswer(iso: string): OnboardingResponseValue {
  const country = countryOfIso(iso);
  if (country === null) throw new RangeError(`${iso} is not a country`);
  return {
    type: "RESOURCE_REFERENCE",
    resourceType: "TAXONOMY_NODE",
    resourceIds: [country.nodeId],
  };
}
