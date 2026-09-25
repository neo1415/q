import { expect, test, type Page } from "@playwright/test";

/**
 * The Q Aperture in a real browser (ADR 0017 F2; spec §15, UX-02), on the
 * development gallery. The gallery exists only in development builds, so
 * against a production server these checks skip rather than fail; the
 * deterministic rules they rest on are asserted in
 * apps/web/test/q-aperture.test.ts on every run.
 */

test.use({ storageState: { cookies: [], origins: [] } });

type Probe = {
  contexts: number;
  frames: number;
};

/** Count WebGL contexts and animation-frame callbacks from the first script. */
async function probe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: Probe = { contexts: 0, frames: 0 };
    (window as unknown as { __probe: Probe }).__probe = record;
    const getContext = Reflect.get(
      HTMLCanvasElement.prototype,
      "getContext",
    ) as (...args: unknown[]) => unknown;
    Reflect.set(
      HTMLCanvasElement.prototype,
      "getContext",
      function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        if (kind === "webgl2" || kind === "webgl") record.contexts += 1;
        return Reflect.apply(getContext, this, [kind, ...rest]);
      },
    );
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        record.frames += 1;
        callback(time);
      });
  });
}

async function openGallery(page: Page, query = ""): Promise<void> {
  const response = await page.goto(`/dev/q-presence${query}`);
  test.skip(
    response?.status() === 404,
    "the aperture gallery exists only in development builds",
  );
}

async function allOnRenderer(page: Page, renderer: "webgl" | "svg") {
  await expect
    .poll(
      () =>
        page.evaluate(
          (wanted) =>
            [...document.querySelectorAll("[data-q-aperture]")].every(
              (el) => el.getAttribute("data-renderer") === wanted,
            ),
          renderer,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

const readProbe = (page: Page) =>
  page.evaluate(() => ({
    ...(window as unknown as { __probe: Probe }).__probe,
  }));

test("one WebGL context draws every aperture on the page", async ({ page }) => {
  await probe(page);
  await openGallery(page);
  await allOnRenderer(page, "webgl");
  const count = await page.locator("[data-q-aperture]").count();
  expect(count).toBe(36);
  expect((await readProbe(page)).contexts).toBe(1);
});

test("an idle aperture schedules no animation frames over 10 s", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await probe(page);
  await openGallery(page, "?states=IDLE");
  await allOnRenderer(page, "webgl");
  // Let the first draw and any settle finish.
  await page.waitForTimeout(1500);
  const before = await readProbe(page);
  await page.waitForTimeout(10_000);
  const after = await readProbe(page);
  expect(after.frames - before.frames).toBe(0);
});

for (const setup of [
  { name: "Q motion Calm", motion: "calm", reduced: false },
  { name: "prefers-reduced-motion", motion: null, reduced: true },
] as const) {
  test(`${setup.name} keeps working light static`, async ({ page }) => {
    await probe(page);
    if (setup.reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    if (setup.motion !== null) {
      await page.addInitScript((value) => {
        window.localStorage.setItem("cq.q-motion", value);
      }, setup.motion);
    }
    await openGallery(page, "?states=THINKING,WORKING,LISTENING,SPEAKING");
    await allOnRenderer(page, "webgl");
    await expect(page.locator("[data-q-aperture]").first()).toHaveAttribute(
      "data-motion",
      "calm",
    );
    await page.waitForTimeout(1000);
    const before = await readProbe(page);
    await page.waitForTimeout(3000);
    const after = await readProbe(page);
    expect(after.frames - before.frames).toBe(0);
    // The SVG ring beneath carries no running animation either.
    const animated = await page.evaluate(
      () =>
        [...document.querySelectorAll(".cq-aperture-svg *")].filter(
          (el) =>
            getComputedStyle(el).animationName !== "none" &&
            getComputedStyle(el).animationPlayState === "running" &&
            el.getAnimations().some((a) => a.playState === "running"),
        ).length,
    );
    expect(animated).toBe(0);
  });
}

test("forced colours draw the SVG ring in system colours, no shader", async ({
  page,
}) => {
  await probe(page);
  await page.emulateMedia({ forcedColors: "active" });
  await openGallery(page, "?states=IDLE,THINKING");
  await page.waitForTimeout(3000);
  await allOnRenderer(page, "svg");
  expect((await readProbe(page)).contexts).toBe(0);
  const svgVisible = await page
    .locator(".cq-aperture-svg")
    .first()
    .evaluate((el) => getComputedStyle(el).visibility);
  expect(svgVisible).toBe("visible");
});

for (const theme of ["light", "dark"] as const) {
  test(`the ring holds 3:1 in ${theme}, and no label sits on the glow`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem("cq.theme", value);
    }, theme);
    await openGallery(page, "?sizes=stage");
    await allOnRenderer(page, "webgl");
    await page.waitForTimeout(1000);
    const results = await page.evaluate(() => {
      const lum = ([r, g, b]: number[]) => {
        const d = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * d(r ?? 0) + 0.7152 * d(g ?? 0) + 0.0722 * d(b ?? 0);
      };
      const background = (el: Element): number[] => {
        let node: Element | null = el;
        while (node !== null) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
            // The body's canvas token may be oklch; resolve through a canvas.
            const c = document.createElement("canvas").getContext("2d");
            if (c === null) return [0, 0, 0];
            c.fillStyle = bg;
            c.fillRect(0, 0, 1, 1);
            return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
          }
          node = node.parentElement;
        }
        return [255, 255, 255];
      };
      return [...document.querySelectorAll("[data-q-aperture]")].map((host) => {
        const state = host.getAttribute("data-q-aperture") ?? "";
        const canvas = host.querySelector("canvas");
        const mark = host.querySelector(".cq-aperture-mark");
        const label = host.querySelector(".cq-aperture-label");
        if (canvas === null || mark === null) {
          return { state, ratio: 0, overlap: true };
        }
        const ctx = canvas.getContext("2d");
        const bg = background(host);
        // The ring's top, at the stroke's centre (radius 0.56 of the half).
        const x = Math.round(canvas.width / 2);
        let best = 0;
        // The ring's radius moves by state (tighter to think, wider to
        // listen), so scan across it and keep the stroke's centre.
        for (let dy = -24; dy <= 24; dy += 1) {
          const y = Math.round(canvas.height / 2 - canvas.height * 0.28) + dy;
          const [r, g, b, a] = ctx?.getImageData(x, y, 1, 1).data ?? [];
          const alpha = (a ?? 0) / 255;
          const composed = [r ?? 0, g ?? 0, b ?? 0].map(
            (v, i) => v * alpha + (bg[i] ?? 0) * (1 - alpha),
          );
          const l1 = lum(composed);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          best = Math.max(best, ratio);
        }
        const m = mark.getBoundingClientRect();
        const l = label?.getBoundingClientRect();
        const overlap =
          l !== undefined &&
          l.top < m.bottom &&
          l.bottom > m.top &&
          l.left < m.right &&
          l.right > m.left;
        return { state, ratio: best, overlap };
      });
    });
    expect(results.length).toBe(18);
    for (const result of results) {
      expect(result.overlap, result.state).toBe(false);
      expect(
        result.ratio,
        `${result.state} ring contrast`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
}
