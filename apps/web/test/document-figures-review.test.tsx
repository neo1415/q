// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Owner 2026-10-28: a founder who finished setup sees the figures read by
 * code from their management accounts on the Documents page and the deck
 * tab, and keeps one there; the keep goes through the same suggestion
 * resolution as in setup, on their completed journey.
 */

const SESSION = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const SUGGESTION = "77777777-7777-4777-8777-777777777777";

const view = {
  session: { id: SESSION, status: "COMPLETED", version: 9 },
  pendingSuggestions: [
    {
      id: SUGGESTION,
      stepKey: "F5.monthly_revenue",
      targetField: "financial.monthly_revenue",
      suggestedValue: { type: "RANGE", value: "51000" },
      confidence: "0.9",
      status: "PENDING",
      createdAt: "2026-10-28T00:00:00.000Z",
      rationale: "From your management accounts “Q3 management accounts”",
      sourceRefs: [
        { sourceType: "EVIDENCE_DOCUMENT", sourceId: DOC },
        { sourceType: "EVIDENCE_DOCUMENT_VERSION", sourceId: DOC },
        {
          sourceType: "LOCAL_FIGURE",
          sourceId:
            "FINANCIAL_MEASURES_v1|monthly_revenue|MONTH:2026-09||USD|HIGH",
        },
        { sourceType: "LOCAL_FIGURE_CELL", sourceId: "p1|t1|r2|c3" },
      ],
    },
    {
      // Not a local figure: never shown here.
      id: "88888888-8888-4888-8888-888888888888",
      stepKey: "F1.description",
      targetField: "description",
      suggestedValue: { type: "TEXT", text: "Payroll" },
      confidence: null,
      status: "PENDING",
      createdAt: "2026-10-28T00:00:00.000Z",
      rationale: null,
      sourceRefs: [{ sourceType: "EVIDENCE_DOCUMENT", sourceId: DOC }],
    },
  ],
};

const resolve = vi.fn((_input: unknown) =>
  Promise.resolve({
    ok: true,
    value: { ...view, pendingSuggestions: [] },
  }),
);
vi.mock("@/features/onboarding-kit/api-actions", () => ({
  onboardingCurrentAction: () => Promise.resolve({ ok: true, value: view }),
  onboardingResolveSuggestionAction: (input: unknown) => resolve(input),
}));

const { DocumentFiguresReview } =
  await import("../src/features/documents/document-figures-review");

describe("figures ready for confirmation after setup", () => {
  it("lists them by document and keeps one on the completed journey", async () => {
    await act(async () => {
      await Promise.resolve();
      render(
        <DocumentFiguresReview
          documents={[{ id: DOC, title: "Q3 management accounts" }]}
        />,
      );
    });
    expect(
      screen.getByText(
        "1 figure from Q3 management accounts is ready for your confirmation",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/USD 51,000/u)).toBeTruthy();
    expect(screen.queryByText(/Payroll/u)).toBeNull();
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION,
        suggestionId: SUGGESTION,
        resolution: "ACCEPT",
        expectedSessionVersion: 9,
      }),
    );
    // Kept: nothing left to confirm, so the card is gone.
    expect(screen.queryByText(/ready for your confirmation/u)).toBeNull();
  });
});
