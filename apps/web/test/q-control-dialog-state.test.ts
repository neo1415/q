// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { stateOf } from "../src/features/q/control/registry";

/**
 * Live 2026-10-17 (conversation 971c5a53): every screen manifest said the
 * notifications dialog was OPEN while it was closed. Its control is
 * registered on a `display: contents` wrapper around the dialog's root;
 * the wrapper has no state of its own, so it fell through to "a dialog is
 * open". The wrapper's own trigger now says.
 */

function wrapper(expanded: string | null, className = "contents") {
  const span = document.createElement("span");
  span.className = className;
  const trigger = document.createElement("button");
  if (expanded !== null) trigger.setAttribute("aria-expanded", expanded);
  span.append(trigger);
  return span;
}

describe("a dialog control on a layout-less wrapper", () => {
  it("is CLOSED while its trigger is not expanded", () => {
    expect(stateOf("DIALOG", wrapper("false"))).toBe("CLOSED");
  });

  it("is OPEN once its trigger is expanded", () => {
    expect(stateOf("DIALOG", wrapper("true"))).toBe("OPEN");
  });

  it("a dialog element registered on itself is still open while mounted", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inner = document.createElement("button");
    // A disclosure inside the dialog is never read as the dialog.
    inner.setAttribute("aria-expanded", "false");
    dialog.append(inner);
    expect(stateOf("DIALOG", dialog)).toBe("OPEN");
  });

  it("a wrapper whose trigger declares nothing keeps the dialog default", () => {
    expect(stateOf("DIALOG", wrapper(null))).toBe("OPEN");
  });
});
