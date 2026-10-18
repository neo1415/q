// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const read = vi.fn();
const rotate = vi.fn();
vi.mock("../src/features/integrations/integration-actions", () => ({
  readQEmailAddress: () => read() as Promise<unknown>,
  rotateQEmailAddress: (current: string) => rotate(current) as Promise<unknown>,
}));

import { QEmailAddress } from "../src/features/integrations/q-email-address";

/**
 * "Your Q email address" in Settings: shown with a copy button; a new
 * address asks once, names the address being replaced, and shows the new
 * one; an unconfigured deployment says so instead of offering a dead end.
 */

const OLD = "hash+aaaaaaaaaaaaaaaaaaaaaaaaaa@inbound.example.invalid";
const NEW = "hash+bbbbbbbbbbbbbbbbbbbbbbbbbb@inbound.example.invalid";

afterEach(() => {
  cleanup();
  read.mockReset();
  rotate.mockReset();
});

describe("QEmailAddress", () => {
  it("shows the address and copies it", async () => {
    read.mockResolvedValue({
      ok: true,
      value: { status: "ACTIVE", address: OLD },
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<QEmailAddress />);
    expect(await screen.findByText(OLD)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(OLD);
    expect(await screen.findByText("Copied.")).toBeTruthy();
  });

  it("asks before a new address, then names the old one and shows the new", async () => {
    read.mockResolvedValue({
      ok: true,
      value: { status: "ACTIVE", address: OLD },
    });
    rotate.mockResolvedValue({
      ok: true,
      value: { status: "ACTIVE", address: NEW },
    });
    render(<QEmailAddress />);
    await screen.findByText(OLD);
    fireEvent.click(screen.getByRole("button", { name: "New address" }));
    expect(rotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Get a new address" }));
    expect(await screen.findByText(NEW)).toBeTruthy();
    expect(rotate).toHaveBeenCalledWith(OLD);
  });

  it("says when receiving email is not available", async () => {
    read.mockResolvedValue({ ok: true, value: { status: "UNAVAILABLE" } });
    render(<QEmailAddress />);
    expect(
      await screen.findByText("Receiving email isn't available yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});
