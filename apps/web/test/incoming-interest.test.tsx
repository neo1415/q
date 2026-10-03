// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IncomingInterestDto } from "@capital-q/contracts";

/**
 * The founder's inbox of investor interest (CQ-NET-011).
 *
 * Accept and Decline are server-confirmed: a row says connected or
 * declined only from the server's answer, asks once what the answer
 * means, never celebrates, never asks for a reason, and retries an
 * interrupted answer with the same idempotency key.
 */

vi.mock("../src/features/network/interest-actions", () => ({
  answerInterestAction: () => Promise.reject(new Error("injected per test")),
}));

const { IncomingInterest } =
  await import("../src/features/network/incoming-interest");

configure({ asyncUtilTimeout: 8000 });

afterEach(() => {
  cleanup();
});

const PENDING: IncomingInterestDto = {
  interestId: "77777777-0000-4000-8000-000000000001",
  investorOrganisationId: "11111111-0000-4000-8000-000000000013",
  investorName: "Apex Ventures",
  investorType: "VC",
  expressedAt: "2026-09-25T10:00:00.000Z",
  response: "PENDING",
  respondedAt: null,
  connection: null,
};

type Answer = {
  readonly interestId: string;
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly idempotencyKey: string;
};
type Result =
  | {
      readonly ok: true;
      readonly value: {
        readonly interest: IncomingInterestDto;
        readonly deduplicated: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly retryable: boolean;
    };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const accepted = (): Result => ({
  ok: true,
  value: {
    interest: {
      ...PENDING,
      response: "ACCEPTED",
      respondedAt: "2026-09-25T11:00:00.000Z",
      connection: {
        connectionId: "55555555-0000-4000-8000-000000000001",
        status: "ACTIVE",
        connectedAt: "2026-09-25T11:00:00.000Z",
      },
    },
    deduplicated: false,
  },
});

describe("an accepted interest, later", () => {
  it("says where the relationship stands now when it has moved on", () => {
    render(
      <IncomingInterest
        items={[{ ...PENDING, response: "ACCEPTED" }]}
        currentStates={
          new Map([[PENDING.investorOrganisationId, "IN_DILIGENCE" as const]])
        }
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Now: in diligence.",
    );
  });

  it("after accepting here, never shows the state from before the answer (QA run 8a1d57b9)", async () => {
    const port = vi.fn<(input: Answer) => Promise<Result>>(() =>
      Promise.resolve(accepted()),
    );
    render(
      <IncomingInterest
        items={[PENDING]}
        answer={port}
        currentStates={
          new Map([
            [PENDING.investorOrganisationId, "INTEREST_EXPRESSED" as const],
          ])
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    const line = await screen.findByText(
      "Connected. You and Apex Ventures have both agreed to connect.",
    );
    expect(line.textContent).not.toContain("Now:");
    expect(document.body.textContent ?? "").not.toMatch(/interest expressed/i);
  });
});

describe("the founder's inbox", () => {
  it("says so plainly when there is no interest", () => {
    render(<IncomingInterest items={[]} answer={vi.fn()} />);
    expect(screen.getByText("No investor interest yet.")).toBeTruthy();
  });

  it("accept asks first, shows accepting, and says connected only on the server's answer", async () => {
    const answer = deferred<Result>();
    const port = vi.fn<(input: Answer) => Promise<Result>>(
      () => answer.promise,
    );
    render(<IncomingInterest items={[PENDING]} answer={port} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/It is not an investment\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(
      await screen.findByRole("button", { name: "Accepting…" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Connected\./)).toBeNull();
    expect(port.mock.calls[0]?.[0]).toMatchObject({
      interestId: PENDING.interestId,
      decision: "ACCEPTED",
    });

    await act(async () => {
      answer.resolve(accepted());
      await answer.promise;
    });
    expect(
      await screen.findByText(
        "Connected. You and Apex Ventures have both agreed to connect.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/match!/i);
  });

  it("decline is neutral, carries no reason, and is said honestly", async () => {
    const port = vi.fn<(input: Answer) => Promise<Result>>(() =>
      Promise.resolve({
        ok: true,
        value: {
          interest: {
            ...PENDING,
            response: "DECLINED",
            respondedAt: "2026-09-25T11:00:00.000Z",
          },
          deduplicated: false,
        },
      }),
    );
    render(<IncomingInterest items={[PENDING]} answer={port} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(
      await screen.findByText(/No reason is recorded or shared\./),
    ).toBeTruthy();
    // Nowhere to type a reason.
    expect(document.querySelector("textarea, input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(
      await screen.findByText(
        /Declined\. Apex Ventures will see that this has not been taken forward/,
      ),
    ).toBeTruthy();
    expect(port.mock.calls[0]?.[0].decision).toBe("DECLINED");
  });

  it("retries an interrupted answer with the same key, and shows a refusal without claiming anything", async () => {
    const port = vi
      .fn<(input: Answer) => Promise<Result>>()
      .mockResolvedValueOnce({
        ok: false,
        message: "Your answer was not recorded. Try again.",
        retryable: true,
      })
      .mockResolvedValueOnce(accepted());
    render(<IncomingInterest items={[PENDING]} answer={port} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(
      await screen.findByText("Your answer was not recorded. Try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/Connected\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Connected\./)).toBeTruthy();
    expect(port.mock.calls[0]?.[0].idempotencyKey).toBe(
      port.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it("shows an interest already answered as the server recorded it, with no buttons", () => {
    render(
      <IncomingInterest
        items={[{ ...PENDING, response: "DECLINED" }]}
        answer={vi.fn()}
      />,
    );
    expect(screen.getByText(/Declined\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
