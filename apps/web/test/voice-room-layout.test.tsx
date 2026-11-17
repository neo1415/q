// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FullCardsContext } from "@/features/q/answer-canvas-logic";
import { QCurrentExchange } from "@/features/q/q-current-exchange";
import { VoiceRoom } from "@/features/q/voice-room-layout";

/**
 * Decision 102 (owner, 2026-11-17): once Q shows something the content
 * takes the stage. No column or grid track is kept for Q's presence; the
 * presence and captions hang in a zero-height overlay whose measured
 * height the content keeps free at its end; the caption is at most two
 * lines. The geometry itself is asserted in a browser by
 * apps/web/e2e/voice-room-layout.spec.ts.
 */

// jsdom has no layout: the overlay's parts report the offsets a browser
// gives a bottom-anchored absolute box (negative top, hanging above).
const LAYOUT: Record<string, { top: number; height: number; width: number }> = {
  presence: { top: -72, height: 72, width: 72 },
  caption: { top: -64, height: 64, width: 640 },
};
function layoutOf(element: HTMLElement) {
  const key = element.dataset["testLayout"];
  return key === undefined ? undefined : LAYOUT[key];
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      return layoutOf(this)?.top ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return layoutOf(this)?.height ?? 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return layoutOf(this)?.width ?? 0;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function room(compact: boolean) {
  return render(
    <VoiceRoom
      compact={compact}
      resultKey={null}
      aside={
        <>
          <div data-q-presence="stage" data-test-layout="presence" />
          <div className="cq-voice-caption" data-test-layout="caption" />
          <ol className="sr-only" />
        </>
      }
    >
      <div data-test-cards />
    </VoiceRoom>,
  );
}

describe("the voice room once Q shows something (decision 102)", () => {
  it("keeps no column for Q: one full-width stack, the overlay last", () => {
    room(true);
    const element = document.querySelector<HTMLElement>("[data-q-voice-room]");
    if (element === null) throw new Error("no room");
    expect(element.className).not.toMatch(/grid/);
    expect(element.className).not.toMatch(/grid-cols/);
    expect(element.hasAttribute("data-q-voice-compact")).toBe(true);
    const content = element.querySelector("[data-q-voice-content]");
    expect(content?.className).toMatch(/w-full/);
  });

  it("measures the overlay so the content keeps its height free", () => {
    room(true);
    const element = document.querySelector<HTMLElement>("[data-q-voice-room]");
    // The taller of Q (72) and the caption (64); the sr-only list is not.
    expect(element?.style.getPropertyValue("--cq-voice-overlay-h")).toBe(
      "72px",
    );
    expect(element?.style.getPropertyValue("--cq-voice-presence-w")).toBe(
      "72px",
    );
  });

  it("tells its cards never to become phone tiles (owner 2026-11-17)", () => {
    function Probe() {
      return <div data-full-cards={String(useContext(FullCardsContext))} />;
    }
    render(
      <VoiceRoom compact resultKey={null} aside={null}>
        <Probe />
      </VoiceRoom>,
    );
    expect(
      document
        .querySelector("[data-full-cards]")
        ?.getAttribute("data-full-cards"),
    ).toBe("true");
  });

  it("with nothing shown it reserves nothing", () => {
    room(false);
    const element = document.querySelector<HTMLElement>("[data-q-voice-room]");
    expect(element?.style.getPropertyValue("--cq-voice-overlay-h")).toBe("");
    expect(element?.hasAttribute("data-q-voice-compact")).toBe(false);
  });
});

describe("the floating caption (decision 102)", () => {
  const lines = [
    { id: "p-1", role: "person" as const, text: "Find me founders" },
    { id: "q-1", role: "q" as const, text: "I found five." },
  ];

  it("is Q's words in at most two lines, Earlier beside them, without the settled question", () => {
    render(
      <QCurrentExchange
        lines={lines}
        live={null}
        qSaying="I found five founders raising now."
        captions
        earlier
        onOpenChat={() => undefined}
        cardLines={false}
        compact
      />,
    );
    const caption = document.querySelector("[data-q-exchange-caption]");
    expect(caption?.className).toMatch(/line-clamp-2/);
    expect(document.querySelector("[data-q-exchange-person]")).toBeNull();
    // Beside the words (one row), not a third line under them.
    expect(
      document.querySelector("[data-q-exchange-compact]")?.className,
    ).toMatch(/flex-row/);
    expect(document.querySelector("[data-q-earlier]")).not.toBeNull();
  });

  it("is the person's own words while they speak, in place of Q's", () => {
    render(
      <QCurrentExchange
        lines={lines}
        live="and only in"
        qSaying={null}
        captions
        earlier={false}
        onOpenChat={() => undefined}
        cardLines={false}
        compact
      />,
    );
    expect(
      document.querySelector("[data-q-exchange-person]")?.textContent,
    ).toContain("and only in");
    expect(document.querySelector("[data-q-exchange-caption]")).toBeNull();
  });

  it("is unchanged before anything is shown (large presence)", () => {
    render(
      <QCurrentExchange
        lines={lines}
        live={null}
        qSaying={null}
        captions
        earlier
        onOpenChat={() => undefined}
        cardLines={false}
      />,
    );
    expect(document.querySelector("[data-q-exchange-person]")).not.toBeNull();
    expect(document.querySelector("[data-q-exchange-caption]")).not.toBeNull();
    expect(document.querySelector("[data-q-earlier]")).not.toBeNull();
  });
});
