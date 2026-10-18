import { describe, expect, it } from "vitest";

import {
  PROSPECT_FIT_VERSION,
  prospectFit,
  rankProspects,
} from "../src/index.js";

/**
 * Company → investors from declared, network-visible profiles only
 * (acceptance directive E). Deterministic, explained, and unknown is never
 * a penalty.
 */
describe("prospect fit", () => {
  it("names each reason it counts", () => {
    const fit = prospectFit(
      { countryCode: "ke", stageCode: "pre_seed" },
      {
        investorType: "ANGEL",
        hqCountry: "KE",
        deploymentState: "ACTIVELY_INVESTING",
      },
    );
    expect(fit.reasons.map((r) => r.kind)).toEqual([
      "SAME_COUNTRY",
      "TYPICAL_STAGE",
      "DEPLOYING",
    ]);
    expect(fit.score).toBe(75);
    expect(PROSPECT_FIT_VERSION).toBe("prospect-fit.v1");
  });

  it("counts nothing for what is unknown, on either side", () => {
    expect(
      prospectFit(
        { countryCode: null, stageCode: null },
        { investorType: "ANGEL", hqCountry: "KE", deploymentState: null },
      ),
    ).toEqual({ score: 0, reasons: [] });
    expect(
      prospectFit(
        { countryCode: "KE", stageCode: "seed" },
        { investorType: null, hqCountry: null, deploymentState: null },
      ),
    ).toEqual({ score: 0, reasons: [] });
  });

  it("leaves out candidates with no reason and orders the rest reproducibly", () => {
    const ranked = rankProspects({ countryCode: "KE", stageCode: "seed" }, [
      {
        investorOrganisationId: "b",
        displayName: "Beta",
        investorType: "VC",
        hqCountry: "GB",
        deploymentState: null,
      },
      {
        investorOrganisationId: "a",
        displayName: "Alpha",
        investorType: "VC",
        hqCountry: "GB",
        deploymentState: null,
      },
      {
        investorOrganisationId: "c",
        displayName: "Nobody",
        investorType: "OTHER",
        hqCountry: "US",
        deploymentState: "PAUSED",
      },
    ]);
    expect(ranked.map((r) => r.displayName)).toEqual(["Alpha", "Beta"]);
  });
});
