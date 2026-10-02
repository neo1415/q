// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminVerificationRowDto, KybDto } from "@capital-q/contracts";

import { MobileNavigation } from "../src/components/app-shell/mobile-navigation";
import { verificationGroups } from "../src/features/admin/verification-groups";
import {
  verifyNudge,
  verifyParts,
} from "../src/features/verification/verify-state";

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));

type Standing = KybDto["standing"];

function kyb(
  organisation: Standing,
  person: Standing,
  sent: {
    readonly organisation?: "AUTO" | "PERSON";
    readonly person?: boolean;
  } = {},
): KybDto {
  return {
    standing: organisation,
    organisationName: "Nixo",
    organisationKind: "COMPANY",
    submission:
      sent.organisation === undefined
        ? null
        : {
            submissionId: "00000000-0000-4000-8000-000000000001",
            source: sent.organisation,
            legalName: null,
            registrationNumber: null,
            jurisdictionCode: null,
            registeredAddress: null,
            websiteUrl: null,
            hasDocument: false,
            status: "SUBMITTED",
            decisionReason: null,
            submittedAt: "2026-10-02T09:00:00.000Z",
            decidedAt: null,
          },
    person: {
      standing: person,
      declineReason: null,
      submission:
        sent.person === true
          ? {
              submissionId: "00000000-0000-4000-8000-000000000002",
              nameOnId: "Ada Example",
              role: "Founder",
              hasDocument: false,
              status: "SUBMITTED",
              decisionReason: null,
              submittedAt: "2026-10-02T09:00:00.000Z",
            }
          : null,
    },
  };
}

describe("Verify you and <organisation> (ADMIN-4)", () => {
  it("asks for both parts until one is decided, then only the other", () => {
    expect(verifyParts(kyb("NOT_REQUESTED", "NOT_REQUESTED"))).toEqual({
      organisation: true,
      person: true,
    });
    expect(verifyParts(kyb("VERIFIED", "PENDING"))).toEqual({
      organisation: false,
      person: true,
    });
    expect(
      verifyParts(kyb("PENDING", "VERIFIED", { organisation: "AUTO" })),
    ).toEqual({
      organisation: true,
      person: false,
    });
    expect(
      verifyParts(
        kyb("PENDING", "PENDING", { organisation: "PERSON", person: true }),
      ),
    ).toEqual({ organisation: false, person: false });
  });

  it("states where it stands in words", () => {
    expect(verifyNudge(kyb("NOT_REQUESTED", "NOT_REQUESTED"))).toEqual({
      title: "Verify you and Nixo",
      state: "NOT_STARTED",
    });
    expect(
      verifyNudge(kyb("PENDING", "PENDING", { organisation: "AUTO" }))?.state,
    ).toBe("NEEDS_YOU");
    expect(
      verifyNudge(
        kyb("PENDING", "PENDING", { organisation: "PERSON", person: true }),
      )?.state,
    ).toBe("WITH_CAPITAL_Q");
    expect(verifyNudge(kyb("REVOKED", "VERIFIED"))?.state).toBe("DECLINED");
  });

  it("disappears once both the person and the organisation are verified", () => {
    expect(verifyNudge(kyb("VERIFIED", "VERIFIED"))).toBeNull();
    expect(verifyNudge(kyb("VERIFIED", "PENDING"))).not.toBeNull();
  });

  it("sits inside More on a phone, and is gone when there is nothing to show", () => {
    const { unmount } = render(
      <MobileNavigation
        scope="founder_private"
        verifyNudge={verifyNudge(kyb("PENDING", "NOT_REQUESTED"))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const link = screen.getByRole("link", { name: /Verify you and Nixo/ });
    expect(link.getAttribute("href")).toBe("/verification");
    expect(link.textContent).toContain("Needs something from you");
    unmount();
    render(
      <MobileNavigation
        scope="founder_private"
        verifyNudge={verifyNudge(kyb("VERIFIED", "VERIFIED"))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("link", { name: /Verify you and/ })).toBeNull();
  });
});

describe("admin verification groups (ADMIN-4)", () => {
  const row = (
    claimId: string,
    claimType: string,
    organisationId: string,
  ): AdminVerificationRowDto => ({
    claimId,
    tenantId: "00000000-0000-4000-8000-0000000000aa",
    claimType,
    subjectType: claimType === "ORGANISATION" ? "ORGANISATION" : "PERSON",
    subjectName: null,
    subjectDomain: null,
    organisationId,
    organisationName: "Nixo",
    companyName: null,
    website: null,
    country: null,
    requesterName: null,
    requesterEmail: null,
    synthetic: false,
    evidenceSourceId: null,
    requestedAt: "2026-10-02T09:00:00.000Z",
    kyb: null,
    identity: null,
  });
  const ORG_A = "00000000-0000-4000-8000-0000000000a1";
  const ORG_B = "00000000-0000-4000-8000-0000000000b1";

  it("shows the person and their organisation together, and pairs them for one decision", () => {
    const groups = verificationGroups([
      row("00000000-0000-4000-8000-000000000011", "ORGANISATION", ORG_A),
      row("00000000-0000-4000-8000-000000000021", "ORGANISATION", ORG_B),
      row("00000000-0000-4000-8000-000000000012", "FOUNDER_IDENTITY", ORG_A),
    ]);
    expect(groups.map((group) => group.organisationId)).toEqual([ORG_A, ORG_B]);
    expect(groups[0]?.pair).toEqual([
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000011",
    ]);
    expect(groups[1]?.pair).toBeNull();
  });
});
