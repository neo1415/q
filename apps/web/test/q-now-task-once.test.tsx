// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQStreamState } from "@capital-q/api-client";

const { QNow } = await import("../src/features/q/q-now");

/**
 * live5 d (2026-11-04): while a plan was drafted the stage showed its
 * Working list ("Looking at the company") and, under it, a separate
 * "Now · Looking at the company" chip. The step is said once.
 */
function session() {
  return {
    q: {
      working: true,
      state: { ...createQStreamState(), approval: null, proposals: [] },
      stop: vi.fn(),
      approve: vi.fn(),
      decline: vi.fn(),
      revised: vi.fn(),
    },
    turns: [],
    voice: { active: false, turn: null },
    presence: { detail: "Looking at the company", stage: null },
    act: vi.fn(),
  } as never;
}

afterEach(cleanup);

describe("Now beside the Working list", () => {
  it("does not repeat the step the Working list already shows", () => {
    const { container } = render(
      <QNow
        session={session()}
        onAct={() => undefined}
        quietWhenIdle
        withStop={false}
        taskShownElsewhere
      />,
    );
    expect(container.querySelector("[data-q-now-task]")).toBeNull();
    expect(screen.queryByText("Looking at the company")).toBeNull();
  });

  it("still says what Q is doing where nothing else does", () => {
    render(
      <QNow
        session={session()}
        onAct={() => undefined}
        quietWhenIdle
        withStop={false}
      />,
    );
    expect(screen.getByText("Looking at the company")).not.toBeNull();
  });
});
