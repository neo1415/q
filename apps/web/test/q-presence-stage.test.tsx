// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QArtifactIdSchema } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QPresenceStage } = await import("../src/features/q/q-presence-stage");
const { SHOWN_FOR_ANSWERS } = await import("../src/features/q/shown");
const { clearResultShelf } = await import("../src/features/q/result-shelf");

/**
 * The Q page's presence view (founder request 2026-10-03): Q's presence
 * and no transcript; an object Q shows appears over it and steps back
 * after a few answers; a waiting approval stays; "Shown recently" brings
 * an object back.
 */

afterEach(() => {
  cleanup();
  // INC-1: the per-tab shelf of shown sets is module state.
  clearResultShelf();
});

const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});

function answer(
  id: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"] = [],
): QTurn {
  return {
    kind: "Q",
    id,
    text,
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

const BRIEF = [
  {
    kind: "ARTIFACT_REFERENCE" as const,
    artifactId: QArtifactIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
    type: "INVESTMENT_BRIEF" as const,
    status: "READY" as const,
    title: "Acme brief",
  },
];

function stage(turns: readonly QTurn[], waiting?: React.ReactNode) {
  return (
    <QPresenceStage
      presence={(compact) => (
        <div data-testid="aperture" data-compact={String(compact)} />
      )}
      turns={turns}
      captions={false}
      caption={<p>CAPTION TEXT</p>}
      waiting={waiting}
    />
  );
}

/** n more exchanges after the given turns, with no object shown. */
function plus(turns: readonly QTurn[], n: number): readonly QTurn[] {
  const more: QTurn[] = [];
  for (let i = 0; i < n; i++) {
    more.push(person(`p-more-${String(i)}`, `Next question ${String(i)}`));
    more.push(answer(`q-more-${String(i)}`, `A spoken answer ${String(i)}`));
  }
  return [...turns, ...more];
}

const WITH_BRIEF: readonly QTurn[] = [
  person("p-1", "Make me a brief on Acme"),
  answer("q-1", "Here is the brief, ready to open.", BRIEF),
];

describe("the Q page's presence view", () => {
  it("renders Q's presence and no transcript", () => {
    const { container } = render(
      stage([
        person("p-1", "How is my raise going?"),
        answer("q-1", "Your raise is at its first close."),
      ]),
    );
    expect(screen.getByTestId("aperture")).toBeTruthy();
    // Nothing written on the page: no bubbles, no thread, no captions.
    expect(container.querySelector("[data-q-thread]")).toBeNull();
    expect(container.querySelector(".cq-q-bubble")).toBeNull();
    expect(screen.queryByText("CAPTION TEXT")).toBeNull();
    expect(screen.queryByText("How is my raise going?")).toBeNull();
    // Q's words reach a screen reader only.
    const said = container.querySelector("[data-q-said]");
    expect(said?.className).toContain("sr-only");
    expect(said?.textContent).toContain("Your raise is at its first close.");
  });

  it("shows captions only when the person turned them on", () => {
    render(
      <QPresenceStage
        presence={() => <div />}
        turns={WITH_BRIEF}
        captions
        caption={<p>CAPTION TEXT</p>}
      />,
    );
    expect(screen.getByText("CAPTION TEXT")).toBeTruthy();
  });

  it("shows an object over the presence, then steps it back after a few answers", () => {
    const { container, rerender } = render(stage(WITH_BRIEF));
    expect(container.querySelector('[data-q-shown="q-1"]')).not.toBeNull();
    expect(screen.getAllByText("Acme brief").length).toBeGreaterThan(0);

    rerender(stage(plus(WITH_BRIEF, SHOWN_FOR_ANSWERS - 1)));
    expect(container.querySelector('[data-q-shown="q-1"]')).not.toBeNull();

    rerender(stage(plus(WITH_BRIEF, SHOWN_FOR_ANSWERS)));
    expect(container.querySelector("[data-q-shown]")).toBeNull();
  });

  it("steps an object back when dismissed", async () => {
    const { container } = render(stage(WITH_BRIEF));
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss Acme brief" }),
    );
    expect(container.querySelector("[data-q-shown]")).toBeNull();
  });

  it("keeps a waiting approval reachable however many answers follow", () => {
    const waiting = <div data-testid="waiting">Needs you · Approve</div>;
    const { rerender } = render(stage(WITH_BRIEF, waiting));
    rerender(stage(plus(WITH_BRIEF, SHOWN_FOR_ANSWERS + 2), waiting));
    expect(screen.getByTestId("waiting")).toBeTruthy();
    expect(screen.getByText("Needs you · Approve")).toBeTruthy();
  });

  it("brings an object back from Shown recently", async () => {
    const later = plus(WITH_BRIEF, SHOWN_FOR_ANSWERS + 1);
    const { container } = render(stage(later));
    expect(container.querySelector("[data-q-shown]")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Shown recently/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Acme brief" }));
    expect(container.querySelector('[data-q-shown="q-1"]')).not.toBeNull();
  });

  it("keeps the presence on screen, small, with the object's title and Dismiss outside its scroll area", async () => {
    const showing = vi.fn();
    const { container } = render(
      <QPresenceStage
        presence={(compact) => (
          <div data-testid="aperture" data-compact={String(compact)} />
        )}
        turns={WITH_BRIEF}
        captions={false}
        caption={null}
        onShowingChange={showing}
      />,
    );
    // The presence is still rendered, compact, above the object.
    const aperture = screen.getByTestId("aperture");
    expect(aperture.dataset["compact"]).toBe("true");
    const shown = container.querySelector("[data-q-shown]");
    expect(
      aperture.compareDocumentPosition(shown as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Dismiss sits in the header, not inside the object's own scroll area,
    // so it is in view without scrolling; and it is a 44px target.
    const dismiss = screen.getByRole("button", { name: "Dismiss Acme brief" });
    expect(dismiss.closest("[data-q-shown-header]")).not.toBeNull();
    expect(dismiss.closest("[data-q-shown-body]")).toBeNull();
    expect(dismiss.className).toContain("min-h-11");
    expect(dismiss.className).toContain("min-w-11");
    expect(container.querySelector("[data-q-shown-body]")?.className).toContain(
      "overflow-y-auto",
    );
    expect(showing).toHaveBeenLastCalledWith(true);
    // Dismissed: the presence is full size again.
    await userEvent.click(dismiss);
    expect(screen.getByTestId("aperture").dataset["compact"]).toBe("false");
    expect(showing).toHaveBeenLastCalledWith(false);
  });
});
