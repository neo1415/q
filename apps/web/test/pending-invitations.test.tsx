// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const accept = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true as const, value: {} }),
);
const decline = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true as const, value: { declined: true } }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
}));
vi.mock("../src/features/team/team-actions", () => ({
  acceptInvitationByIdAction: (...args: unknown[]) => accept(...args),
  declineInvitationAction: (...args: unknown[]) => decline(...args),
}));

import { PendingInvitationsList } from "../src/features/team/pending-invitations-list";

/**
 * F2: an invitation to the signed-in person's verified email, where they
 * land, with Accept and Decline. The list itself is matched on the server
 * (see the team service's tests, including another email seeing nothing);
 * here only the id is sent back.
 */

afterEach(() => {
  cleanup();
  push.mockClear();
  accept.mockClear();
  decline.mockClear();
});

const ID = "00000000-0000-4000-8000-0000000000e1";
const ITEM = {
  invitationId: ID,
  organisationName: "Northbound Capital",
  kind: "FIRM",
  role: "MEMBER",
  invitedByName: "Sara Kimani",
  expiresAt: "2026-10-20T10:00:00.000Z",
} as const;

describe("PendingInvitationsList", () => {
  it("shows nothing without invitations", () => {
    const { container } = render(<PendingInvitationsList items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("accepts by id and opens the team", async () => {
    render(<PendingInvitationsList items={[ITEM]} />);
    expect(
      screen.getByText(/Sara Kimani invited you to join Northbound Capital/u),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Join Northbound Capital" }),
      );
      await Promise.resolve();
    });
    expect(accept).toHaveBeenCalledWith(ID);
    expect(push).toHaveBeenCalledWith("/settings/team");
  });

  it("declines by id and drops it from the list", async () => {
    render(<PendingInvitationsList items={[ITEM]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Decline" }));
      await Promise.resolve();
    });
    expect(decline).toHaveBeenCalledWith(ID);
    expect(screen.queryByText(/Northbound Capital/u)).toBeNull();
  });
});
