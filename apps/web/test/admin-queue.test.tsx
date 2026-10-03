// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
const notFound = vi.fn(() => {
  throw new Error("notFound");
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  notFound: () => notFound(),
  usePathname: () => "/admin/queue",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
let permissions: readonly string[] = [];
vi.mock("../src/features/admin/admin-context", () => ({
  adminContext: () =>
    Promise.resolve({
      session: {},
      me: { userId: "u1" },
      can: (permission: string) => permissions.includes(permission),
    }),
}));
const verificationRows = vi.fn<() => Promise<unknown>>();
const reviewRows = vi.fn<() => Promise<unknown>>();
vi.mock("@capital-q/api-client", () => ({
  getAdminVerificationQueue: () => verificationRows(),
  getAdminReviews: () => reviewRows(),
}));
vi.mock("../src/features/admin/verification-queue", () => ({
  VerificationQueue: ({ rows }: { rows: readonly unknown[] }) => (
    <p>verification rows {rows.length}</p>
  ),
}));
vi.mock("../src/features/admin/review-queue", () => ({
  ReviewQueue: ({ rows }: { rows: readonly unknown[] }) => (
    <p>review rows {rows.length}</p>
  ),
}));

const { default: AdminQueuePage } =
  await import("../app/(app)/admin/queue/page");
const { default: OldReviews } = await import("../app/(app)/admin/reviews/page");
const { default: OldVerification } =
  await import("../app/(app)/admin/verification/page");

afterEach(() => {
  cleanup();
  verificationRows.mockReset();
  reviewRows.mockReset();
});

const page = async (query: Record<string, string>) =>
  render(await AdminQueuePage({ searchParams: Promise.resolve(query) }));

describe("the merged admin queue (design-48)", () => {
  it("shows both queues as tabs with counts, verification first", async () => {
    permissions = ["verification.read", "reviews.read"];
    verificationRows.mockResolvedValue({ rows: [1, 2] });
    reviewRows.mockResolvedValue({ rows: [1, 2, 3] });
    await page({});
    expect(
      screen
        .getByRole("link", { name: "Verification 2" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("link", { name: "Reviews 3" })).toBeTruthy();
    expect(screen.getByText("verification rows 2")).toBeTruthy();
  });

  it("opens the reviews tab when asked", async () => {
    permissions = ["verification.read", "reviews.read"];
    verificationRows.mockResolvedValue({ rows: [] });
    reviewRows.mockResolvedValue({ rows: [1] });
    await page({ tab: "reviews" });
    expect(screen.getByText("review rows 1")).toBeTruthy();
  });

  it("reads only the queue the role may see", async () => {
    permissions = ["reviews.read"];
    reviewRows.mockResolvedValue({ rows: [] });
    await page({ tab: "verification" });
    expect(verificationRows).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Verification/u })).toBeNull();
    expect(screen.getByText("No reviews waiting")).toBeTruthy();
  });

  it("is not found for a role with neither", async () => {
    permissions = ["overview.read"];
    await expect(page({})).rejects.toThrow("notFound");
  });

  it("says a failed queue failed, not that it is empty", async () => {
    permissions = ["verification.read"];
    verificationRows.mockRejectedValue(new Error("down"));
    await page({});
    expect(screen.getByText("The queue couldn't load")).toBeTruthy();
  });

  it("redirects the old routes", async () => {
    await expect(
      OldReviews({ searchParams: Promise.resolve({ all: "1" }) }),
    ).rejects.toThrow("redirect:/admin/queue?tab=reviews&all=1");
    expect(() => OldVerification()).toThrow(
      "redirect:/admin/queue?tab=verification",
    );
  });
});
