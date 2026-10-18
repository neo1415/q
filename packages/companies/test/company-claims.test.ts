import { describe, expect, it } from "vitest";

import { emailAtCompany } from "../src/index.js";

describe("claiming with a work email (F3)", () => {
  it("accepts only an address at the company's own website domain", () => {
    expect(
      emailAtCompany("amara@korahealth.ng", "https://www.korahealth.ng/about"),
    ).toBe(true);
    expect(
      emailAtCompany("amara@team.korahealth.ng", "https://korahealth.ng"),
    ).toBe(true);
    expect(emailAtCompany("amara@gmail.com", "https://korahealth.ng")).toBe(
      false,
    );
    expect(
      emailAtCompany("amara@korahealth.ng.evil.com", "https://korahealth.ng"),
    ).toBe(false);
    expect(
      emailAtCompany("amara@evilkorahealth.ng", "https://korahealth.ng"),
    ).toBe(false);
    // No website on file: nothing to check an email against.
    expect(emailAtCompany("amara@korahealth.ng", null)).toBe(false);
  });
});
