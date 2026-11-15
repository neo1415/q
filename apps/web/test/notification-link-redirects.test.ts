import { describe, expect, it } from "vitest";

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

import nextConfig from "../next.config";

/**
 * Live audit 2026-11-15 D1: a notification link is a plain in-app path
 * (the database's notifications_link_path_check), so a notice that opens a
 * tab or an item stores an alias path that this app sends on. Each alias
 * matches only a strict id and lands on this app's own page; anything else
 * is not redirected.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const REQUEST = "33333333-3333-4333-8333-333333333333";

async function redirectFor(path: string): Promise<string | null> {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  for (const rule of redirects) {
    const params = getPathMatch(rule.source, { strict: true })(path);
    if (params === false) continue;
    return rule.destination.replace(/:([A-Za-z]+)/gu, (_, name: string) =>
      String(params[name]),
    );
  }
  return null;
}

// The links counterpartNoticeLinkPath builds (pinned in
// packages/communication/test/notification-links.test.ts).
const REQUESTED = `/documents/requested/${REQUEST}`;
const DATA_ROOM = `/company/${COMPANY}/data-room`;

describe("notification alias links", () => {
  it("a document request opens the founder's Requested tab at that request", async () => {
    expect(await redirectFor(REQUESTED)).toBe(
      `/documents?tab=requested&item=${REQUEST}`,
    );
    expect(await redirectFor("/documents/requested")).toBe(
      "/documents?tab=requested",
    );
  });

  it("an answer opens the investor's Data room tab of the company", async () => {
    expect(await redirectFor(DATA_ROOM)).toBe(
      `/company/${COMPANY}?tab=dataroom`,
    );
  });

  it("matches only strict ids: nothing else is sent anywhere", async () => {
    expect(await redirectFor("/company/data-room")).toBeNull();
    expect(await redirectFor("/company/not-a-uuid/data-room")).toBeNull();
    expect(await redirectFor("/documents/requested/a.b")).toBeNull();
    expect(
      await redirectFor("/documents/requested/%2F%2Felsewhere.example"),
    ).toBeNull();
  });
});
