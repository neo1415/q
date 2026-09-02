// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NetworkStatus } from "../src/components/app-shell/network-status";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  setOnline(true);
  vi.useRealTimers();
});

describe("NetworkStatus", () => {
  it("stays out of the way while online", () => {
    setOnline(true);
    render(<NetworkStatus />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    expect(status.dataset["network"]).toBe("online");
  });

  it("announces offline calmly and recovers when the connection returns", () => {
    vi.useFakeTimers();
    setOnline(true);
    render(<NetworkStatus />);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status").textContent).toContain("Offline");
    expect(screen.getByRole("status").textContent).not.toMatch(/error|failed/i);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("status").textContent).toContain("Back online");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("starts offline when the browser already is", () => {
    setOnline(false);
    render(<NetworkStatus />);
    expect(screen.getByRole("status").dataset["network"]).toBe("offline");
  });
});
