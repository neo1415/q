// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/features/team/team-actions", () => ({}));

import { UnsentInvites } from "../src/features/team/team-page";

/**
 * P15: when an invitation email does not go, the Team page says so in
 * plain words and offers the link to copy; nothing shows when every email
 * went.
 */

afterEach(() => {
  cleanup();
});

describe("UnsentInvites", () => {
  it("shows nothing when every email went", () => {
    const { container } = render(
      <UnsentInvites items={[]} onDismiss={() => undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("says the email didn't go and copies the link", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const link = "https://app.capitalq.example/join/tok_abc";
    render(
      <UnsentInvites
        items={[{ email: "peter@northbound.example", link }]}
        onDismiss={() => undefined}
      />,
    );
    expect(
      screen.getByText(/Couldn.t send the email — copy the invite link/u),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy invite link/u }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});
