// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelationshipSideDetailsRead } from "@capital-q/contracts";

vi.mock("@/features/relationships/pipeline-import-actions", () => ({
  readSideDetailsAction: vi.fn(),
  updateSideDetailsAction: vi.fn(),
}));

const { RelationshipSideDetailsCard, groupedAmount, sideDetailsRequest } =
  await import("@/features/relationships/relationship-side-details");

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const READ: RelationshipSideDetailsRead = {
  details: {
    relationshipId: id(1),
    side: "INVESTOR",
    stage: "DILIGENCE",
    stageLabel: "Deep dive",
    owner: { membershipId: id(2), name: "Ada Obi" },
    source: "Warm intro",
    introducerName: null,
    introducerEmail: null,
    expected: { amount: "500000", currency: "USD" },
    priority: "HIGH",
    revision: 3,
    updatedAt: "2026-11-18T10:00:00.000Z",
    visibility: "organisation_private",
  },
  members: [
    { membershipId: id(2), name: "Ada Obi" },
    { membershipId: id(3), name: "Kwame Mensah" },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the side's own pipeline fields on a record (decision 106 gaps)", () => {
  it("shows what the side set, money exact, and Not set for the rest", () => {
    render(
      <RelationshipSideDetailsCard
        relationshipId={id(1)}
        side="INVESTOR"
        read={{ kind: "READ", value: READ }}
      />,
    );
    expect(screen.getByText("Diligence")).toBeDefined();
    expect(screen.getByText("Ada Obi")).toBeDefined();
    expect(screen.getByText("USD 500,000")).toBeDefined();
    expect(screen.getByText("Expected ticket")).toBeDefined();
    expect(screen.getAllByText("Not set")).toHaveLength(1);
  });

  it("saves only what changed, over the revision it was read at", async () => {
    const save = vi.fn((input: { request: Record<string, unknown> }) =>
      Promise.resolve({
        ok: true as const,
        value: {
          ...READ.details,
          owner: { membershipId: id(3), name: "Kwame Mensah" },
          priority: "LOW" as const,
          revision: 4,
        },
        input,
      }),
    );
    render(
      <RelationshipSideDetailsCard
        relationshipId={id(1)}
        side="INVESTOR"
        read={{ kind: "READ", value: READ }}
        ops={{ save, reload: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Deal owner"), {
      target: { value: id(3) },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "LOW" },
    });
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("Saved.");
    expect(save).toHaveBeenCalledWith({
      relationshipId: id(1),
      request: { revision: 3, ownerMembershipId: id(3), priority: "LOW" },
    });
    expect(screen.getByText("Kwame Mensah")).toBeDefined();
  });

  it("reads again when a colleague saved first, keeping the person's place", async () => {
    const save = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        conflict: true,
        message:
          "Someone on your side changed these just now. Reload to see the latest.",
      }),
    );
    const reload = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { ...READ, details: { ...READ.details, revision: 5 } },
      }),
    );
    render(
      <RelationshipSideDetailsCard
        relationshipId={id(1)}
        side="INVESTOR"
        read={{ kind: "READ", value: READ }}
        ops={{ save, reload }}
      />,
    );
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "MEDIUM" },
    });
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText(/Someone on your side changed these/u);
    expect(reload).toHaveBeenCalledWith(id(1));
  });

  it("never sends an amount that is not exact", () => {
    const draft = {
      stage: "DILIGENCE" as const,
      owner: id(2),
      source: "Warm intro",
      introducerName: "",
      introducerEmail: "",
      amount: "1,500,000.50",
      currency: "EUR",
      priority: "HIGH" as const,
    };
    expect(sideDetailsRequest(READ.details, draft)).toEqual({
      revision: 3,
      expected: { amount: "1500000.50", currency: "EUR" },
    });
    expect(
      sideDetailsRequest(READ.details, { ...draft, amount: "1.5e6" }),
    ).toBeNull();
    expect(sideDetailsRequest(READ.details, { ...draft, amount: "" })).toEqual({
      revision: 3,
      expected: null,
    });
    expect(groupedAmount("1500000.5")).toBe("1,500,000.5");
  });

  it("says plainly when the fields could not be read", () => {
    render(
      <RelationshipSideDetailsCard
        relationshipId={id(1)}
        side="COMPANY"
        read={{ kind: "UNAVAILABLE" }}
      />,
    );
    expect(
      screen.getByText(
        "Your pipeline fields couldn't be read just now. They are unchanged.",
      ),
    ).toBeDefined();
  });
});
