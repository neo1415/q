import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * Loads the real public/sw.js and exercises its cache classification, so the
 * policy that ships is the policy that is tested.
 */

type CacheDecision = (
  request: { url: string; method: string },
  origin: string,
) => boolean;

type LoadedWorker = {
  readonly isCacheable: CacheDecision;
  readonly allowedPrefixes: readonly string[];
  readonly allowedExact: readonly string[];
  readonly listeners: readonly string[];
  readonly source: string;
};

function loadServiceWorker(): LoadedWorker {
  const source = readFileSync(
    fileURLToPath(new URL("../public/sw.js", import.meta.url)),
    "utf8",
  );
  const listeners: string[] = [];
  const self = {
    __cq: undefined as
      | {
          isCacheable: CacheDecision;
          ALLOWED_PREFIXES: string[];
          ALLOWED_EXACT: string[];
        }
      | undefined,
    location: { origin: "https://app.capitalq.test" },
    addEventListener: (type: string) => {
      listeners.push(type);
    },
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
  };
  runInNewContext(source, { self, URL, caches: undefined, fetch: undefined });
  if (self.__cq === undefined) {
    throw new Error("service worker did not expose its policy");
  }
  return {
    isCacheable: self.__cq.isCacheable,
    allowedPrefixes: self.__cq.ALLOWED_PREFIXES,
    allowedExact: self.__cq.ALLOWED_EXACT,
    listeners,
    source,
  };
}

const ORIGIN = "https://app.capitalq.test";
const get = (path: string, origin = ORIGIN) => ({
  url: `${origin}${path}`,
  method: "GET",
});

describe("service worker cache policy", () => {
  const worker = loadServiceWorker();

  it("registers install, activate and fetch handlers only", () => {
    expect(worker.listeners).toEqual(["install", "activate", "fetch"]);
  });

  it.each([
    "/_next/static/chunks/app/layout-abc123.js",
    "/_next/static/css/app-def456.css",
    "/_next/static/media/geist-latin.woff2",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
    "/fonts/anything.woff2",
    "/manifest.webmanifest",
    "/icon.svg",
  ])("caches the shell asset %s", (path) => {
    expect(worker.isCacheable(get(path), ORIGIN)).toBe(true);
  });

  it.each([
    "/",
    "/home",
    "/discover",
    "/capital",
    "/profile",
    "/onboarding/founder",
    "/api/v1/companies",
    "/api/q/runs",
    "/v1/companies/123",
    "/q/stream",
    "/data-room/files/abc",
    "/_next/data/build/home.json",
    "/_next/image?url=/x.png",
    "/sw.js",
    "/media/signed/pitch.m3u8?token=abc",
  ])("never intercepts %s", (path) => {
    expect(worker.isCacheable(get(path), ORIGIN)).toBe(false);
  });

  it("never caches cross-origin requests, even for static-looking paths", () => {
    expect(
      worker.isCacheable(
        get("/_next/static/chunk.js", "https://cdn.evil.test"),
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      worker.isCacheable(
        get("/icons/icon-192.png", "https://stream.provider.test"),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("never caches anything but GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        worker.isCacheable(
          { url: `${ORIGIN}/_next/static/x.js`, method },
          ORIGIN,
        ),
      ).toBe(false);
    }
  });

  it("contains no blanket caching of navigations or API responses", () => {
    expect(worker.source).not.toMatch(/cache\.addAll\(/);
    expect(worker.source).not.toMatch(/mode === ["']navigate["']/);
    const lists = [...worker.allowedPrefixes, ...worker.allowedExact];
    expect(
      lists.some((entry) => /api|\/q(?:\/|$)|data-room|media/.test(entry)),
    ).toBe(false);
    // Only successful same-origin responses are stored, and only after the
    // allow-list check gates the handler.
    expect(worker.source).toMatch(/response\.ok && response\.type === "basic"/);
    expect(worker.source).toMatch(
      /if \(!isCacheable\(event\.request, self\.location\.origin\)\) \{\s*return;/,
    );
  });
});
