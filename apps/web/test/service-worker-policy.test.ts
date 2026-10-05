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
  readonly deniedPrefixes: readonly string[];
  readonly listeners: readonly string[];
  readonly source: string;
  readonly safePath: (path: unknown) => string;
  readonly safeJoinUrl: (url: unknown) => string | null;
  readonly readPush: (event: unknown) => {
    title: string;
    body: string;
    path: string;
  };
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
          DENIED_PREFIXES: string[];
          safePath?: (path: unknown) => string;
          safeJoinUrl?: (url: unknown) => string | null;
          readPush?: (event: unknown) => {
            title: string;
            body: string;
            path: string;
          };
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
    deniedPrefixes: self.__cq.DENIED_PREFIXES,
    listeners,
    source,
    safePath: self.__cq.safePath ?? (() => ""),
    safeJoinUrl: self.__cq.safeJoinUrl ?? (() => "unset"),
    readPush: self.__cq.readPush ?? (() => ({ title: "", body: "", path: "" })),
  };
}

const ORIGIN = "https://app.capitalq.test";
const get = (path: string, origin = ORIGIN) => ({
  url: `${origin}${path}`,
  method: "GET",
});

describe("service worker cache policy", () => {
  const worker = loadServiceWorker();

  it("registers install, activate, fetch and the Web Push handlers only", () => {
    expect(worker.listeners).toEqual([
      "install",
      "activate",
      "fetch",
      // AUTO (ADR 0030): show a push, open its same-origin path on tap.
      "push",
      "notificationclick",
    ]);
  });

  it("opens only a same-origin app path from a push", () => {
    expect(worker.safePath("/work/abc-123")).toBe("/work/abc-123");
    expect(worker.safePath("https://evil.example/")).toBe("/home");
    expect(worker.safePath("//evil.example/x")).toBe("/home");
    expect(worker.safePath("//localhost/x")).toBe("/home");
    expect(worker.safePath("/work?x=1")).toBe("/home");
    expect(worker.safePath(undefined)).toBe("/home");
  });

  it("opens a call notice straight in Google Meet, and nothing else outside the app", () => {
    expect(worker.safeJoinUrl("https://meet.google.com/dks-jiji-bgv")).toBe(
      "https://meet.google.com/dks-jiji-bgv",
    );
    for (const bad of [
      "https://meet.google.com.evil.example/abc-defg-hij",
      "http://meet.google.com/abc-defg-hij",
      "https://evil.example/abc",
      "javascript:alert(1)",
      "https://meet.google.com/abc?authuser=1",
      undefined,
    ]) {
      expect(worker.safeJoinUrl(bad)).toBeNull();
    }
  });

  it("always has something to show for a push, even an unreadable one", () => {
    const pushed = worker.readPush({
      data: {
        json: () => ({
          title: "Q needs your time",
          body: "Mon 11:00",
          path: "/work",
        }),
      },
    });
    expect(pushed).toMatchObject({ title: "Q needs your time", path: "/work" });
    const broken = worker.readPush({
      data: {
        json: () => {
          throw new Error("not json");
        },
      },
    });
    expect(broken.title).toBe("Capital Q");
    expect(worker.readPush({ data: null }).path).toBe("/home");
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

  it.each([
    "/auth/sign-in",
    "/auth/sign-in?next=%2Fhome",
    "/auth/sign-up",
    "/auth/callback?code=abc",
    "/auth/callback?token_hash=abc&type=recovery",
    "/auth/update-password",
    "/auth/forgot-password",
    "/auth/check-email?purpose=recovery",
    "/v1/me",
    "/api/session",
  ])("never caches the authentication or session path %s", (path) => {
    expect(worker.isCacheable(get(path), ORIGIN)).toBe(false);
  });

  it("denies authentication paths by name, before the allow-list", () => {
    expect(worker.deniedPrefixes).toEqual(
      expect.arrayContaining(["/auth/", "/api/", "/v1/"]),
    );
    // Even if an allow-listed prefix were ever nested under /auth, the deny
    // wins: the check runs first.
    expect(worker.source.indexOf("DENIED_PREFIXES.some")).toBeLessThan(
      worker.source.indexOf("ALLOWED_EXACT.includes"),
    );
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
      /if \(!isCacheable\(request, origin\)\) \{\s*return;/,
    );
  });
});

/**
 * The handlers themselves, run against fake Cache Storage and network, so
 * "never stored" is observed rather than inferred from the source.
 */
describe("service worker handlers", () => {
  type Handler = (event: unknown) => void;
  type FakeRequest = {
    url: string;
    method: string;
    mode?: string;
    destination?: string;
    headers?: { has: (name: string) => boolean };
  };

  function harness(network: (request: FakeRequest) => Promise<unknown>) {
    const source = readFileSync(
      fileURLToPath(new URL("../public/sw.js", import.meta.url)),
      "utf8",
    );
    const handlers = new Map<string, Handler>();
    const stored: string[] = [];
    const offline = { offline: true };
    const cache = {
      match: (request: FakeRequest | string) =>
        Promise.resolve(
          (typeof request === "string" ? request : request.url).endsWith(
            "/offline.html",
          )
            ? offline
            : undefined,
        ),
      put: (request: FakeRequest) => {
        stored.push(request.url);
        return Promise.resolve();
      },
      add: (request: FakeRequest) => {
        stored.push(request.url);
        return Promise.resolve();
      },
    };
    const caches = {
      open: () => Promise.resolve(cache),
      match: cache.match,
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    };
    const self = {
      __cq: undefined as unknown,
      location: { origin: ORIGIN },
      addEventListener: (type: string, handler: Handler) => {
        handlers.set(type, handler);
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    };
    class FakeRequestCtor {
      readonly url: string;
      constructor(url: string) {
        this.url = new URL(url, ORIGIN).toString();
      }
    }
    runInNewContext(source, {
      self,
      URL,
      caches,
      fetch: network,
      Request: FakeRequestCtor,
      Response: { error: () => ({ error: true }) },
    });
    async function dispatch(request: FakeRequest): Promise<unknown> {
      const answered: { response: Promise<unknown> | null } = {
        response: null,
      };
      handlers.get("fetch")?.({
        request,
        respondWith: (response: Promise<unknown>) => {
          answered.response = response;
        },
      });
      return answered.response === null
        ? "NOT_INTERCEPTED"
        : await answered.response;
    }
    async function install(): Promise<void> {
      let pending: Promise<unknown> = Promise.resolve();
      handlers.get("install")?.({
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise;
        },
      });
      await pending;
    }
    return { dispatch, install, stored, offline };
  }

  const ok = { ok: true, type: "basic", clone: () => ok };

  it("precaches the offline page, and only the offline page, on install", async () => {
    const worker = harness(() => Promise.resolve(ok));
    await worker.install();
    expect(worker.stored).toEqual([`${ORIGIN}/offline.html`]);
  });

  it("answers a failed navigation with the offline page and stores nothing", async () => {
    const worker = harness(() => Promise.reject(new TypeError("offline")));
    const response = await worker.dispatch({
      ...get("/discover"),
      mode: "navigate",
    });
    expect(response).toBe(worker.offline);
    expect(worker.stored).toEqual([]);
  });

  it("passes a working navigation through without storing it", async () => {
    const page = { ok: true, type: "basic", clone: () => page };
    const worker = harness(() => Promise.resolve(page));
    expect(await worker.dispatch({ ...get("/home"), mode: "navigate" })).toBe(
      page,
    );
    expect(worker.stored).toEqual([]);
  });

  it.each(["/auth/callback?code=abc", "/api/q-stream/v1", "/v1/me"])(
    "does not touch the navigation %s at all",
    async (path) => {
      const worker = harness(() => Promise.resolve(ok));
      expect(await worker.dispatch({ ...get(path), mode: "navigate" })).toBe(
        "NOT_INTERCEPTED",
      );
    },
  );

  it.each([
    { ...get("/v1/companies/1/pitch/2/playback") },
    { ...get("/api/pitch-captions/abc") },
    { ...get("/_next/static/media/pitch.mp4") },
    { ...get("/icons/pitch.m3u8") },
    { ...get("/_next/static/chunk.js"), destination: "video" },
    {
      ...get("/_next/static/chunk.js"),
      headers: { has: (name: string) => name === "range" },
    },
    get("/video/abc/manifest/video.m3u8?token=signed", "https://cdn.test"),
  ])(
    "never stores API, media, ranged or signed requests: %o",
    async (request) => {
      const worker = harness(() => Promise.resolve(ok));
      expect(await worker.dispatch(request)).toBe("NOT_INTERCEPTED");
      expect(worker.stored).toEqual([]);
    },
  );

  it("stores a hashed build asset once fetched", async () => {
    const worker = harness(() => Promise.resolve(ok));
    await worker.dispatch(get("/_next/static/chunks/app-abc.js"));
    expect(worker.stored).toEqual([`${ORIGIN}/_next/static/chunks/app-abc.js`]);
  });
});
