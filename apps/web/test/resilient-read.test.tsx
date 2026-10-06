// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReadTimeoutError,
  backoffDelay,
  isNetworkFailure,
  retryWithBackoff,
  withTimeout,
} from "../src/pwa/resilient";
import {
  clearResilientCache,
  useResilientRead,
} from "../src/pwa/use-resilient-read";

const noSleep = () => Promise.resolve();

describe("backoffDelay", () => {
  it("grows exponentially and is capped, with full jitter", () => {
    expect(backoffDelay(0, 500, 8000, () => 1)).toBe(500);
    expect(backoffDelay(1, 500, 8000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 500, 8000, () => 1)).toBe(4000);
    expect(backoffDelay(10, 500, 8000, () => 1)).toBe(8000);
    expect(backoffDelay(3, 500, 8000, () => 0)).toBe(0);
    expect(backoffDelay(3, 500, 8000, () => 0.5)).toBe(2000);
  });
});

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects with ReadTimeoutError when no answer comes", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 1000);
    const check = expect(pending).rejects.toBeInstanceOf(ReadTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await check;
  });

  it("passes the answer through when it is in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe("isNetworkFailure", () => {
  it("treats transport failures as retryable and answers as final", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new ReadTimeoutError(10))).toBe(true);
    expect(
      isNetworkFailure(
        new Error("An unexpected response was received from the server."),
      ),
    ).toBe(true);
    expect(isNetworkFailure(new Error("This pitch is not available."))).toBe(
      false,
    );
    expect(isNetworkFailure("nope")).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("retries network failures and returns the first success", async () => {
    const read = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("ok");
    const phases: string[] = [];
    await expect(
      retryWithBackoff(read, {
        attempts: 3,
        sleep: noSleep,
        isOnline: () => true,
        onRetry: (phase) => phases.push(phase),
      }),
    ).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(3);
    expect(phases).toEqual(["retrying", "retrying"]);
  });

  it("gives up after the attempt budget with the last error", async () => {
    const read = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(
      retryWithBackoff(read, {
        attempts: 2,
        sleep: noSleep,
        isOnline: () => true,
      }),
    ).rejects.toThrow("Failed to fetch");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("never retries an answer", async () => {
    const read = vi.fn(() => Promise.reject(new Error("Not allowed.")));
    await expect(
      retryWithBackoff(read, {
        attempts: 5,
        sleep: noSleep,
        isOnline: () => true,
      }),
    ).rejects.toThrow("Not allowed.");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("waits for the connection while offline without spending attempts", async () => {
    let online = false;
    const waitForOnline = vi.fn(() => {
      online = true;
      return Promise.resolve();
    });
    const phases: string[] = [];
    const read = vi.fn(() => Promise.resolve(1));
    await expect(
      retryWithBackoff(read, {
        attempts: 1,
        isOnline: () => online,
        waitForOnline,
        onRetry: (phase) => phases.push(phase),
      }),
    ).resolves.toBe(1);
    expect(waitForOnline).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["offline"]);
  });

  it("times out a hung try and retries it", async () => {
    const read = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockReturnValueOnce(new Promise<never>(() => undefined))
      .mockResolvedValueOnce("second");
    await expect(
      retryWithBackoff(read, {
        attempts: 2,
        timeoutMs: 5,
        sleep: noSleep,
        isOnline: () => true,
      }),
    ).resolves.toBe("second");
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      retryWithBackoff(() => Promise.resolve(1), { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });
});

function Probe({
  id,
  read,
}: {
  readonly id: string;
  readonly read: () => Promise<string>;
}) {
  const result = useResilientRead(id, read, {
    attempts: 2,
    baseMs: 1,
    maxMs: 1,
  });
  return (
    <div>
      <span data-testid="status">{result.status}</span>
      <span data-testid="data">{result.data ?? "-"}</span>
      <span data-testid="stale">{String(result.stale)}</span>
      <button type="button" onClick={result.retry}>
        retry
      </button>
    </div>
  );
}

describe("useResilientRead", () => {
  afterEach(() => clearResilientCache());

  it("ends in failed with a retry instead of loading forever", async () => {
    const read = vi.fn(
      (): Promise<string> => Promise.reject(new TypeError("Failed to fetch")),
    );
    render(<Probe id="a" read={read} />);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.getByTestId("status").textContent).toBe("failed");
    expect(read).toHaveBeenCalledTimes(2);

    read.mockImplementation(() => Promise.resolve("back"));
    await act(async () => {
      screen.getByText("retry").click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("data").textContent).toBe("back");
  });

  it("shows the last value at once and revalidates (stale-while-revalidate)", async () => {
    const first = render(<Probe id="b" read={() => Promise.resolve("one")} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    first.unmount();

    let resolve: (value: string) => void = () => undefined;
    render(
      <Probe
        id="b"
        read={() =>
          new Promise<string>((r) => {
            resolve = r;
          })
        }
      />,
    );
    expect(screen.getByTestId("data").textContent).toBe("one");
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("stale").textContent).toBe("true");
    await act(async () => {
      resolve("two");
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.getByTestId("data").textContent).toBe("two");
    expect(screen.getByTestId("stale").textContent).toBe("false");
  });
});
