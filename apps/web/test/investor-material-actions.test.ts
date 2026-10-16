import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fund deck is filed with a firm, never under a founder's company. */
const getMyOrganisations = vi.fn();
vi.mock("@capital-q/api-client", () => ({
  getMyOrganisations: (...a: unknown[]) => getMyOrganisations(...a) as unknown,
}));
vi.mock("../src/features/q/context", () => ({
  apiSession: () => Promise.resolve({ baseUrl: "x", accessToken: "t" }),
}));
const target = vi.fn(() => Promise.resolve({ ok: true, value: {} }));
const list = vi.fn();
vi.mock("../src/features/onboarding-kit/material-actions", () => ({
  materialUploadTargetAction: (...a: unknown[]) =>
    target(...(a as [])) as unknown,
  materialUploadCompleteAction: vi.fn(),
  materialListAction: () => list() as unknown,
}));

const { investorMaterialTargetAction, investorMaterialListAction } =
  await import("../src/features/investor-onboarding/investor-material-actions");

const input = {
  documentType: "FUND_DECK",
  filename: "deck.pdf",
  mimeType: "application/pdf",
  sizeBytes: 10,
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
};
const org = (kind: "FIRM" | "COMPANY", active: boolean) => ({ kind, active });

beforeEach(() => {
  target.mockClear();
  list.mockReset();
});

describe("investor materials actions", () => {
  it("files in the firm's workspace with no company", async () => {
    getMyOrganisations.mockResolvedValue({
      items: [org("COMPANY", false), org("FIRM", true)],
    });
    expect((await investorMaterialTargetAction(input)).ok).toBe(true);
    expect(target).toHaveBeenCalledWith(input);
  });

  it("refuses while the person acts for a company (dual membership, no crossover)", async () => {
    getMyOrganisations.mockResolvedValue({
      items: [org("COMPANY", true), org("FIRM", false)],
    });
    const out = await investorMaterialTargetAction(input);
    expect(out.ok).toBe(false);
    expect(target).not.toHaveBeenCalled();
  });

  it("accepts only investor material types", async () => {
    await expect(
      investorMaterialTargetAction({
        ...input,
        documentType: "FINANCIAL_MODEL",
      }),
    ).rejects.toThrow();
  });

  it("lists only the firm's investor materials", async () => {
    getMyOrganisations.mockResolvedValue({ items: [org("FIRM", true)] });
    list.mockResolvedValue({
      ok: true,
      value: [
        { id: "a", documentType: "LP_LETTER" },
        { id: "b", documentType: "PITCH_DECK" },
      ],
    });
    const out = await investorMaterialListAction();
    expect(out.ok && out.value.map((f) => f.id)).toEqual(["a"]);
  });
});
