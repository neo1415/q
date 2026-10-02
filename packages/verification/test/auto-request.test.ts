import { describe, expect, it } from "vitest";

import { emailDomainMatchesWebsite, websiteHost } from "../src/index.js";

describe("automatic verification evidence (ADMIN-4)", () => {
  it("reads a website's host whatever its shape", () => {
    expect(websiteHost("https://www.Nixo.io/about")).toBe("nixo.io");
    expect(websiteHost("nixo.io")).toBe("nixo.io");
    expect(websiteHost("")).toBeNull();
    expect(websiteHost(null)).toBeNull();
  });

  it("matches an email domain to the website, and keeps unknown unknown", () => {
    expect(emailDomainMatchesWebsite("nixo.io", "https://www.nixo.io")).toBe(true);
    expect(emailDomainMatchesWebsite("mail.nixo.io", "nixo.io")).toBe(true);
    expect(emailDomainMatchesWebsite("gmail.com", "https://nixo.io")).toBe(false);
    expect(emailDomainMatchesWebsite("evilnixo.io", "nixo.io")).toBe(false);
    expect(emailDomainMatchesWebsite(null, "nixo.io")).toBeNull();
    expect(emailDomainMatchesWebsite("nixo.io", null)).toBeNull();
  });
});
