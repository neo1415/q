// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyRoute } from "@/auth/route-policy";
import {
  isActiveRoute,
  navigationGroupsFor,
} from "@/components/app-shell/navigation";
import { isAppRoute } from "@/features/q/control/app-routes";
import { WORK_DATA_ROOM_HREF, workTabs } from "@/features/work/work-tabs";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  context: vi.fn(),
}));
vi.mock("next/navigation", async (load) => ({
  ...(await load<typeof import("next/navigation")>()),
  redirect: mocks.redirect,
}));
vi.mock("@/features/q/context", () => ({
  resolveOwnContext: mocks.context,
}));

const { default: OwnDataRoomPage } =
  await import("../app/(app)/company/data-room/page");

const COMPANY = "5F1F7E2A-0C1D-4B5E-9A7F-2B3C4D5E6F70";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Owner 2026-10-15: a founder's data room and deck, easy to reach. */
describe("the founder's own data room entry", () => {
  it("is reached from the founder's Pitch tab under Work, and a protected app route", () => {
    // Owner 2026-10-18: no sidebar entry of its own; Work's Pitch tab (a
    // founder's only) links it, and Work stays current on it.
    const hrefs = (scope: "founder_private" | "investor_private") =>
      navigationGroupsFor(scope).flatMap((group) =>
        group.items.map((item) => item.href),
      );
    expect(hrefs("founder_private")).not.toContain("/company/data-room");
    expect(workTabs("COMPANY").map((tab) => tab.href)).toContain("/pitch");
    expect(workTabs("INVESTOR").map((tab) => tab.href)).not.toContain("/pitch");
    expect(WORK_DATA_ROOM_HREF).toBe("/company/data-room");
    expect(isActiveRoute("/company/data-room", "/work")).toBe(true);
    expect(isAppRoute("/company/data-room")).toBe(true);
    expect(classifyRoute("/company/data-room")).toBe("protected");
  });

  it("opens the founder's own company at the Data room tab, or the tab asked", async () => {
    mocks.context.mockResolvedValue({
      kind: "FOUNDER",
      companyId: COMPANY,
      label: "Tensorgate",
    });
    await expect(OwnDataRoomPage({})).rejects.toThrow(
      `NEXT_REDIRECT /company/${COMPANY.toLowerCase()}?tab=dataroom`,
    );
    await expect(
      OwnDataRoomPage({ searchParams: Promise.resolve({ tab: "deck" }) }),
    ).rejects.toThrow(`?tab=deck`);
    // An unknown tab, or another company's id in the URL, never moves it.
    await expect(
      OwnDataRoomPage({
        searchParams: Promise.resolve({ tab: "x", companyId: "other" }),
      }),
    ).rejects.toThrow(
      `NEXT_REDIRECT /company/${COMPANY.toLowerCase()}?tab=dataroom`,
    );
  });

  it("says what is true for an investor, a person not set up, and an outage", async () => {
    mocks.context.mockResolvedValueOnce({
      kind: "INVESTOR",
      investorOrganisationId: COMPANY,
    });
    render(await OwnDataRoomPage({}));
    expect(screen.getByText("Data rooms belong to companies")).toBeTruthy();
    cleanup();
    mocks.context.mockResolvedValueOnce({ kind: "NONE" });
    render(await OwnDataRoomPage({}));
    expect(screen.getByText("Set up your company first")).toBeTruthy();
    cleanup();
    mocks.context.mockResolvedValueOnce({ kind: "NONE", unavailable: true });
    render(await OwnDataRoomPage({}));
    expect(screen.getByText("Your data room couldn't open")).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
