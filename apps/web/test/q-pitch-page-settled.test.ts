// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { resetManifest, setQFocus } from "@/features/q/manifest";
import { pageSettled } from "@/features/q-pitch/use-tour-ports";

const HARBOURLINE = "ceb6ec2d-4a4a-41a2-9b71-377d72c26407";
const FEED_CARD = "5be654c3-eb80-4bdf-aa5a-9cb29c521dbe";

afterEach(() => {
  resetManifest();
  window.history.pushState({}, "", "/");
});

describe("pageSettled (a tour question waits for the page it is about)", () => {
  it("waits on a company page until that company is in focus", async () => {
    window.history.pushState({}, "", `/company/${HARBOURLINE}`);
    setTimeout(() => setQFocus({ kind: "COMPANY", id: HARBOURLINE }), 200);
    const started = Date.now();
    expect(await pageSettled(new AbortController().signal, 2_000)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("does not take the previous page's card for this company (run 5)", async () => {
    window.history.pushState({}, "", `/company/${HARBOURLINE}`);
    setQFocus({ kind: "COMPANY", id: FEED_CARD });
    expect(await pageSettled(new AbortController().signal, 400)).toBe(false);
  });

  it("does not wait on a page that is not about one company", async () => {
    window.history.pushState({}, "", "/discover");
    expect(await pageSettled(new AbortController().signal, 2_000)).toBe(true);
  });

  it("waits until Q's subject is that company too, not the feed's last card (run 6)", async () => {
    window.history.pushState({}, "", `/company/${HARBOURLINE}`);
    setQFocus({ kind: "COMPANY", id: HARBOURLINE });
    let subject = FEED_CARD;
    setTimeout(() => {
      subject = HARBOURLINE;
    }, 200);
    const started = Date.now();
    expect(
      await pageSettled(new AbortController().signal, 2_000, () => subject),
    ).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    // Never settles on the stale subject alone.
    expect(
      await pageSettled(new AbortController().signal, 300, () => FEED_CARD),
    ).toBe(false);
  });
});
