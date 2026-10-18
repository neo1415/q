// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { QPageManifestSchema } from "@capital-q/contracts";

import {
  currentManifest,
  registerQSection,
  resetManifest,
} from "../src/features/q/manifest";
import { qRef } from "../src/features/q/q-ref";
import { currentScreen } from "../src/features/q/screen";
import {
  positionOf,
  registerQMedia,
  resetQMedia,
} from "../src/features/q/screen-media";
import { resetViewport } from "../src/features/q/viewport";
import { loadWire } from "../src/features/q/wire";

/**
 * Lane W (2026-10-15): Q sees exactly what is on screen -- which records
 * are visible, the pitch playing, the error/empty/loading/toast states --
 * as ids and closed codes. Never text, never unsaved typing.
 */

beforeAll(async () => {
  await loadWire();
});

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

afterEach(() => {
  resetManifest();
  resetQMedia();
  resetViewport();
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  document.body.innerHTML = "";
});

/** jsdom lays nothing out: give an element a box at `top`, 100px tall. */
function placeAt(element: Element, top: number): void {
  element.getBoundingClientRect = () => ({
    top,
    bottom: top + 100,
    left: 0,
    right: 300,
    width: 300,
    height: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

function rows(): void {
  document.body.innerHTML = `<div data-q-section="list" class="contents">${[
    1, 2, 3, 4,
  ]
    .map(
      (n) =>
        `<div data-row="${String(n)}" data-q-ref="${qRef("COMPANY", id(n))["data-q-ref"]}">Company ${String(n)}</div>`,
    )
    .join("")}</div>`;
  // Window is 768px tall (jsdom); rows 1-2 scrolled above, 3-4 on screen.
  for (const n of [1, 2, 3, 4]) {
    const row = document.querySelector(`[data-row="${String(n)}"]`);
    if (row !== null) placeAt(row, n <= 2 ? -400 + n * 100 : (n - 3) * 100);
  }
  registerQSection({
    id: "list",
    kind: "COMPANY_LIST",
    refs: [1, 2, 3, 4].map((n) => ({ kind: "COMPANY" as const, id: id(n) })),
    total: 4,
  });
}

describe("what is visible now", () => {
  it("marks the section in view and names the visible records, in order", () => {
    rows();
    const manifest = currentManifest();
    expect(QPageManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest?.inView).toEqual(["list"]);
    expect(manifest?.sections[0]?.visible).toEqual([
      { kind: "COMPANY", id: id(3) },
      { kind: "COMPANY", id: id(4) },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("Company 3");
  });

  it("reads one shared IntersectionObserver's reports, not the layout, once they arrive", async () => {
    const observers: { cb: IntersectionObserverCallback; seen: Element[] }[] =
      [];
    class FakeObserver {
      readonly seen: Element[] = [];
      constructor(cb: IntersectionObserverCallback) {
        observers.push({ cb, seen: this.seen });
      }
      observe(element: Element) {
        this.seen.push(element);
      }
      unobserve() {}
      disconnect() {}
    }
    Object.assign(globalThis, { IntersectionObserver: FakeObserver });
    rows();
    await Promise.resolve();
    expect(observers).toHaveLength(1);
    const row = (n: number) =>
      document.querySelector(`[data-row="${String(n)}"]`) as Element;
    currentManifest();
    const observer = observers[0];
    if (observer === undefined) throw new Error("no observer");
    // The person scrolls: now rows 1 and 2 are what they are looking at.
    observer.cb(
      [1, 2, 3, 4].map(
        (n) =>
          ({
            target: row(n),
            isIntersecting: n <= 2,
            intersectionRatio: n <= 2 ? 1 : 0,
            intersectionRect: { height: n <= 2 ? 100 : 0 },
            rootBounds: { height: 768 },
          }) as unknown as IntersectionObserverEntry,
      ),
      observer as unknown as IntersectionObserver,
    );
    expect(currentManifest()?.sections[0]?.visible).toEqual([
      { kind: "COMPANY", id: id(1) },
      { kind: "COMPANY", id: id(2) },
    ]);
    // Still one observer for the tab.
    expect(observers).toHaveLength(1);
  });

  it("never names a record inside a part hidden from Q, or a mark the contract would refuse", () => {
    rows();
    const third = document.querySelector('[data-row="3"]');
    third?.setAttribute("data-q-hidden", "");
    document
      .querySelector('[data-row="4"]')
      ?.setAttribute("data-q-ref", "COMPANY:not-a-uuid");
    expect(currentManifest()?.sections[0]?.visible).toBeUndefined();
  });
});

describe("states the person sees", () => {
  it("reports error, empty, loading and toast states by closed kind and code only", () => {
    document.body.innerHTML = `
      <div data-q-section="docs" class="contents">
        <section data-state="empty" aria-label="No documents yet"><h3>No documents yet</h3></section>
      </div>
      <section data-state="error" role="alert"><h3>Payment declined for card 4242</h3></section>
      <div data-q-notice="TOAST:DONE">Invite sent to ada@example.com</div>
      <div data-q-notice="TOAST:whatever">Odd</div>
      <div data-q-self><div data-q-notice="TOAST">Q's own</div></div>`;
    registerQSection({ id: "docs", kind: "DOCUMENT_LIST", refs: [], total: 0 });
    const manifest = currentManifest();
    expect(QPageManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest?.notices).toEqual([
      { kind: "EMPTY", section: "docs" },
      { kind: "ERROR" },
      { kind: "TOAST", code: "DONE" },
      { kind: "TOAST" },
    ]);
    const wire = JSON.stringify(currentScreen("/documents"));
    expect(wire).not.toContain("4242");
    expect(wire).not.toContain("ada@example.com");
    expect(wire).not.toContain("No documents");
  });

  it("names the pitch on screen, whether it plays, and roughly where", () => {
    document.body.innerHTML = `<video></video>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperties(video, {
      paused: { value: false },
      readyState: { value: 4 },
      currentTime: { value: 31 },
      duration: { value: 60 },
    });
    registerQMedia({
      companyId: id(9),
      mediaAssetId: id(10),
      video: () => video,
      failed: () => false,
    });
    const manifest = currentManifest();
    expect(QPageManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest?.media).toEqual({
      kind: "PITCH",
      companyId: id(9),
      mediaAssetId: id(10),
      state: "PLAYING",
      position: "MIDDLE",
      muted: false,
    });
    expect(positionOf(1, 60)).toBe("START");
    expect(positionOf(59, 60)).toBe("END");
    expect(positionOf(5, Number.NaN)).toBeUndefined();
  });

  it("drops a pitch inside a part hidden from Q", () => {
    document.body.innerHTML = `<div data-q-hidden><video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    registerQMedia({
      companyId: id(9),
      mediaAssetId: null,
      video: () => video,
      failed: () => false,
    });
    expect(currentManifest()).toBeUndefined();
  });
});

describe("the privacy line: unsaved typing", () => {
  it("never sends what is typed in a field and not saved or sent", () => {
    document.body.innerHTML = `<div data-q-section="form" class="contents"><textarea></textarea><input /></div>`;
    const area = document.querySelector("textarea") as HTMLTextAreaElement;
    const input = document.querySelector("input") as HTMLInputElement;
    area.value = "my runway is 4 months";
    input.value = "draft valuation 12m";
    registerQSection({ id: "form", kind: "SETTINGS", refs: [], total: 0 });
    const wire = JSON.stringify(currentScreen("/settings"));
    expect(wire).not.toContain("runway");
    expect(wire).not.toContain("valuation");
  });
});
