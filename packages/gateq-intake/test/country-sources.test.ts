import { describe, expect, it } from "vitest";
import { isIsoCountryCode } from "@capital-q/taxonomy/countries";

import { countryOfCity } from "../src/application/cities.js";
import {
  COUNTRY_ALIASES,
  countryCodeIn,
} from "../src/application/normalise-fact.js";

describe("GateQ countries come from the one canonical country list", () => {
  it("reads any country by its name, not only a short list", () => {
    expect(countryCodeIn("Denmark")).toBe("DK");
    expect(countryCodeIn("Copenhagen, Denmark")).toBe("DK");
    expect(countryCodeIn("dk")).toBe("DK");
    expect(countryCodeIn("Côte d'Ivoire")).toBe("CI");
    // Not a country: the European Union is a region code ICU names.
    expect(countryCodeIn("eu")).toBeNull();
    expect(countryCodeIn("European Union")).toBeNull();
  });

  it("maps every synonym to a canonical country", () => {
    for (const [words, code] of Object.entries(COUNTRY_ALIASES)) {
      expect(isIsoCountryCode(code), words).toBe(true);
    }
    expect(countryOfCity("lagos")).toBe("NG");
  });
});
