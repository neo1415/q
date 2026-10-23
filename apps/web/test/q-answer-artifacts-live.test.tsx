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

describe("round 5: objects first, words as caption", () => {
  const PICTURE = {
    kind: "PICTURE" as const,
    url: "https://images.pexels.com/photos/1/p.jpeg",
    alt: "A baobab tree",
    credit: { name: "Ada Obi", url: null },
    source: "PEXELS" as const,
    pageUrl: "https://www.pexels.com/photo/baobab-1/",
  };
  const before = (a: Element | null, b: Element | null) =>
    a !== null &&
    b !== null &&
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("puts the live preview above Q's streaming words, and the working line above both", () => {
    const { container } = render(
      <QAnswer
        turn={turn({
          streaming: true,
          preview: PREVIEW,
          text: "Souqsheet is the closer fit.",
        })}
        mark={false}
        working={<p data-working-slot>Comparing Portside and Souqsheet</p>}
      />,
    );
    const slot = container.querySelector("[data-working-slot]");
    const frame = container.querySelector("[data-q-preview]");
    const words = container.querySelector("[data-q-markdown]");
    expect(before(slot, frame)).toBe(true);
    expect(before(frame, words)).toBe(true);
  });

  it("keeps the table above the words when settled, and other blocks below", () => {
    const { container } = render(
      <QAnswer turn={turn({ blocks: [TABLE, PICTURE] })} mark={false} />,
    );
    const table = container.querySelector("[data-q-table]");
    const words = container.querySelector("[data-q-markdown]");
    const picture = container.querySelector("[data-q-picture]");
    expect(before(table, words)).toBe(true);
    expect(before(words, picture)).toBe(true);
  });

  it("leaves a picture to the stage that draws it, and keeps it where there is none (owner 2026-10-23)", () => {
    const onStage = render(
      <QAnswer
        turn={turn({ blocks: [PICTURE] })}
        mark={false}
        picturesInline={false}
      />,
    );
    expect(onStage.container.querySelector("[data-q-picture]")).toBeNull();
    cleanup();
    const plain = render(
      <QAnswer turn={turn({ blocks: [PICTURE] })} mark={false} />,
    );
    expect(plain.container.querySelector("[data-q-picture]")).not.toBeNull();
  });

  it("keeps the working line's place after an answer that streamed here lands", () => {
    const working = <p data-working-slot>{" "}</p>;
    const { container, rerender } = render(
      <QAnswer
        turn={turn({ streaming: true, text: "" })}
        mark={false}
        working={working}
      />,
    );
    expect(container.querySelector("[data-working-slot]")).not.toBeNull();
    rerender(
      <QAnswer
        turn={turn({ streaming: false })}
        mark={false}
        working={working}
      />,
    );
    expect(container.querySelector("[data-working-slot]")).not.toBeNull();
    // An answer that arrived settled never had one.
    cleanup();
    const fresh = render(
      <QAnswer
        turn={turn({ streaming: false })}
        mark={false}
        working={working}
      />,
    );
    expect(fresh.container.querySelector("[data-working-slot]")).toBeNull();
  });
});
