// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FounderApplicationDto } from "@capital-q/contracts";

/**
 * gateqf-1: a founder's applications, each with what happened in words and
 * an icon, and how the investor's published rules stood when it was sent.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("../src/features/gateq/page/gateq-actions", () => ({
  claimAction: vi.fn(),
  claimEvidenceCompleteAction: vi.fn(),
  claimEvidenceUploadAction: vi.fn(),
  confirmClaimCodeAction: vi.fn(),
  searchClaimableAction: vi.fn(),
}));
vi.mock("../src/features/team/team-actions", () => ({
  askToJoinAction: vi.fn(),
}));

const views = await import("../src/features/gateq/page/founder-views");

afterEach(cleanup);

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const app = (
  n: number,
  over: Partial<FounderApplicationDto>,
): FounderApplicationDto => ({
  applicationId: id(n),
  fund: `Fund ${n}`,
  sentAt: "2026-10-12T09:00:00.000Z",
  status: "SENT",
  reasonCode: null,
  message: null,
  ...over,
});

const APPS = [
  app(1, {
    fund: "Meridian Seed",
    status: "REPLIED",
    message: "Could you share your retention by cohort?",
    investorOrganisationId: id(90),
    rules: [
      { label: "Pre-seed or seed", required: true, standing: "MEETS" },
      { label: "Based in Europe", required: false, standing: "DOES_NOT_MEET" },
    ],
  }),
  app(2, { fund: "Fieldstone Angels", replyBy: "2026-10-24", rules: [] }),
  app(3, {
    fund: "Arcbridge Ventures",
    status: "PASSED",
    reasonCode: "OUTSIDE_STAGE",
    message: "Too early for our Series A focus.",
  }),
];

function pick<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no row ${String(index)}`);
  return value;
}

describe("a founder's GateQ applications", () => {
  it("says what happened, in their exact words, never paraphrased", () => {
    expect(views.founderDetailWords(pick(APPS, 0))).toBe(
      "They wrote: “Could you share your retention by cohort?”",
    );
    expect(views.founderDetailWords(pick(APPS, 1))).toBe(
      "Reply promised by 24 Oct",
    );
    expect(views.founderDetailWords(app(4, {}))).toBe(
      "Sent. They haven't made a reply promise.",
    );
    expect(views.founderDetailWords(pick(APPS, 2))).toBe(
      "Passed with a reason. They got: “Too early for our Series A focus.”",
    );
    expect(
      views.stoodWords({ required: false, standing: "DOES_NOT_MEET" }),
    ).toBe("Not met, preferred");
  });

  it("lists each with its status in words, and opens how the rules stood", () => {
    render(<views.FounderApplications state="full" applications={APPS} />);
    expect(screen.getByText("They replied")).toBeTruthy();
    expect(screen.getByText("Waiting on them")).toBeTruthy();
    expect(screen.getByText("Passed with a reason")).toBeTruthy();
    expect(screen.getByText("Find investors who fit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Meridian Seed/ }));
    const sheet = screen.getByRole("dialog", { name: "Meridian Seed" });
    expect(sheet.textContent).toContain(
      "How their rules stood when you sent it",
    );
    expect(sheet.textContent).toContain("Met");
    expect(sheet.textContent).toContain("Not met, preferred");
    expect(sheet.textContent).toContain(
      "Their published bar, not their private thesis.",
    );
    expect(
      screen
        .getByRole("link", { name: "Answer in your messages" })
        .getAttribute("href"),
    ).toBe(`/relationships/investor/${id(90)}/messages`);
  });

  it("is honest when nothing was checked, or not recorded", () => {
    render(<views.FounderApplications state="full" applications={APPS} />);
    fireEvent.click(screen.getByRole("button", { name: /Fieldstone Angels/ }));
    expect(
      screen.getByText(
        "They had no published rules then, so nothing was checked.",
      ),
    ).toBeTruthy();
    cleanup();
    render(<views.FounderApplications state="full" applications={APPS} />);
    fireEvent.click(screen.getByRole("button", { name: /Arcbridge Ventures/ }));
    expect(screen.getByText("Not recorded for this application.")).toBeTruthy();
  });
});
