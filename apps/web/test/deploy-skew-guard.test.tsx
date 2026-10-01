// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeploySkewGuard } from "../src/pwa/deploy-skew-guard";

describe("deploy skew guard", () => {
  const realFetch = window.fetch.bind(window);
  afterEach(() => {
    window.fetch = realFetch;
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function setup(status: number) {
    window.fetch = vi.fn(() => Promise.resolve(new Response(null, { status })));
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });
    render(<DeploySkewGuard />);
    return reload;
  }

  it("reloads once when a server action answers 404", async () => {
    const reload = setup(404);
    await window.fetch("/x", {
      method: "POST",
      headers: { "Next-Action": "abc" },
    });
    await window.fetch("/x", {
      method: "POST",
      headers: { "Next-Action": "abc" },
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores ordinary 404s and successful actions", async () => {
    const reload = setup(404);
    await window.fetch("/missing");
    expect(reload).not.toHaveBeenCalled();
  });
});
