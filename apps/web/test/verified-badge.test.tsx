import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  VerifiedBadge,
  isVerifiedStatus,
} from "../src/components/verified-badge";

describe("verified badge condition", () => {
  it("is true only for a VERIFIED status", () => {
    expect(isVerifiedStatus("VERIFIED")).toBe(true);
    expect(isVerifiedStatus("verified")).toBe(true);
  });

  it.each([
    "unverified",
    "UNVERIFIED",
    "unclaimed",
    "PENDING",
    "NOT_REQUESTED",
    "EXPIRED",
    "REVOKED",
    "verified_pending",
    "",
    null,
    undefined,
    true,
    1,
  ])("is false for %s", (status) => {
    expect(isVerifiedStatus(status)).toBe(false);
  });

  it("renders for VERIFIED records, with accessible text", () => {
    const html = renderToStaticMarkup(<VerifiedBadge status="VERIFIED" />);
    expect(html).toContain("data-verified-badge");
    expect(html).toContain("Verified");
    expect(html).toContain('aria-hidden="true"');
  });

  it("never renders for an unclaimed public researched organisation", () => {
    // Seeded QInvest / AlRayan / Alchemist Doha: verification_state unverified.
    for (const org of ["QInvest", "AlRayan", "Alchemist Doha"]) {
      const html = renderToStaticMarkup(
        <VerifiedBadge status="unverified">{`${org} verified`}</VerifiedBadge>,
      );
      expect(html).toBe("");
    }
  });
});
