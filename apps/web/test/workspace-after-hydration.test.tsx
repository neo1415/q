// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfterHydration } from "../src/features/workspace/after-hydration";

/**
 * W1 batch 6 (live hydration error #418): the Q pane hydrated after the
 * session store had restored the tab's conversation, so its HTML differed
 * from the server's. AfterHydration draws the pane's shape on the server
 * and while hydrating, and the browser-state panel right after.
 */
let browserTurns = 0;
function BrowserState() {
  // Server: 0 turns; the browser: what this tab restored.
  const [turns] = useState(() =>
    typeof window === "undefined" ? 0 : browserTurns,
  );
  return <section data-turns={String(turns)}>{turns} turns</section>;
}

describe("AfterHydration", () => {
  it("hydrates without a mismatch, then shows the browser's state", async () => {
    const tree = (
      <AfterHydration fallback={<div data-pending />}>
        <BrowserState />
      </AfterHydration>
    );
    const html = renderToString(tree);
    expect(html).toContain("data-pending");
    expect(html).not.toContain("turns");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    browserTurns = 15;
    const errors: unknown[] = [];
    await act(() => {
      hydrateRoot(container, tree, {
        onRecoverableError: (error) => errors.push(error),
      });
      return Promise.resolve();
    });
    expect(errors).toEqual([]);
    expect(
      container.querySelector("[data-turns]")?.getAttribute("data-turns"),
    ).toBe("15");
    container.remove();
  });
});
