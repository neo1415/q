import {
  createTavusClient,
  TavusError,
  type TavusClient,
  type TavusFailureKind,
} from "./client.js";

/**
 * The configured Tavus keys (owner directive 2026-10-12: the six supplied
 * keys are all used). A session takes the first healthy key in order and
 * moves to the next ONLY when the provider refuses that key (AUTH), its
 * account is out of credit (CREDIT) or at a usage or concurrency limit
 * (QUOTA). Any other failure is the provider's, not the key's, and is not
 * retried on another account. The chosen key is recorded on the session
 * by INDEX, never value, so ending and cleanup use the same account.
 *
 * Keys live only in server configuration (CQ_TAVUS_API_KEYS, comma or
 * whitespace separated; TAVUS_API_KEY as a single-key fallback). They are
 * never logged, returned, or put in a prompt; logs carry the index.
 *
 * ADR 0066 point 4 says keys are not pooled to evade a plan's limits and a
 * further key is used only when the owner records that it is a separately
 * entitled account. Moving on at CREDIT/QUOTA relies on that record.
 */

/** How long a key that failed for this reason is passed over. */
const COOLDOWN_MS: Readonly<Record<Exclude<TavusFailureKind, "OTHER">, number>> =
  {
    AUTH: 60 * 60_000,
    CREDIT: 60 * 60_000,
    QUOTA: 60_000,
  };

/** At most this many keys; the session row's index column is bounded too. */
export const TAVUS_MAX_KEYS = 32;

/** The keys from configuration, in order, de-duplicated; never logged. */
export function tavusKeysFrom(env: {
  readonly CQ_TAVUS_API_KEYS?: string | undefined;
  readonly TAVUS_API_KEY?: string | undefined;
}): readonly string[] {
  const raw = [env.CQ_TAVUS_API_KEYS ?? "", env.TAVUS_API_KEY ?? ""].join(",");
  const keys: string[] = [];
  for (const part of raw.split(/[\s,]+/u)) {
    const key = part.trim();
    // A key is an opaque token; anything else (a quote, a label) is a
    // configuration mistake and is skipped rather than sent to the provider.
    if (!/^[A-Za-z0-9_-]{16,256}$/u.test(key)) continue;
    if (!keys.includes(key)) keys.push(key);
    if (keys.length === TAVUS_MAX_KEYS) break;
  }
  return keys;
}

export type TavusKeyHealth = {
  readonly index: number;
  readonly healthy: boolean;
  readonly lastFailure: TavusFailureKind | null;
};

export class TavusKeysExhaustedError extends Error {
  constructor() {
    super("No configured Tavus key is available");
    this.name = "TavusKeysExhaustedError";
  }
}

export type TavusKeyPool = {
  readonly size: number;
  /**
   * Runs `work` with the first healthy key, moving to the next only on an
   * AUTH, CREDIT or QUOTA refusal. Returns the value and the key's index.
   */
  readonly withHealthyKey: <T>(
    work: (client: TavusClient, keyIndex: number) => Promise<T>,
  ) => Promise<{ readonly value: T; readonly keyIndex: number }>;
  /** The client for a recorded index (ending, cleanup), or null. */
  readonly clientAt: (keyIndex: number) => TavusClient | null;
  readonly health: () => readonly TavusKeyHealth[];
};

export function createTavusKeyPool(dependencies: {
  readonly keys: readonly string[];
  readonly createClient?: ((apiKey: string) => TavusClient) | undefined;
  readonly now?: (() => number) | undefined;
  readonly onKeyFailure?:
    | ((event: {
        readonly keyIndex: number;
        readonly kind: TavusFailureKind;
        readonly status: number;
      }) => void)
    | undefined;
}): TavusKeyPool {
  const now = dependencies.now ?? Date.now;
  const make =
    dependencies.createClient ??
    ((apiKey: string) => createTavusClient({ apiKey }));
  const clients = dependencies.keys
    .slice(0, TAVUS_MAX_KEYS)
    .map((key) => make(key));
  const until = clients.map(() => 0);
  const last: (TavusFailureKind | null)[] = clients.map(() => null);

  return {
    size: clients.length,
    withHealthyKey: async (work) => {
      for (const [keyIndex, client] of clients.entries()) {
        if ((until[keyIndex] ?? 0) > now()) continue;
        try {
          const value = await work(client, keyIndex);
          last[keyIndex] = null;
          return { value, keyIndex };
        } catch (error: unknown) {
          if (!(error instanceof TavusError) || error.kind === "OTHER") {
            throw error;
          }
          until[keyIndex] = now() + COOLDOWN_MS[error.kind];
          last[keyIndex] = error.kind;
          dependencies.onKeyFailure?.({
            keyIndex,
            kind: error.kind,
            status: error.status,
          });
        }
      }
      throw new TavusKeysExhaustedError();
    },
    clientAt: (keyIndex) =>
      Number.isInteger(keyIndex) ? (clients[keyIndex] ?? null) : null,
    health: () =>
      clients.map((_, index) => ({
        index,
        healthy: (until[index] ?? 0) <= now(),
        lastFailure: last[index] ?? null,
      })),
  };
}
