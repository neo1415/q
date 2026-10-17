import { expect, test } from "@playwright/test";

/**
 * Owner 2026-10-17 (live, ten cards on Home): "Ledgerfo…", "Baske…",
 * "Clinicr…". A company's name on an answer card is always readable in
 * full: it wraps, it is never cut. Checked with the Open control on every
 * card (as live), at the phone and desktop widths of this config (390 and
 * 1440), for ten cards in the grid and three in a row.
 */

for (const [n, focus] of [
  [10, 0],
  [10, -1],
  [3, 0],
] as const) {
  test(`every name is whole with ${String(n)} cards (focus ${String(focus)})`, async ({
    page,
  }) => {
    await page.goto(
      `/dev/canvas?n=${String(n)}&focus=${String(focus)}&open=1${focus < 0 ? "&state=overview" : ""}`,
    );
    const cards = page.locator("[data-ac-card]");
    await expect(cards).toHaveCount(n);
    await expect(page.locator("[data-ac-open]")).toHaveCount(n);
    const names = await cards.evaluateAll((all) =>
      all.map((card) => {
        const h3 = card.querySelector("h3");
        if (h3 === null) return { name: "", cut: true, outside: true };
        const style = getComputedStyle(h3);
        // A word split over two lines is not readable either.
        let split = false;
        const walker = document.createTreeWalker(h3, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement?.closest(".sr-only") != null) continue;
          const text = node.textContent ?? "";
          for (const match of text.matchAll(/\S+/gu)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const tops = new Set(
              [...range.getClientRects()].map((rect) => Math.round(rect.top)),
            );
            if (tops.size > 1) split = true;
          }
        }
        const box = h3.getBoundingClientRect();
        const outer = card.getBoundingClientRect();
        return {
          name: h3.textContent ?? "",
          cut:
            split ||
            h3.scrollWidth > h3.clientWidth + 1 ||
            style.textOverflow === "ellipsis" ||
            box.width < 24,
          outside: box.right > outer.right + 1 || box.left < outer.left - 1,
        };
      }),
    );
    for (const one of names) {
      expect(one, one.name).toMatchObject({ cut: false, outside: false });
    }
  });
}
