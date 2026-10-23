import { describe, expect, it } from "vitest";

import {
  CreateOrganisationRequestSchema,
  UpdateInvestorOrganisationRequestSchema,
} from "../src/index.js";

/**
 * Owner QA 23 Oct: a typed "Https://zinoaviation.com" was stored and shown
 * as typed. The scheme is stored lower-case; the rest is left as given.
 */
describe("website URLs", () => {
  it("stores the scheme lower-case and keeps the rest as given", () => {
    const parsed = UpdateInvestorOrganisationRequestSchema.parse({
      expectedVersion: 1,
      websiteUrl: "Https://ZinoAviation.com/About",
    });
    expect(parsed.websiteUrl).toBe("https://ZinoAviation.com/About");
  });

  it("still refuses a non-http address", () => {
    const result = CreateOrganisationRequestSchema.safeParse({
      displayName: "Harbourline",
      websiteUrl: "ftp://harbourline.vc",
    });
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "websiteUrl",
    );
  });
});
