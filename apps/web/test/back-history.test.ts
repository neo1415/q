import { afterEach, describe, expect, it } from "vitest";

import {
  canGoBack,
  markInAppNavigation,
  markLanding,
  resetInAppNavigation,
} from "../src/features/company/back-history";

const origin = "https://app.capitalq.example";
const at = (
  pathname: string,
  over: Partial<{ length: number; referrer: string }> = {},
) => ({ length: 2, referrer: "", origin, pathname, ...over });

/**
 * UX-04 (2026-11-04): Back uses the real history only when the previous
 * entry is a Capital Q page; otherwise the page's parent link is used.
 */
describe("whether Back may use the browser history", () => {
  afterEach(() => resetInAppNavigation());

  it("uses the fallback on a deep link from outside or a fresh tab", () => {
    markLanding("/admin/accounts/u1");
    expect(canGoBack(at("/admin/accounts/u1", { length: 1 }))).toBe(false);
    expect(canGoBack(at("/admin/accounts/u1"))).toBe(false);
    expect(
      canGoBack(
        at("/admin/accounts/u1", { referrer: "https://mail.example/" }),
      ),
    ).toBe(false);
  });

  it("goes back after a move inside the app", () => {
    markLanding("/admin/accounts");
    markInAppNavigation();
    expect(canGoBack(at("/admin/accounts/u1"))).toBe(true);
  });

  it("never steps out of the app from the page the tab arrived on", () => {
    // Deep link to C, on to D, back to C: Back on C must not leave.
    markLanding("/discover/saved");
    markInAppNavigation();
    expect(
      canGoBack(at("/discover/saved", { referrer: "https://news.example/" })),
    ).toBe(false);
  });

  it("goes back to a same-origin page that loaded this one", () => {
    markLanding("/admin/q/runs/r1");
    expect(
      canGoBack(at("/admin/q/runs/r1", { referrer: `${origin}/admin/q` })),
    ).toBe(true);
  });

  it("treats a malformed referrer as outside", () => {
    expect(canGoBack(at("/x", { referrer: "not a url" }))).toBe(false);
  });
});
