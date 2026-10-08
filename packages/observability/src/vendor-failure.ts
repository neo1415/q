import type { FailureClass } from "./failure-log.js";

/**
 * Is this error an outside vendor failing us, and how (recovery G-D9)?
 *
 * A request that needs a vendor (a speech provider's token, a realtime
 * session secret) and cannot get one is not a Capital Q bug: it is a
 * 503 the person can retry, and an operator wants it counted by class.
 * Before this, the raw `TypeError: fetch failed` fell through to the
 * generic 500 "unhandled request error".
 *
 * Recognised structurally (by name, code and status), so this package
 * needs no import of any adapter. Unknown errors return undefined and
 * keep their usual handling.
 */

export type VendorFailure = {
  /** UNREACHABLE: no answer at all; TIMEOUT: too slow; VENDOR_ERROR: it answered no. */
  readonly kind: "UNREACHABLE" | "TIMEOUT" | "VENDOR_ERROR";
  readonly failureClass: Extract<
    FailureClass,
    "NETWORK" | "TIMEOUT" | "TOOL_UNAVAILABLE"
  >;
  /** Whether trying again soon may work (a 503 with Retry-After). */
  readonly retryable: boolean;
  /** The vendor's HTTP status, when it answered. */
  readonly vendorStatus?: number | undefined;
};

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

/** Model failure classes the next attempt may get past. */
const RETRYABLE_PROVIDER_CLASSES = new Set([
  "TRANSIENT",
  "RATE_LIMIT",
  "PROVIDER_OUTAGE",
  "TIMEOUT",
]);

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function networkCode(error: unknown): string | undefined {
  const code = field(error, "code");
  return typeof code === "string" ? code : undefined;
}

function classifyOne(error: unknown): VendorFailure | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.name === "TimeoutError") {
    return { kind: "TIMEOUT", failureClass: "TIMEOUT", retryable: true };
  }
  const code = networkCode(error);
  if (
    (code !== undefined &&
      (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_"))) ||
    (error instanceof TypeError && error.message.startsWith("fetch failed"))
  ) {
    return code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT"
      ? { kind: "TIMEOUT", failureClass: "TIMEOUT", retryable: true }
      : { kind: "UNREACHABLE", failureClass: "NETWORK", retryable: true };
  }
  if (error.name === "ModelProviderFailure") {
    const failureClass = field(error, "failureClass");
    const status = field(error, "providerStatus");
    if (failureClass === "TIMEOUT") {
      return { kind: "TIMEOUT", failureClass: "TIMEOUT", retryable: true };
    }
    return {
      kind: "VENDOR_ERROR",
      failureClass: "TOOL_UNAVAILABLE",
      retryable:
        typeof failureClass === "string" &&
        RETRYABLE_PROVIDER_CLASSES.has(failureClass),
      vendorStatus: typeof status === "number" ? status : undefined,
    };
  }
  // A speech provider that answered but would not issue a session token.
  if (error.name === "DeepgramTokenError") {
    const status = field(error, "status");
    const vendorStatus = typeof status === "number" ? status : undefined;
    return {
      kind: "VENDOR_ERROR",
      failureClass: "TOOL_UNAVAILABLE",
      retryable:
        vendorStatus === undefined ||
        vendorStatus === 429 ||
        vendorStatus >= 500,
      vendorStatus,
    };
  }
  return undefined;
}

export function classifyVendorFailure(
  error: unknown,
): VendorFailure | undefined {
  // An adapter's own failure may wrap the network error that caused it;
  // the wrapper decides, unless it is unrecognised.
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined; depth += 1) {
    const found = classifyOne(current);
    if (found !== undefined) {
      // A wrapper that only says "transient" around a dead socket is
      // better described by the socket.
      if (found.kind === "VENDOR_ERROR" && found.vendorStatus === undefined) {
        const inner = classifyOne(field(current, "cause"));
        if (inner !== undefined && inner.kind !== "VENDOR_ERROR") return inner;
      }
      return found;
    }
    current = field(current, "cause");
  }
  return undefined;
}
