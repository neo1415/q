// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ConnectionStatusDto,
  IncomingConnectionRequestDto,
} from "@capital-q/contracts";

/**
 * Founder Connection Requests (ADR 0023). The founder's button shows
 * "sent" only from the server's answer, says the investor's own choice in
 * words when they take no requests, and retries with the same key; the
 * investor's inbox asks once what each answer means and never shows red.
 */

vi.mock("../src/features/network/connection-actions", () => ({
  requestConnectionAction: () => Promise.reject(new Error("injected")),
  answerConnectionRequestAction: () => Promise.reject(new Error("injected")),
}));

const { ConnectionRequest } =
  await import("../src/features/network/connection-request");
const { ConnectionRequestsInbox } =
  await import("../src/features/network/connection-requests-inbox");

configure({ asyncUtilTimeout: 8000 });
afterEach(() => cleanup());

const INVESTOR = "11111111-0000-4000-8000-000000000013";
const OPEN: ConnectionStatusDto = {
  canRequest: true,
  notAccepted: null,
  request: null,
};
const SENT = {
  interestId: "77777777-0000-4000-8000-000000000001",
  relationshipId: "88888888-0000-4000-8000-000000000001",
  investorOrganisationId: INVESTOR,
  requestedAt: "2026-09-29T10:00:00.000Z",
  response: "PENDING" as const,
  respondedAt: null,
  connection: null,
};

describe("ConnectionRequest", () => {
  it("asks once, then shows sent only from the server's answer", async () => {
    const send = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { request: SENT, deduplicated: false },
      }),
    );
    render(
      <ConnectionRequest
        investorOrganisationId={INVESTOR}
        investorName="Apex Ventures"
        status={OPEN}
        send={send}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Request connection" }));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a failed send with the same idempotency key", async () => {
    const keys: string[] = [];
    let calls = 0;
    const send = vi.fn((input: { idempotencyKey: string }) => {
      keys.push(input.idempotencyKey);
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? {
              ok: false as const,
              message: "Your request was not sent. Try again.",
              retryable: true,
            }
          : {
              ok: true as const,
              value: { request: SENT, deduplicated: true },
            },
      );
    });
    render(
      <ConnectionRequest
        investorOrganisationId={INVESTOR}
        investorName="Apex Ventures"
        status={OPEN}
        send={send}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Request connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("says the investor's own choice and offers no button when they take no requests", () => {
    render(
      <ConnectionRequest
        investorOrganisationId={INVESTOR}
        investorName="Apex Ventures"
        status={{ canRequest: false, notAccepted: "CLOSED", request: null }}
      />,
    );
    expect(screen.getByText(/isn't taking requests/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ConnectionRequestsInbox", () => {
  const ROW: IncomingConnectionRequestDto = {
    interestId: SENT.interestId,
    relationshipId: SENT.relationshipId,
    companyId: "22222222-0000-4000-8000-000000000001",
    companyName: "Ledgerfold",
    requestedAt: SENT.requestedAt,
    response: "PENDING",
    respondedAt: null,
    connection: null,
  };

  it("confirms, then shows connected from the server's answer", async () => {
    const answer = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          request: {
            ...ROW,
            response: "ACCEPTED" as const,
            respondedAt: "2026-09-29T11:00:00.000Z",
          },
          deduplicated: false,
        },
      }),
    );
    render(<ConnectionRequestsInbox items={[ROW]} answer={answer} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(answer).not.toHaveBeenCalled();
    const group = screen.getByRole("group", {
      name: "Accept Ledgerfold's request",
    });
    fireEvent.click(
      Array.from(group.querySelectorAll("button")).find(
        (button) => button.textContent === "Accept",
      ) as HTMLButtonElement,
    );
    expect(await screen.findByText(/Connected\./)).toBeTruthy();
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "ACCEPTED" }),
    );
  });

  it("offers no Accept on a request whose pair already matched", () => {
    const answer = vi.fn();
    render(
      <ConnectionRequestsInbox
        items={[ROW]}
        answer={answer}
        matchedCompanyIds={new Set([ROW.companyId])}
      />,
    );
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByText(/already connected with Ledgerfold/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the relationship" }),
    ).toBeTruthy();
    expect(answer).not.toHaveBeenCalled();
  });

  it("is an honest empty state when no founder has asked", () => {
    render(<ConnectionRequestsInbox items={[]} />);
    expect(screen.getByText("No requests from founders yet.")).toBeTruthy();
  });
});
