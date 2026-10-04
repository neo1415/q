// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FictionalNames,
  hydratedByReact,
  stripFictionalMarks,
  withoutFictionalMark,
} from "@/components/app-shell/fictional-names";

afterEach(cleanup);

describe("fictional names (demo audit 2026-10-03)", () => {
  it("drops the mark from a name, and only the mark", () => {
    expect(withoutFictionalMark("Savanna Seed Partners (fictional)")).toBe(
      "Savanna Seed Partners",
    );
    expect(withoutFictionalMark("Ledgerfold")).toBe("Ledgerfold");
  });

  it("shows names without it and says so once, at the foot of the page", async () => {
    render(
      <main>
        <h1>Savanna Seed Partners (fictional)</h1>
        <p>Lagoon Angels Circle (fictional) declined.</p>
        <textarea defaultValue="Kept as typed (fictional)" />
        <FictionalNames />
      </main>,
    );
    await act(async () => {});
    expect(screen.getByRole("heading").textContent).toBe(
      "Savanna Seed Partners",
    );
    expect(screen.getByText("Lagoon Angels Circle declined.")).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      "Kept as typed (fictional)",
    );
    expect(document.querySelectorAll("[data-fictional-note]")).toHaveLength(1);
  });

  it("works outside the app shell too (onboarding)", async () => {
    render(
      <div data-fictional-scope>
        <p>Savanna Seed Partners (fictional)</p>
        <FictionalNames />
      </div>,
    );
    await act(async () => {});
    expect(screen.getByText("Savanna Seed Partners")).toBeTruthy();
    expect(document.querySelectorAll("[data-fictional-note]")).toHaveLength(1);
  });

  it("says nothing on a page with no marked name", async () => {
    render(
      <main>
        <h1>Ledgerfold</h1>
        <FictionalNames />
      </main>,
    );
    await act(async () => {});
    expect(document.querySelector("[data-fictional-note]")).toBeNull();
  });
});

/**
 * QA demo pass: React error #418 on Capital, Rehearsals, interest, a
 * company profile and Discover. The shell hydrated first; the names were
 * stripped in streamed HTML React had not hydrated yet, so its text no
 * longer matched the server's. Text React has not taken over is left.
 */
describe("never ahead of hydration", () => {
  it("leaves server HTML React has not hydrated, and strips it once React has", () => {
    const host = document.createElement("main");
    host.innerHTML =
      "<h3 id='server'>Savanna Seed Partners (fictional)</h3><h3 id='react'>Lagoon Angels Circle (fictional)</h3>";
    document.body.append(host);
    const server = host.querySelector("#server");
    const react = host.querySelector("#react");
    // What React leaves on an element it has hydrated or rendered.
    Object.assign(react ?? {}, { __reactFiber$test: {} });
    expect(hydratedByReact(server)).toBe(false);
    expect(hydratedByReact(react)).toBe(true);
    stripFictionalMarks(host);
    expect(server?.textContent).toBe("Savanna Seed Partners (fictional)");
    expect(react?.textContent).toBe("Lagoon Angels Circle");
    // Hydrated now: the next sweep takes it.
    Object.assign(server ?? {}, { __reactFiber$test: {} });
    stripFictionalMarks(host);
    expect(server?.textContent).toBe("Savanna Seed Partners");
    host.remove();
  });
});
