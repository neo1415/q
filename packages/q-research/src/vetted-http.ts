import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

import { judgePublicUrl } from "./domain/url-safety.js";

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
  /**
   * True when only the first `maxBytes` (or the part up to the `prefix`
   * markers) was read, by request (`prefix`); never set otherwise.
   */
  readonly truncated?: boolean | undefined;
};

/** One hop, already vetted: connect to `address`, speak to `url`'s host. */
export type Transport = (input: {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
  readonly accept: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  /** Keep the first `maxBytes` instead of refusing a longer body. */
  readonly prefix?: PrefixRead | undefined;
}) => Promise<{
  readonly status: number;
  readonly location: string | null;
  readonly contentType: string;
  /** Null when the body ran past `maxBytes` (and no prefix was asked for). */
  readonly body: Uint8Array | null;
  readonly truncated?: boolean | undefined;
}>;

/**
 * Read a bounded prefix rather than refuse a long body (a 1.27 MB home
 * page whose <head> is in its first kilobytes). `stopAfter`: stop as
 * soon as every one of these ASCII markers has been read (matched without
 * regard to case), e.g. "</head>" and "</header>". The hard cap is
 * still `maxBytes`.
 */
export type PrefixRead = { readonly stopAfter?: readonly string[] | undefined };

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
        let cut = false;
        const markers = input.prefix?.stopAfter ?? [];
        // Markers are looked for in what is new, with a short overlap so
        // one split across two chunks is still seen.
        const longest = Math.max(0, ...markers.map((m) => m.length));
        const seen = new Set<string>();
        let tail = "";
        response.on("data", (chunk: Buffer) => {
          if (over || cut) return;
          const room = input.maxBytes - total;
          if (chunk.byteLength > room) {
            if (input.prefix === undefined) {
              over = true;
            } else {
              chunks.push(chunk.subarray(0, room));
              total += room;
              cut = true;
            }
            response.destroy();
            return;
          }
          total += chunk.byteLength;
          chunks.push(chunk);
          if (markers.length > 0) {
            const window = (tail + chunk.toString("latin1")).toLowerCase();
            for (const marker of markers) {
              if (window.includes(marker.toLowerCase())) seen.add(marker);
            }
            tail = window.slice(-longest);
            if (seen.size === markers.length) {
              cut = true;
              response.destroy();
            }
          }
        });
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve({
            status,
            location,
            contentType,
            body: over ? null : new Uint8Array(Buffer.concat(chunks)),
            truncated: cut,
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

/**
 * Why a vetted fetch refused, precise enough to tell a person what went
 * wrong with their website without showing them a stack trace.
 */
export type VettedRefusal =
  | "INVALID_URL"
  | "BLOCKED_ADDRESS"
  | "OFF_SITE_REDIRECT"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "HTTP_ERROR"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS";

export type VettedFetchResult =
  | { readonly ok: true; readonly response: VettedResponse }
  | { readonly ok: false; readonly reason: VettedRefusal };

type GetOptions = {
  readonly accept: string;
  readonly maxBytes: number;
  readonly sameSite?: ((url: URL) => boolean) | undefined;
  /** Read the first `maxBytes` rather than refuse a longer body. */
  readonly prefix?: PrefixRead | undefined;
};

export type VettedHttp = {
  /**
   * GET a public URL, following at most `redirects` redirects, each one
   * vetted again and kept within `sameSite` when given. Null when the
   * URL, any resolved address, a redirect, the time or the size refuses.
   */
  readonly get: (
    url: string,
    options: GetOptions,
  ) => Promise<VettedResponse | null>;
};

/** The same client, saying why it refused (GateQ brand from website). */
export type VettedHttpWithReasons = VettedHttp & {
  readonly fetch: (
    url: string,
    options: GetOptions,
  ) => Promise<VettedFetchResult>;
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
): VettedHttpWithReasons {
  const resolve = dependencies.resolve ?? systemResolver;
  const transport = dependencies.transport ?? nodeTransport;
  const allowed = dependencies.isAllowed ?? isPublicAddress;
  const timeoutMs = dependencies.timeoutMs ?? 6_000;
  const redirects = dependencies.redirects ?? 2;

  const refuse = (reason: VettedRefusal): VettedFetchResult => ({
    ok: false,
    reason,
  });

  const fetchVetted = async (
    start: string,
    options: GetOptions,
  ): Promise<VettedFetchResult> => {
    let current = start;
    for (let hop = 0; hop <= redirects; hop += 1) {
      const verdict = judgePublicUrl(current);
      if (!verdict.ok)
        return refuse(hop === 0 ? "INVALID_URL" : "BLOCKED_ADDRESS");
      const url = new URL(verdict.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return refuse("INVALID_URL");
      }
      if (options.sameSite !== undefined && !options.sameSite(url)) {
        return refuse(hop === 0 ? "INVALID_URL" : "OFF_SITE_REDIRECT");
      }
      const host = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: Awaited<ReturnType<Resolver>>;
      try {
        addresses =
          isIP(host) === 0
            ? await resolve(host)
            : [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
      } catch {
        return refuse("DNS_FAILED");
      }
      if (addresses.length === 0) return refuse("DNS_FAILED");
      // Every address must be public: a name with one private answer
      // is a rebinding attempt waiting for the right moment.
      if (!addresses.every((entry) => allowed(entry.address))) {
        return refuse("BLOCKED_ADDRESS");
      }
      const chosen = addresses[0];
      if (chosen === undefined) return refuse("DNS_FAILED");
      let response: Awaited<ReturnType<Transport>>;
      try {
        response = await transport({
          url,
          address: chosen.address,
          family: chosen.family,
          accept: options.accept,
          maxBytes: options.maxBytes,
          timeoutMs,
          ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
        });
      } catch (error: unknown) {
        return refuse(
          error instanceof Error && /timed? ?out/iu.test(error.message)
            ? "TIMEOUT"
            : "UNREACHABLE",
        );
      }
      if (response.status >= 300 && response.status < 400) {
        if (response.location === null) return refuse("HTTP_ERROR");
        try {
          current = new URL(response.location, url).href;
        } catch {
          return refuse("HTTP_ERROR");
        }
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return refuse("HTTP_ERROR");
      }
      if (response.body === null) return refuse("TOO_LARGE");
      // The bound holds whatever the transport did: past it is a refusal,
      // or, when a prefix was asked for, the first maxBytes only.
      let body = response.body;
      let truncated = response.truncated === true;
      if (body.byteLength > options.maxBytes) {
        if (options.prefix === undefined) return refuse("TOO_LARGE");
        body = body.slice(0, options.maxBytes);
        truncated = true;
      }
      return {
        ok: true,
        response: {
          url: url.href,
          status: response.status,
          contentType: response.contentType,
          body,
          ...(truncated ? { truncated: true } : {}),
        },
      };
    }
    return refuse("TOO_MANY_REDIRECTS");
  };

  return {
    fetch: fetchVetted,
    get: async (start, options) => {
      const result = await fetchVetted(start, options);
      return result.ok ? result.response : null;
    },
  };
}
