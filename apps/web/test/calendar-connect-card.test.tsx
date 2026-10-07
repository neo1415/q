// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { performClientAction } from "../src/features/q/client-actions";

const connect = vi.fn((_returnTo: unknown) =>
  Promise.resolve({ ok: true as const, value: "https://accounts.example/o" }),
);

const refresh = vi.fn();
let status = "NOT_CONNECTED";
let calendar: "GRANTED" | "NOT_GRANTED" | undefined = undefined;
const readConnection = vi.fn(() =>
  Promise.resolve({
    ok: true as const,
    value: { status, ...(calendar === undefined ? {} : { calendar }) },
  }),
);

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ refresh }),
}));
vi.mock("../src/features/integrations/integration-actions", () => ({
  connectGoogleCalendar: (returnTo: unknown) => connect(returnTo),
  readGmailConnection: () => readConnection(),
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
  it("shows the suggested times as not checked; a blocked window falls back to this tab, back to this page", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null),
    );
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

  it("opens Google in a small window, the room stays, and shows the calendar connected when it finishes (W4b)", async () => {
    const popup = { location: { href: "" }, closed: false, close: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal("open", open);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    status = "NOT_CONNECTED";
    calendar = undefined;
    refresh.mockClear();
    render(<CalendarConnectCard intent={INTENT} />);
    // One read on arrival (is Google there without the calendar?).
    await vi.waitFor(() => {
      expect(readConnection).toHaveBeenCalled();
    });
    readConnection.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    );
    await vi.waitFor(() => {
      expect(popup.location.href).toBe("https://accounts.example/o");
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenLastCalledWith("/connected/google");
    expect(assign).not.toHaveBeenCalled();
    // A message from anywhere else is not the window's.
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://elsewhere.example",
        data: { type: "cq.google.connect", outcome: "connected" },
      }),
    );
    expect(readConnection).not.toHaveBeenCalled();
    // The window finishes; the server says the calendar is connected.
    status = "CONNECTED";
    calendar = "GRANTED";
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "cq.google.connect", outcome: "connected" },
      }),
    );
    await vi.waitFor(() => {
      expect(screen.getByText("Google Calendar connected")).toBeTruthy();
    });
    expect(refresh).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("believes the server, not the window: a 'connected' word without a connection is not shown as connected", async () => {
    const popup = { location: { href: "" }, closed: false, close: vi.fn() };
    vi.stubGlobal(
      "open",
      vi.fn(() => popup),
    );
    status = "NOT_CONNECTED";
    render(<CalendarConnectCard intent={INTENT} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Google Calendar" }),
    );
    await vi.waitFor(() => {
      expect(popup.location.href).not.toBe("");
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "cq.google.connect", outcome: "connected" },
      }),
    );
    await vi.waitFor(() => {
      expect(
        screen.getByText("Google Calendar isn't connected yet. Try again."),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Google Calendar connected")).toBeNull();
    vi.unstubAllGlobals();
  });

  // Deck wave 8: a connected Google account is not a connected calendar.
  it("Google connected without Calendar access: says so, never 'connected', and offers to reconnect", async () => {
    const popup = { location: { href: "" }, closed: false, close: vi.fn() };
    vi.stubGlobal(
      "open",
      vi.fn(() => popup),
    );
    status = "CONNECTED";
    calendar = "NOT_GRANTED";
    refresh.mockClear();
    readConnection.mockClear();
    render(<CalendarConnectCard intent={INTENT} />);
    // Said on arrival, before anything is clicked.
    await vi.waitFor(() => {
      expect(
        screen.getByText(
          "Google is connected but Calendar access wasn't granted — reconnect.",
        ),
      ).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect Google Calendar" }),
    );
    await vi.waitFor(() => {
      expect(popup.location.href).not.toBe("");
    });
    // Google again without the calendar: still not shown as connected.
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "cq.google.connect", outcome: "connected" },
      }),
    );
    await vi.waitFor(() => {
      expect(readConnection).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(
        screen.getByText(
          "Google is connected but Calendar access wasn't granted — reconnect.",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Google Calendar connected")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    calendar = undefined;
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
