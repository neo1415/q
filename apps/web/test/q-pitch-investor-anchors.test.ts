// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { INVESTOR_V6_SCRIPT } from "@capital-q/q-pitch";

import { INVESTOR_ANCHORS } from "@/features/q-pitch/investor-anchors";
import { lightSection, placeAnchors } from "@/features/q-pitch/section-light";

const used = new Set(
  INVESTOR_V6_SCRIPT.scenes.flatMap((s) =>
    s.lines.flatMap((l) => (l.anchor === undefined ? [] : [l.anchor])),
  ),
);

describe("the investor track's anchors (v6)", () => {
  it("places every anchor the script talks about, and nothing it doesn't", () => {
    expect([...used].sort()).toEqual(Object.keys(INVESTOR_ANCHORS).sort());
  });

  it("finds each by a valid selector", () => {
    for (const [anchor, placement] of Object.entries(INVESTOR_ANCHORS)) {
      expect(
        () => document.querySelector(placement.select),
        anchor,
      ).not.toThrow();
    }
  });

  it("lights a section found by its page marker, and taps a card into the spotlight", async () => {
    placeAnchors(INVESTOR_ANCHORS);
    document.body.innerHTML = `
      <div data-ac-cards>
        <article data-ac-rank="1"><button class="cq-ac-head-main" aria-expanded="true">One</button></article>
        <button data-ac-strip data-ac-rank="2">Two</button>
      </div>
      <section id="needs-you">Needs you</section>`;
    let tapped = 0;
    document.querySelector("[data-ac-strip]")?.addEventListener("click", () => {
      tapped += 1;
    });
    const signal = new AbortController().signal;
    expect(await lightSection("inv.15.crm.needs-you", {}, signal, 200)).toBe(
      true,
    );
    expect(
      document.querySelector("#needs-you")?.getAttribute("data-qp-anchor"),
    ).toBe("inv.15.crm.needs-you");
    expect(
      await lightSection("inv.02.match.card-2", { open: true }, signal, 200),
    ).toBe(true);
    expect(tapped).toBe(1);
    // A card already in the spotlight is not pressed again.
    expect(
      await lightSection("inv.02.match.card-1", { open: true }, signal, 200),
    ).toBe(true);
  });
});
