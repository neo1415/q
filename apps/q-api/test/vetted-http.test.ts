import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  createVettedHttp,
  isPublicAddress,
  type Resolver,
  type Transport,
} from "../src/composition/vetted-http.js";

/**
 * DOCS (ADR 0031): the website read cannot be turned into a request to
 * anything private -- not by the name, not by what it resolves to, not by
 * a redirect, not by IPv6 spellings of a private IPv4 address.
 */

describe("which addresses are public", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2a00:1450:4009:81f::200e",
  ])("%s is public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    // IPv4 private, loopback, link-local/metadata, CGNAT, reserved.
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    // IPv6 loopback, unspecified, link-local, unique local, multicast.
    "::1",
    "::",
    "fe80::1",
    "fe80::1%eth0",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    // IPv4 hidden inside IPv6.
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "2001:0:4136:e378::1",
    // Not an address at all.
    "localhost",
    "",
  ])("%s is refused", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

type Call = Parameters<Transport>[0];

function harness(
  dns: Readonly<Record<string, readonly string[]>>,
  pages: Readonly<
    Record<string, { status?: number; location?: string; body?: string | null }>
  >,
) {
  const calls: Call[] = [];
  const resolve: Resolver = (hostname) => {
    const found = dns[hostname];
    if (found === undefined) {
      return Promise.reject(new Error("ENOTFOUND"));
    }
    return Promise.resolve(
      found.map((address) => ({
        address,
        family: address.includes(":") ? (6 as const) : (4 as const),
      })),
    );
  };
  const transport: Transport = (input) => {
    calls.push(input);
    const page = pages[input.url.href] ?? { status: 404 };
    return Promise.resolve({
      status: page.status ?? 200,
      location: page.location ?? null,
      contentType: "text/html",
      body:
        page.body === null
          ? null
          : new TextEncoder().encode(page.body ?? "<html></html>"),
    });
  };
  return {
    http: createVettedHttp({ resolve, transport }),
    calls,
  };
}

const GET = { accept: "text/html", maxBytes: 1_000_000 } as const;

describe("the vetted client", () => {
  it("connects to the vetted address and speaks to the original name", async () => {
    const { http, calls } = harness(
      { "www.example.com": ["93.184.216.34"] },
      { "https://www.example.com/": { body: "<html>ok</html>" } },
    );
    const page = await http.get("https://www.example.com/", GET);
    expect(new TextDecoder().decode(page?.body)).toBe("<html>ok</html>");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.address).toBe("93.184.216.34");
    expect(calls[0]?.url.hostname).toBe("www.example.com");
  });

  it("refuses a name that resolves to a private address, without connecting", async () => {
    const { http, calls } = harness(
      { "evil.example.com": ["169.254.169.254"] },
      {},
    );
    expect(await http.get("https://evil.example.com/", GET)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("refuses DNS rebinding: one public and one private answer is a refusal", async () => {
    const { http, calls } = harness(
      { "rebind.example.com": ["93.184.216.34", "127.0.0.1"] },
      {},
    );
    expect(await http.get("https://rebind.example.com/", GET)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("refuses IPv4-mapped and NAT64 IPv6 answers", async () => {
    for (const address of ["::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "::1"]) {
      const { http, calls } = harness({ "v6.example.com": [address] }, {});
      expect(await http.get("https://v6.example.com/", GET)).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it("re-vets every redirect: one to a private host is refused", async () => {
    const { http, calls } = harness(
      {
        "www.example.com": ["93.184.216.34"],
        "internal.example.com": ["10.0.0.7"],
      },
      {
        "https://www.example.com/": {
          status: 302,
          location: "https://internal.example.com/admin",
        },
      },
    );
    expect(await http.get("https://www.example.com/", GET)).toBeNull();
    expect(calls.map((call) => call.url.href)).toEqual([
      "https://www.example.com/",
    ]);
  });

  it("refuses redirects to literal private addresses, IPv6 spellings included", async () => {
    for (const location of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::1]:8080/",
      "http://[fd00::1]/",
    ]) {
      const { http, calls } = harness(
        { "www.example.com": ["93.184.216.34"] },
        { "https://www.example.com/": { status: 301, location } },
      );
      expect(
        await http.get("https://www.example.com/", GET),
        location,
      ).toBeNull();
      expect(calls).toHaveLength(1);
    }
  });

  it("keeps redirects on the same site when asked, and caps them", async () => {
    const offSite = harness(
      {
        "www.example.com": ["93.184.216.34"],
        "other.net": ["93.184.216.35"],
      },
      {
        "https://www.example.com/": {
          status: 302,
          location: "https://other.net/",
        },
      },
    );
    expect(
      await offSite.http.get("https://www.example.com/", {
        ...GET,
        sameSite: (url) => url.hostname.endsWith("example.com"),
      }),
    ).toBeNull();

    const loop = harness(
      { "www.example.com": ["93.184.216.34"] },
      {
        "https://www.example.com/a": { status: 302, location: "/b" },
        "https://www.example.com/b": { status: 302, location: "/c" },
        "https://www.example.com/c": { status: 302, location: "/d" },
        "https://www.example.com/d": { body: "too far" },
      },
    );
    expect(await loop.http.get("https://www.example.com/a", GET)).toBeNull();
    expect(loop.calls).toHaveLength(3);
  });

  it("refuses a body over the size cap and an error status", async () => {
    const { http } = harness(
      { "www.example.com": ["93.184.216.34"] },
      {
        "https://www.example.com/big": { body: null },
        "https://www.example.com/gone": { status: 500 },
      },
    );
    expect(await http.get("https://www.example.com/big", GET)).toBeNull();
    expect(await http.get("https://www.example.com/gone", GET)).toBeNull();
  });
});

describe("the real socket path", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  async function serve(): Promise<{
    port: number;
    seen: IncomingHttpHeaders[];
  }> {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((request, response) => {
      seen.push(request.headers);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>served</html>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    close = () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    return { port: (server.address() as AddressInfo).port, seen };
  }

  it("pins the socket to the vetted address and keeps the Host header", async () => {
    const { port, seen } = await serve();
    const http = createVettedHttp({
      resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      // Loopback allowed only to exercise the socket plumbing here.
      isAllowed: () => true,
    });
    const page = await http.get(
      `http://brand.example.com:${String(port)}/`,
      GET,
    );
    expect(new TextDecoder().decode(page?.body)).toBe("<html>served</html>");
    expect(seen[0]?.host).toBe(`brand.example.com:${String(port)}`);
  });

  it("with the production rule, a name resolving to loopback never connects", async () => {
    const { port, seen } = await serve();
    const http = createVettedHttp({
      resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
    });
    expect(
      await http.get(`http://brand.example.com:${String(port)}/`, GET),
    ).toBeNull();
    expect(seen).toEqual([]);
  });

  it("stops a body that runs past the cap", async () => {
    const { port } = await serve();
    const http = createVettedHttp({
      resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      isAllowed: () => true,
    });
    expect(
      await http.get(`http://brand.example.com:${String(port)}/`, {
        accept: "text/html",
        maxBytes: 5,
      }),
    ).toBeNull();
  });
});
