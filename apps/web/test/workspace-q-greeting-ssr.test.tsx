// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * LCP (production 21 Nov 2026; owner approval 26 Nov): the Q pane's
 * greeting is the largest paint on /home and /settings in the Q Workspace.
 * The server now draws it in the pane's placeholder, so it paints with the
 * first HTML; the conversation replaces it once its code has loaded, and
 * there is never more than one greeting on screen.
 */

// The panel as the browser draws it for an empty conversation: the same
// greeting line, marked so the test can tell it from the placeholder's.
vi.mock("@/features/q/q-conversation", () => ({
  QConversationPanel: ({ greeting }: { readonly greeting?: string }) => (
    <p data-q-greeting data-from-panel>
      {greeting}
    </p>
  ),
}));
vi.mock("@/features/briefing/arrival-stage", () => ({
  ArrivalStage: () => null,
}));

// React's act() for the hydration test below.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { WorkspaceQPanel } =
  await import("../src/features/workspace/workspace-q-pane-lazy");
const { WorkspaceQPending } =
  await import("../src/features/workspace/workspace-q-pending");

const CONTEXT = {
  scope: "investor_private",
  label: "Harbour Ventures",
  suggestions: ["What is my mandate?", "What should I look at?"],
} as const;

function pane() {
  return (
    <WorkspaceQPanel
      workspace
      connected
      context={CONTEXT}
      greeting="What's on your mind today, Ada?"
    />
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the Q pane's greeting in the first HTML", () => {
  it("is in the server's placeholder, once, with the panel's markup", () => {
    const html = renderToString(pane());
    const host = document.createElement("div");
    host.innerHTML = html;
    const greetings = host.querySelectorAll("[data-q-greeting]");
    expect(greetings).toHaveLength(1);
    expect(greetings[0]?.textContent).toBe("What's on your mind today, Ada?");
    expect(greetings[0]?.className).toContain("cq-title-lg");
    expect(host.querySelector("[data-q-pane-pending]")).not.toBeNull();
    // Nothing interactive in the placeholder: the controls are the panel's.
    expect(host.querySelector("button, a, textarea, input")).toBeNull();
  });

  it("falls back to the default line when the server gave none", () => {
    const html = renderToString(
      <WorkspaceQPending connected={false} greeting={undefined} />,
    );
    expect(html).toContain("on your mind today?");
  });

  it("holds an empty line while the layout waits for who is here", () => {
    const html = renderToString(<WorkspaceQPending awaitingGreeting />);
    expect(html).not.toContain("data-q-greeting");
    expect(html).not.toContain("on your mind");
  });

  it("is replaced by the panel on hydration: no mismatch, exactly one greeting", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    host.innerHTML = renderToString(pane());
    document.body.append(host);
    await act(async () => {
      hydrateRoot(host, pane(), {
        onRecoverableError: (error) => {
          throw error;
        },
      });
      // The panel's code (the lazy import) lands inside act.
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-from-panel]")).not.toBeNull();
    });
    const greetings = host.querySelectorAll("[data-q-greeting]");
    expect(greetings).toHaveLength(1);
    expect(greetings[0]?.textContent).toBe("What's on your mind today, Ada?");
    expect(host.querySelector("[data-q-pane-pending]")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
