// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AccessUnavailable,
  EmptyState,
  ErrorState,
  InlineNotice,
  Progress,
} from "../src/components/states.js";
import {
  ContextIndicator,
  contextScopeLabel,
} from "../src/patterns/context-indicator.js";
import { QStateIndicator, qStateLabel } from "../src/patterns/q-state.js";
import { CONTEXT_SCOPES, Q_STATES } from "../src/tokens/index.js";

describe("ContextIndicator", () => {
  it("renders a distinct human label for every canonical scope and for unset", () => {
    const labels = new Set(CONTEXT_SCOPES.map(contextScopeLabel));
    expect(labels.size).toBe(CONTEXT_SCOPES.length);
    render(
      <ContextIndicator scope="relationship_shared" detail="Apex Ventures" />,
    );
    expect(screen.getByText(/Relationship shared/)).toBeTruthy();
    expect(screen.getByText(/Apex Ventures/)).toBeTruthy();
  });

  it("says plainly when no context exists rather than inventing one", () => {
    render(<ContextIndicator scope="unset" />);
    expect(screen.getByText("No context set")).toBeTruthy();
  });
});

describe("state patterns", () => {
  it("EmptyState is a labelled region with a heading and optional action", () => {
    render(
      <EmptyState
        title="Nothing here yet."
        description="Why."
        action={<a href="/x">Do</a>}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Nothing here yet." }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "Nothing here yet.",
    );
    expect(screen.getByRole("link", { name: "Do" })).toBeTruthy();
  });

  it("ErrorState is an alert with calm, specific copy", () => {
    render(
      <ErrorState
        title="This didn't load."
        description="The connection dropped."
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This didn't load.");
    expect(alert.textContent).toContain("The connection dropped.");
  });

  it("AccessUnavailable never says whether the resource exists", () => {
    render(<AccessUnavailable />);
    const text = screen.getByRole("region").textContent ?? "";
    expect(text).toContain("isn't available in your current context");
    expect(text).not.toMatch(/exists|not found|forbidden|private/i);
  });

  it("InlineNotice uses status for information and alert for danger", () => {
    const { rerender } = render(<InlineNotice tone="info">Note</InlineNotice>);
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(<InlineNotice tone="danger">Problem</InlineNotice>);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("Progress exposes its value and label", () => {
    render(<Progress label="Uploading deck" value={62} />);
    const bar = screen.getByRole("progressbar", { name: "Uploading deck" });
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
  });
});

describe("QStateIndicator", () => {
  it("labels every state in words, independent of motion or colour", () => {
    for (const state of Q_STATES) {
      expect(qStateLabel(state).length).toBeGreaterThan(0);
    }
    render(<QStateIndicator state="NEEDS_APPROVAL" />);
    expect(screen.getByRole("status").textContent).toContain(
      "Ready for your approval",
    );
  });
});
