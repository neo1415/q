import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

import { judgePublicUrl } from "@capital-q/q-research";

/**
 * Fetching a public web page without reaching anything private (DOCS,
 * ADR 0031).
 *
 * A hostname check is not enough: a name can resolve to 127.0.0.1, a
 * cloud metadata address, or a private range (or resolve to a public
 * address for the check and a private one for the connection: DNS
 * rebinding). So this resolves the name itself, refuses the request when
 * ANY resolved address is not public, and hands the socket exactly the
 * address it vetted through the request's own `lookup`, so nothing
 * resolves twice. The URL's hostname stays the Host header and the TLS
 * SNI, so certificates are checked against the name, not the IP.
 * Redirects are followed by hand, each hop vetted again from scratch;
 * time and size are capped per hop.
 */

/** Addresses no public fetch may reach, IPv4 and IPv6. */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible (deprecated): never a public route
  ["64:ff9b::", 96], // NAT64: would reach the embedded IPv4 address
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo: tunnels to an embedded IPv4 address
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: tunnels to an embedded IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

/**
 * True only for a public unicast address. IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`, `::ffff:7f00:1`) is judged by its IPv4 address.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  return !PRIVATE.check(bare, family === 6 ? "ipv6" : "ipv4");
}

export type Resolver = (
  hostname: string,
) => Promise<readonly { readonly address: string; readonly family: 4 | 6 }[]>;

export const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(
        addresses.map((entry) => ({
          address: entry.address,
          family: entry.family === 6 ? 6 : 4,
        })),
      );
    });
  });

export type VettedResponse = {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
};

/** One hop, already vetted: connect to `address`, speak to `url`'s host. */
export type Transport = (input: {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
  readonly accept: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}) => Promise<{
  readonly status: number;
  readonly location: string | null;
  readonly contentType: string;
  /** Null when the body ran past `maxBytes`. */
  readonly body: Uint8Array | null;
}>;

/** Node's own http(s), pinned to the vetted address through `lookup`. */
export const nodeTransport: Transport = (input) =>
  new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_hostname, options, callback) => {
      // Node asks for every address when autoSelectFamily is on.
      if (typeof options === "object" && options.all === true) {
        callback(null, [{ address: input.address, family: input.family }]);
        return;
      }
      callback(null, input.address, input.family);
    };
    const client = input.url.protocol === "https:" ? https : http;
    const request = client.request(
      input.url,
      {
        method: "GET",
        lookup: pinned,
        // The name, not the IP: Host header and TLS SNI/certificate.
        servername: input.url.hostname,
        headers: {
          accept: input.accept,
          "user-agent": "CapitalQ-BrandReader/1.0",
        },
        timeout: input.timeoutMs,
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location ?? null;
        const contentType = (
          response.headers["content-type"] ?? ""
        ).toLowerCase();
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, contentType, body: new Uint8Array() });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let over = false;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > input.maxBytes) {
            over = true;
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const done = () => {
          resolve({
            status,
            location,
            contentType,
            body: over ? null : new Uint8Array(Buffer.concat(chunks)),
          });
        };
        response.on("end", done);
        response.on("close", done);
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("timed out"));
    });
    // A whole-hop deadline, not only an idle one: a slow drip is a refusal.
    const deadline = setTimeout(() => {
      request.destroy(new Error("timed out"));
    }, input.timeoutMs);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", reject);
    request.end();
  });

export type VettedHttp = {
  /**
   * GET a public URL, following at most `redirects` redirects, each one
   * vetted again and kept within `sameSite` when given. Null when the
   * URL, any resolved address, a redirect, the time or the size refuses.
   */
  readonly get: (
    url: string,
    options: {
      readonly accept: string;
      readonly maxBytes: number;
      readonly sameSite?: ((url: URL) => boolean) | undefined;
    },
  ) => Promise<VettedResponse | null>;
};

export function createVettedHttp(
  dependencies: {
    readonly resolve?: Resolver | undefined;
    readonly transport?: Transport | undefined;
    /** Tests of the socket plumbing only; production uses isPublicAddress. */
    readonly isAllowed?: ((address: string) => boolean) | undefined;
    readonly timeoutMs?: number | undefined;
    readonly redirects?: number | undefined;
  } = {},
): VettedHttp {
  const resolve = dependencies.resolve ?? systemResolver;
  const transport = dependencies.transport ?? nodeTransport;
  const allowed = dependencies.isAllowed ?? isPublicAddress;
  const timeoutMs = dependencies.timeoutMs ?? 6_000;
  const redirects = dependencies.redirects ?? 2;

  return {
    get: async (start, options) => {
      let current = start;
      for (let hop = 0; hop <= redirects; hop += 1) {
        const verdict = judgePublicUrl(current);
        if (!verdict.ok) return null;
        const url = new URL(verdict.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        if (options.sameSite !== undefined && !options.sameSite(url)) {
          return null;
        }
        const host = url.hostname.replace(/^\[|\]$/g, "");
        let addresses: Awaited<ReturnType<Resolver>>;
        try {
          addresses =
            isIP(host) === 0
              ? await resolve(host)
              : [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
        } catch {
          return null;
        }
        // Every address must be public: a name with one private answer
        // is a rebinding attempt waiting for the right moment.
        if (
          addresses.length === 0 ||
          !addresses.every((entry) => allowed(entry.address))
        ) {
          return null;
        }
        const chosen = addresses[0];
        if (chosen === undefined) return null;
        let response: Awaited<ReturnType<Transport>>;
        try {
          response = await transport({
            url,
            address: chosen.address,
            family: chosen.family,
            accept: options.accept,
            maxBytes: options.maxBytes,
            timeoutMs,
          });
        } catch {
          return null;
        }
        if (response.status >= 300 && response.status < 400) {
          if (response.location === null) return null;
          try {
            current = new URL(response.location, url).href;
          } catch {
            return null;
          }
          continue;
        }
        if (response.status < 200 || response.status >= 300) return null;
        if (response.body === null) return null;
        return {
          url: url.href,
          status: response.status,
          contentType: response.contentType,
          body: response.body,
        };
      }
      return null;
    },
  };
}
