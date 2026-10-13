import {
  createTavusClient,
  TavusError,
  type TavusClient,
  type TavusFailureKind,
} from "./client.js";

/** One configured, explicitly entitled account. Refusals never rotate accounts. */

/** How long a key that failed for this reason is passed over. */
const COOLDOWN_MS: Readonly<
  Record<Exclude<TavusFailureKind, "OTHER">, number>
> = {
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
  const raw = env.TAVUS_API_KEY ?? env.CQ_TAVUS_API_KEYS ?? "";
  const keys: string[] = [];
  for (const part of raw.split(/[\s,]+/u)) {
    const key = part.trim();
    // A key is an opaque token; anything else (a quote, a label) is a
    // configuration mistake and is skipped rather than sent to the provider.
    if (!/^[A-Za-z0-9_-]{16,256}$/u.test(key)) continue;
    if (!keys.includes(key)) keys.push(key);
    if (keys.length === TAVUS_MAX_KEYS) break;
  }
  return keys.length === 1 ? keys : [];
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
   * Runs `work` with the sole account; refusals fail closed. Returns the value and the key's index.
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
  const clients = dependencies.keys.slice(0, 1).map((key) => make(key));
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
