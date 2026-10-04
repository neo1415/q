// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleConnectionDto } from "@capital-q/contracts";

/**
 * meetfix-57: Settings → Connections says plainly when Google ended the
 * connection, offers Reconnect, and the reconnect link from Q or a notice
 * starts the reconnect itself -- once, and only when something needs it.
 */

const state: { connection: GoogleConnectionDto; connects: number } = {
  connection: { status: "NOT_CONNECTED" },
  connects: 0,
};

vi.mock("@/features/integrations/integration-actions", () => ({
  readGmailConnection: () =>
    Promise.resolve({ ok: true, value: state.connection }),
  connectGmail: () => {
    state.connects += 1;
    // Not a real Google URL: the browser is never sent anywhere here.
    return Promise.resolve({ ok: false, message: "stopped in test" });
  },
  disconnectGmail: () => Promise.resolve({ ok: true, value: null }),
}));

const { GmailConnection } =
  await import("@/features/integrations/gmail-connection");

afterEach(() => {
  cleanup();
  state.connects = 0;
});

describe("Google on Settings → Connections", () => {
  it("shows a connection Google ended, with a Reconnect button", async () => {
    state.connection = {
      status: "REVOKED",
      revokedAt: "2026-10-03T20:13:00.000Z",
    };
    render(<GmailConnection />);
    expect(
      await screen.findByRole("button", { name: "Reconnect Google" }),
    ).toBeTruthy();
    expect(screen.getByText(/Disconnected by Google/)).toBeTruthy();
    expect(state.connects).toBe(0);
  });

  it("starts the reconnect once from the reconnect link", async () => {
    state.connection = { status: "REVOKED" };
    render(<GmailConnection reconnect />);
    await waitFor(() => {
      expect(state.connects).toBe(1);
    });
    await screen.findByText("stopped in test");
    expect(state.connects).toBe(1);
  });

  it("does nothing from the link when Google is connected", async () => {
    state.connection = {
      status: "CONNECTED",
      email: "zino@example.invalid",
      connectedAt: "2026-10-04T15:00:00.000Z",
    };
    render(<GmailConnection reconnect />);
    await screen.findByText(/Connected as/);
    expect(state.connects).toBe(0);
  });
});
