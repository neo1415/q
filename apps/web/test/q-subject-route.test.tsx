// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QPageSubject,
  QSubjectProvider,
  useQSubject,
  type QSubject,
} from "../src/features/q/q-subject";
import { namedSubject } from "../src/features/q/use-q-conversation";

/**
 * Run 6, 16 Oct: on Harbourline's profile, Q was asked about the Discover
 * feed's last card: the page subject was still the feed's, and it went as
 * the question's named subject.
 */
let pathname = "/discover";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  pathname = "/discover";
});

const HARBOURLINE = "ceb6ec2d-4a4a-41a2-9b71-377d72c26407";
const FEED_CARD = "5be654c3-eb80-4bdf-aa5a-9cb29c521dbe";
const own: QSubject = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: "1c4b9266-350c-409d-9582-04a0f771b8a8",
  label: "Savanna Seed Partners",
  scope: "investor_private",
};
const feedCard: QSubject = {
  kind: "COMPANY",
  companyId: FEED_CARD,
  label: "Brancheon Works",
  scope: "network_visible",
};

function Subject() {
  const subject = useQSubject();
  return (
    <p>
      {subject.kind === "COMPANY"
        ? subject.companyId
        : subject.kind === "INVESTOR_ORGANISATION"
          ? "own"
          : subject.kind}
    </p>
  );
}

describe("the Q page subject follows the route", () => {
  it("is the company the moment the route moves from Discover to its profile, before the page declares it", () => {
    // The feed's page stays mounted (as across a transition): its stale
    // declaration must not survive the route change.
    const { rerender } = render(
      <QSubjectProvider own={own}>
        <QPageSubject subject={feedCard} />
        <Subject />
      </QSubjectProvider>,
    );
    expect(screen.getByText(FEED_CARD)).toBeTruthy();
    pathname = `/company/${HARBOURLINE}`;
    act(() => {
      rerender(
        <QSubjectProvider own={own}>
          <Subject />
        </QSubjectProvider>,
      );
    });
    expect(screen.getByText(HARBOURLINE)).toBeTruthy();
  });

  it("clears on a page that names no subject: the previous page's is never kept", () => {
    pathname = `/company/${HARBOURLINE}`;
    const { rerender } = render(
      <QSubjectProvider own={own}>
        <QPageSubject subject={{ ...feedCard, companyId: HARBOURLINE }} />
        <Subject />
      </QSubjectProvider>,
    );
    expect(screen.getByText(HARBOURLINE)).toBeTruthy();
    pathname = "/work";
    act(() => {
      rerender(
        <QSubjectProvider own={own}>
          <Subject />
        </QSubjectProvider>,
      );
    });
    expect(screen.getByText("own")).toBeTruthy();
  });
});

describe("an ambient page subject is never sent as a named subject", () => {
  it("sends no named company or organisation for the page's subject", () => {
    expect(namedSubject({ companyId: FEED_CARD, ambient: true })).toEqual({});
    expect(
      namedSubject({
        investorOrganisationId:
          own.kind === "INVESTOR_ORGANISATION"
            ? own.investorOrganisationId
            : "",
        ambient: true,
      }),
    ).toEqual({});
  });

  it("still names a subject the surface itself picked", () => {
    expect(namedSubject({ companyId: HARBOURLINE })).toEqual({
      companyId: HARBOURLINE,
    });
  });
});
