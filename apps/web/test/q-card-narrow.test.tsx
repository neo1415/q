// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QCard } from "../src/features/q-card/q-card";

/**
 * The Q Card at phone widths (owner 2026-11-04, live 390 px: the name and
 * handle were cut off beside the QR). Below `sm` the card stacks: the
 * identity block takes the full width and never truncates, and the QR
 * follows it at 144 px (>= 120 px, comfortably scannable). From `sm` up
 * the side-by-side ID layout is unchanged. jsdom has no layout, so this
 * pins the class contract and the order, not pixels.
 */

afterEach(cleanup);

const LONG_NAME = "Savanna Seed Partners International Holdings";
const LONG_HANDLE = "savanna-seed-partners-intl";

function classes(element: Element | null): string[] {
  return (element?.getAttribute("class") ?? "").split(/\s+/u);
}

/** Classes that apply below `sm` (no breakpoint prefix). */
function unprefixed(element: Element | null): string[] {
  return classes(element).filter((name) => !name.includes(":"));
}

function renderCard() {
  return render(
    <QCard
      name={LONG_NAME}
      role="Partner"
      organisation="Savanna Seed Partners"
      handle={LONG_HANDLE}
      displayUrl={`capitalq.example/@${LONG_HANDLE}`}
      qrSvg="<svg viewBox='0 0 1 1'></svg>"
    />,
  );
}

describe("the Q Card on a phone", () => {
  it("stacks: identity first, the QR below it; side by side from sm", () => {
    const { container } = renderCard();
    const card = container.querySelector("[data-q-card]");
    expect(unprefixed(card)).toContain("flex-col");
    expect(classes(card)).toContain("sm:flex-row");
    const qr = container.querySelector("[data-card-qr]");
    const handle = container.querySelector("[data-q-card-handle]");
    if (qr === null || handle === null) throw new Error("card parts missing");
    // The QR comes after the identity block in the document.
    expect(
      handle.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Side by side only from sm: the narrow column width is sm-only.
    expect(unprefixed(qr).some((name) => name.startsWith("w-"))).toBe(false);
    expect(classes(qr)).toContain("sm:w-[34%]");
  });

  it("never cuts off the name, the role lines or the handle below sm", () => {
    const { container } = renderCard();
    const name = container.querySelector("[data-q-card] p, [data-q-card] h1");
    expect(name?.textContent).toBe(LONG_NAME);
    expect(unprefixed(name).some((c) => c.startsWith("line-clamp"))).toBe(
      false,
    );
    for (const line of container.querySelectorAll("p.cq-body-sm")) {
      expect(unprefixed(line).some((c) => c.startsWith("line-clamp"))).toBe(
        false,
      );
    }
    const handle = container.querySelector("[data-q-card-handle] span + span");
    expect(handle?.textContent).toBe(LONG_HANDLE);
    expect(unprefixed(handle)).not.toContain("truncate");
    expect(unprefixed(handle)).toContain("break-all");
  });

  it("keeps the QR scannable: 144 px (w-36) on a phone, filling its column from sm", () => {
    const { container } = renderCard();
    const code = container.querySelector("[data-card-qr] [role='img']");
    expect(unprefixed(code)).toContain("w-36");
    expect(classes(code)).toContain("sm:w-full");
    expect(code?.getAttribute("aria-label")).toMatch(/^QR code linking to /u);
  });
});
