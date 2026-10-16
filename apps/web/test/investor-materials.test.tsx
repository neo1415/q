// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../src/features/investor-onboarding/investor-material-actions",
  () => ({
    investorMaterialListAction: vi.fn(),
    investorMaterialTargetAction: vi.fn(),
    investorMaterialCompleteAction: vi.fn(),
  }),
);

const { InvestorMaterials } =
  await import("../src/features/investor-onboarding/investor-materials");

/**
 * Owner directive 2026-10-16: an optional fund deck, thesis or LP letter in
 * investor setup, filed as the firm's own document through the ordinary
 * upload, never a gate.
 */
afterEach(cleanup);

const deck = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "Fund II deck.pdf",
  kindLabel: "Fund deck",
  documentType: "FUND_DECK",
  state: "received" as const,
  stateLabel: "Waiting to be read",
};

function ports(overrides: Record<string, unknown> = {}) {
  let listed: (typeof deck)[] = [];
  return {
    list: vi.fn(() => Promise.resolve({ ok: true as const, value: listed })),
    target: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          uploadSessionId: "22222222-2222-4222-8222-222222222222",
          documentId: deck.id,
          url: "https://storage.example.invalid/put",
          method: "PUT",
          headers: { "content-type": "application/pdf" },
        },
      }),
    ),
    put: vi.fn(() => Promise.resolve({ ok: true })),
    complete: vi.fn(() => {
      listed = [deck];
      return Promise.resolve({
        ok: true as const,
        value: { documentId: deck.id },
      });
    }),
    ...overrides,
  };
}

const pdf = () =>
  new File(["%PDF-1.7"], "Fund II deck.pdf", { type: "application/pdf" });

describe("investor materials in setup", () => {
  it("waits, in one line, until the firm exists", () => {
    const p = ports();
    render(<InvestorMaterials firmReady={false} ports={p as never} />);
    expect(screen.getByText(/Once your firm is named/)).toBeTruthy();
    expect(p.list).not.toHaveBeenCalled();
  });

  it("uploads a fund deck as the firm's document and shows its real state", async () => {
    const p = ports();
    render(<InvestorMaterials firmReady ports={p as never} />);
    await userEvent.click(
      screen.getByText(/Add a fund deck, thesis or LP letter/),
    );
    const input = document.querySelector<HTMLInputElement>(
      "[data-investor-materials-input]",
    );
    if (input === null) throw new Error("no file input");
    await userEvent.upload(input, pdf());
    await waitFor(() =>
      expect(screen.getByText("Fund II deck.pdf")).toBeTruthy(),
    );
    expect(p.target).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "FUND_DECK",
        filename: "Fund II deck.pdf",
      }),
    );
    // The completion reuses the target's idempotency key.
    const key = (
      p.target.mock.calls[0] as unknown as [{ idempotencyKey: string }]
    )[0].idempotencyKey;
    expect(p.complete).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      key,
    );
    expect(screen.getByText("Waiting to be read")).toBeTruthy();
  });

  it("says why when the active workspace is not a firm, and stores nothing", async () => {
    const p = ports({
      target: vi.fn(() =>
        Promise.resolve({
          ok: false,
          kind: "REJECTED",
          message:
            "Switch to your firm's workspace first, so this is filed with the firm and not with a company.",
        }),
      ),
    });
    render(<InvestorMaterials firmReady ports={p as never} />);
    await userEvent.click(screen.getByText(/Add a fund deck/));
    const input = document.querySelector<HTMLInputElement>(
      "[data-investor-materials-input]",
    );
    if (input === null) throw new Error("no file input");
    await userEvent.upload(input, pdf());
    await waitFor(() =>
      expect(screen.getByText(/Switch to your firm's workspace/)).toBeTruthy(),
    );
    expect(p.put).not.toHaveBeenCalled();
    expect(p.complete).not.toHaveBeenCalled();
  });

  it("refuses an unreadable kind of file before uploading", async () => {
    const p = ports();
    render(<InvestorMaterials firmReady ports={p as never} />);
    await userEvent.click(screen.getByText(/Add a fund deck/));
    const input = document.querySelector<HTMLInputElement>(
      "[data-investor-materials-input]",
    );
    if (input === null) throw new Error("no file input");
    await userEvent.upload(
      input,
      new File(["x"], "fund.zip", { type: "application/zip" }),
      { applyAccept: false },
    );
    expect(screen.getByText(/We can't read fund.zip yet/)).toBeTruthy();
    expect(p.target).not.toHaveBeenCalled();
  });
});
