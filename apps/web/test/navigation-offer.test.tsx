// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { QNavigationOfferBlock } from "@capital-q/contracts";

import { registerClientRouter } from "../src/features/q/client-actions";
import type { QTurn } from "../src/features/q/conversation";
import { resetNavigationLifecycle } from "../src/features/q/control/navigation-lifecycle";
import { followOfTurns } from "../src/features/q/follow-navigation";
import { resetSettledOffers } from "../src/features/q/navigation-offer-card";
import { QResultBlocks } from "../src/features/q/q-result-blocks";
import { loadWire } from "../src/features/q/wire";

/**
 * N1 (owner 2026-11-04): "Show me my investor pipeline" is answered in the
 * conversation and the pipeline is OFFERED. Open moves through the one
 * navigation lifecycle to the registered route; Stay settles the offer
 * without moving; a settled offer stays settled for that message.
 */

const OFFER: QNavigationOfferBlock = {
  kind: "NAVIGATION_OFFER",
  intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
  place: "Relationships",
  openLabel: "Open pipeline",
};

beforeAll(async () => {
  await loadWire();
}, 30_000);

let pushes: string[] = [];

function withRouter(): void {
  pushes = [];
  registerClientRouter((path) => pushes.push(path));
}

afterEach(() => {
  cleanup();
  registerClientRouter(null);
  resetNavigationLifecycle();
  resetSettledOffers();
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

describe("the offered page (N1)", () => {
  it("Open navigates to the registered pipeline route", () => {
    withRouter();
    render(<QResultBlocks blocks={[OFFER]} turnId="m-open" />);
    expect(screen.getByText("Relationships")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open pipeline" }));
    expect(pushes).toEqual(["/relationships?view=pipeline"]);
    // Done: the offer is not left on screen to be opened twice.
    expect(screen.queryByRole("button", { name: "Open pipeline" })).toBeNull();
  });

  it("Stay hides the offer and does not navigate, across re-render and remount", () => {
    withRouter();
    const { rerender, unmount } = render(
      <QResultBlocks blocks={[OFFER]} turnId="m-stay" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stay here" }));
    expect(pushes).toEqual([]);
    expect(screen.queryByRole("button", { name: "Open pipeline" })).toBeNull();
    rerender(<QResultBlocks blocks={[OFFER]} turnId="m-stay" />);
    expect(screen.queryByRole("button", { name: "Open pipeline" })).toBeNull();
    unmount();
    render(<QResultBlocks blocks={[OFFER]} turnId="m-stay" />);
    expect(screen.queryByRole("button", { name: "Open pipeline" })).toBeNull();
    // Another message's offer is its own.
    render(<QResultBlocks blocks={[OFFER]} turnId="m-other" />);
    expect(
      screen.getAllByRole("button", { name: "Open pipeline" }),
    ).toHaveLength(1);
    expect(pushes).toEqual([]);
  });

  it("is never followed as a move when the answer lands", () => {
    const turn: QTurn = {
      kind: "Q",
      id: "m-follow",
      text: "3 investors. Your full pipeline is in Relationships. Would you like to open it?",
      streaming: false,
      sourceCount: 0,
      publicSources: [],
      findings: [],
      uncertainties: [],
      blocks: [OFFER],
    };
    const followed = followOfTurns([turn], new Set());
    expect(followed.navigate).toBeNull();
    expect(followed.actions).toEqual([]);
  });
});
