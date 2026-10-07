// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { performClientAction } from "../src/features/q/client-actions";

const connect = vi.fn((_returnTo: unknown) =>
  Promise.resolve({ ok: true as const, value: "https://accounts.example/o" }),
);

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
}));
vi.mock("../src/features/integrations/integration-actions", () => ({
  connectGoogleCalendar: (returnTo: unknown) => connect(returnTo),
}));

const { CalendarConnectCard } =
  await import("../src/features/q/calendar-connect-card");

const INTENT = {
  kind: "SHOW_CALENDAR_CONNECT" as const,
  reason: "NOT_CONNECTED" as const,
  counterpartName: "Clearwater Pay",
  timeZone: "Europe/London",
  suggested: [
    {
      startsAt: "2026-10-13T09:00:00.000Z",
      endsAt: "2026-10-13T09:30:00.000Z",
      local: "Tue 13 Oct, 10:00",
    },
  ],
};

afterEach(cleanup);

describe("the calendar connect card (Q room R5)", () => {
  it("shows the suggested times as not checked, and connects back to this page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<CalendarConnectCard intent={INTENT} />);
    expect(screen.getByText("Tue 13 Oct, 10:00")).toBeTruthy();
    expect(screen.getByText("Not checked")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    );
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://accounts.example/o");
    });
    expect(connect).toHaveBeenCalledWith("/home");
    vi.unstubAllGlobals();
  });

  it("is never performed on its own as the answer arrives", () => {
    const effects = {
      setTheme: vi.fn(),
      reload: vi.fn(),
      openTab: vi.fn(() => true),
      setQMotion: vi.fn(),
      setVoice: vi.fn(),
      goTo: vi.fn(),
      screen: vi.fn(),
      openMaterial: vi.fn(),
      setDiscoverFilters: vi.fn(),
      signOut: vi.fn(),
    };
    expect(performClientAction(INTENT, effects)).toBe(true);
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });
});
