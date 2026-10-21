// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QMessageIdSchema } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QAnswer } = await import("../src/features/q/q-answer");
const { renderedObject, clearRendered } =
  await import("../src/features/q/artifact-rendered-store");

/**
 * Artifacts live in the thread (Chat view, the Q sheet), round 3.
 * L-3: while Q is still talking, the frame for what it named is up under
 * its words; the answer's own blocks take its place when it settles.
 * L-11: a settled answer's inline blocks count as drawn here, as on the
 * Q stage, so "as the table shows" stands; a streaming one does not.
 */

const RUN = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const MSG = QMessageIdSchema.parse("8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d");

const TABLE = {
  kind: "TABLE" as const,
  title: "Portside and Souqsheet side by side",
  columns: [
    { label: "Portside", subject: null },
    { label: "Souqsheet", subject: null },
  ],
  rows: [{ label: "Stage", cells: ["Seed", "Pre-seed"] }],
};

function turn(
  overrides: Partial<Extract<QTurn, { kind: "Q" }>>,
): Extract<QTurn, { kind: "Q" }> {
  return {
    kind: "Q",
    id: "q-1",
    runId: RUN,
    text: "Souqsheet is the closer fit.",
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks: [],
    ...overrides,
  };
}

const PREVIEW = {
  messageId: MSG,
  layout: "TABLE" as const,
  subjects: [
    { subject: null, kind: "ORGANISATION" as const, name: "Portside" },
    { subject: null, kind: "ORGANISATION" as const, name: "Souqsheet" },
  ],
};

afterEach(() => {
  cleanup();
  clearRendered();
});

describe("L-3: the live preview in the thread", () => {
  it("puts the named frame up under Q's words while it is still talking", () => {
    const { container } = render(
      <QAnswer
        turn={turn({ streaming: true, preview: PREVIEW })}
        mark={false}
      />,
    );
    const frame = container.querySelector("[data-q-preview]");
    expect(frame?.getAttribute("data-q-preview-layout")).toBe("TABLE");
    expect(frame?.getAttribute("aria-busy")).toBe("true");
    expect(frame?.textContent).toContain("Portside");
    expect(frame?.textContent).toContain("Souqsheet");
  });

  it("gives way to the answer's own blocks when it settles", () => {
    const { container } = render(
      <QAnswer
        turn={turn({ streaming: false, preview: PREVIEW, blocks: [TABLE] })}
        mark={false}
      />,
    );
    expect(container.querySelector("[data-q-preview]")).toBeNull();
    expect(container.querySelector("[data-q-table]")).not.toBeNull();
  });
});

describe("L-11: what the thread has drawn", () => {
  it("reports a settled answer's inline blocks as drawn for its run", () => {
    render(<QAnswer turn={turn({ blocks: [TABLE] })} mark={false} />);
    expect(renderedObject()).toEqual({ run: RUN, kinds: ["TABLE"] });
  });

  it("reports nothing while the answer is still streaming", () => {
    render(
      <QAnswer
        turn={turn({ streaming: true, blocks: [TABLE] })}
        mark={false}
      />,
    );
    expect(renderedObject()).toBeNull();
  });

  it("clears its report when the answer leaves the page", () => {
    const { unmount } = render(
      <QAnswer turn={turn({ blocks: [TABLE] })} mark={false} />,
    );
    expect(renderedObject()).not.toBeNull();
    unmount();
    expect(renderedObject()).toBeNull();
  });
});
