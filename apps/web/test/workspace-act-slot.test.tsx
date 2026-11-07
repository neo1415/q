// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { registerActSlot } from "../src/features/workspace/act-slot";
import { QActPrompts } from "../src/features/q/control/q-act-prompts";
import {
  requestApproval,
  resetApprovalRequests,
} from "../src/features/q/control/approval-requests";

/**
 * Batch 8 (owner replay, replay-08): "Q prepared this for your approval"
 * floated over the Q pane's messages and the page. In the Q Workspace the
 * prompts are drawn in the Q pane's own slot, in its flow above its
 * controls; with no pane they keep their floating place.
 */
const SEND = {
  id: "button.send-questions",
  summary: () => "Send 3 questions to Babatunde Oyelaran",
  prepare: () => ({ To: "Babatunde Oyelaran", "Question 1": "Monthly burn?" }),
  execute: () => Promise.resolve("DONE" as const),
};

afterEach(() => {
  cleanup();
  registerActSlot(null);
  resetApprovalRequests();
});

describe("Q's approval prompt", () => {
  it("sits in the Q pane's slot, in its flow, when the workspace is on", async () => {
    render(
      <>
        <div data-testid="pane">
          <div data-testid="thread">messages</div>
          <div ref={registerActSlot} data-q-act-slot />
        </div>
        <QActPrompts />
      </>,
    );
    act(() => {
      requestApproval(SEND);
    });
    const card = await screen.findByRole("alertdialog", {
      name: "Q prepared this for your approval",
    });
    const slot = document.querySelector("[data-q-act-slot]");
    expect(slot?.contains(card)).toBe(true);
    const prompts = card.closest("[data-q-act-prompts]");
    expect(prompts?.getAttribute("data-q-act-prompts")).toBe("in-pane");
    expect(prompts?.className).not.toMatch(/\bfixed\b/u);
    // The exact payload is still shown in full.
    expect(screen.getByText("Babatunde Oyelaran")).toBeTruthy();
  });

  it("floats where there is no Q pane (workspace off), as before", async () => {
    render(<QActPrompts />);
    act(() => {
      requestApproval(SEND);
    });
    const card = await screen.findByRole("alertdialog", {
      name: "Q prepared this for your approval",
    });
    const prompts = card.closest("[data-q-act-prompts]");
    expect(prompts?.getAttribute("data-q-act-prompts")).toBe("floating");
    expect(prompts?.className).toMatch(/\bfixed\b/u);
  });
});

describe("on a phone", () => {
  it("floats over the page sheet and Q alike, even with a slot", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 860px"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      render(
        <>
          <div ref={registerActSlot} data-q-act-slot />
          <QActPrompts />
        </>,
      );
      act(() => {
        requestApproval(SEND);
      });
      const card = await screen.findByRole("alertdialog", {
        name: "Q prepared this for your approval",
      });
      expect(
        card
          .closest("[data-q-act-prompts]")
          ?.getAttribute("data-q-act-prompts"),
      ).toBe("floating");
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(window, "matchMedia");
      } else {
        Object.defineProperty(window, "matchMedia", original);
      }
    }
  });
});
