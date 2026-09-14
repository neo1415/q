/**
 * Public-URL safety (CQ-Q-RESEARCH-001 §11; doc 15 §40, §71; doc 16 TM-WEB-04).
 *
 * Extract is not an arbitrary fetch primitive. Every URL that may be read —
 * whether it came from a search result or from a model's argument — is
 * normalised and judged here first. Only ordinary public http(s)
 * destinations pass: no loopback, no private or link-local ranges, no
 * cloud metadata endpoints, no embedded credentials, no other schemes.
 *
 * The check is string- and literal-IP-based. Capital Q never connects to
 * these hosts itself — the provider does — so the DNS-rebinding class of
 * SSRF does not apply to this process; the check exists so Capital Q never
 * asks a provider to read something that is not public.
 */

export type UrlSafetyVerdict =
  | { readonly ok: true; readonly url: string; readonly domain: string }
  | { readonly ok: false; readonly reason: UrlRejectionReason };

export const URL_REJECTION_REASONS = [
  "UNPARSEABLE",
  "SCHEME_NOT_ALLOWED",
  "EMBEDDED_CREDENTIALS",
  "LOOPBACK_OR_LOCAL",
  "PRIVATE_OR_LINK_LOCAL",
  "METADATA_ENDPOINT",
  "NOT_A_PUBLIC_HOST",
  "TOO_LONG",
] as const;
export type UrlRejectionReason = (typeof URL_REJECTION_REASONS)[number];

const MAX_URL_CHARS = 2_048;

const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
  "100.100.100.200",
  "fd00:ec2::254",
]);

const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
];

function ipv4Parts(host: string): readonly number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) {
    return null;
  }
  const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(parts: readonly number[]): boolean {
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    a === 0 ||
    a >= 224
  );
}

function isLoopbackIpv4(parts: readonly number[]): boolean {
  return parts[0] === 127;
}

function classifyIpv6(host: string): UrlRejectionReason | null {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "::1" || bare === "::" || bare === "0:0:0:0:0:0:0:1") {
    return "LOOPBACK_OR_LOCAL";
  }
  if (
    bare.startsWith("fe80:") ||
    bare.startsWith("fc") ||
    bare.startsWith("fd")
  ) {
    return "PRIVATE_OR_LINK_LOCAL";
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  const mappedV4 =
    dotted !== null
      ? (dotted[1] ?? "")
      : hex !== null
        ? [
            Number.parseInt(hex[1] ?? "0", 16) >> 8,
            Number.parseInt(hex[1] ?? "0", 16) & 0xff,
            Number.parseInt(hex[2] ?? "0", 16) >> 8,
            Number.parseInt(hex[2] ?? "0", 16) & 0xff,
          ].join(".")
        : null;
  if (mappedV4 !== null) {
    const parts = ipv4Parts(mappedV4);
    if (parts === null) {
      return "NOT_A_PUBLIC_HOST";
    }
    if (isLoopbackIpv4(parts)) {
      return "LOOPBACK_OR_LOCAL";
    }
    if (isPrivateIpv4(parts)) {
      return "PRIVATE_OR_LINK_LOCAL";
    }
  }
  return null;
}

/**
 * Normalise a candidate URL and decide whether a provider may be asked to
 * read it. The returned `url` drops fragments and credentials and lowercases
 * the host; the `domain` is the registrable-looking host without `www.`.
 */
export function judgePublicUrl(candidate: string): UrlSafetyVerdict {
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_CHARS) {
    return {
      ok: false,
      reason: trimmed.length === 0 ? "UNPARSEABLE" : "TOO_LONG",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "UNPARSEABLE" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "SCHEME_NOT_ALLOWED" };
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reason: "EMBEDDED_CREDENTIALS" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return { ok: false, reason: "UNPARSEABLE" };
  }
  if (METADATA_HOSTS.has(host)) {
    return { ok: false, reason: "METADATA_ENDPOINT" };
  }
  if (
    host === "localhost" ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { ok: false, reason: "LOOPBACK_OR_LOCAL" };
  }
  if (host.startsWith("[") || host.includes(":")) {
    const reason = classifyIpv6(host);
    return reason === null
      ? { ok: false, reason: "NOT_A_PUBLIC_HOST" }
      : { ok: false, reason };
  }
  const v4 = ipv4Parts(host);
  if (v4 !== null) {
    if (isLoopbackIpv4(v4)) {
      return { ok: false, reason: "LOOPBACK_OR_LOCAL" };
    }
    if (isPrivateIpv4(v4)) {
      return { ok: false, reason: "PRIVATE_OR_LINK_LOCAL" };
    }
    // A bare public IP address is not how public information is published.
    return { ok: false, reason: "NOT_A_PUBLIC_HOST" };
  }
  if (!host.includes(".")) {
    return { ok: false, reason: "NOT_A_PUBLIC_HOST" };
  }
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  parsed.hostname = host;
  return {
    ok: true,
    url: parsed.toString(),
    domain: host.replace(/^www\./, ""),
  };
}

/** The registrable-looking domain of a URL, or null when it is not a public URL. */
export function publicDomainOf(
  candidate: string | null | undefined,
): string | null {
  if (candidate === null || candidate === undefined) {
    return null;
  }
  const verdict = judgePublicUrl(candidate);
  return verdict.ok ? verdict.domain : null;
}
