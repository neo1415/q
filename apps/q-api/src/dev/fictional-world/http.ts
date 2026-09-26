import { IDEMPOTENCY_KEY_HEADER } from "@capital-q/contracts";

/**
 * The fictional world's HTTP side: synthetic accounts through the Supabase
 * admin API, sessions without typing a password, and calls to the real
 * application API under each person's own session (SEED).
 *
 * Nothing here reaches into a table. A person is created the way
 * `dev:bootstrap` creates one, and everything that person owns is written
 * by the API route a browser would call, under the same authorization.
 * Values of keys and tokens are never printed.
 */

export type SeedTarget = {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly secretKey: string;
  readonly apiUrl: string;
};

export type ApiAnswer = { readonly status: number; readonly body: unknown };

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

/** Every account this seed creates carries these markers. */
export const FICTIONAL_ACCOUNT_DOMAIN = "fictional.capitalq.local";

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function createSeedHttp(target: SeedTarget) {
  const admin = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${target.supabaseUrl}/auth/v1/admin${path}`, {
      ...init,
      headers: {
        apikey: target.secretKey,
        authorization: `Bearer ${target.secretKey}`,
        "content-type": "application/json",
      },
    });

  /** Every auth user by lowercase email, read once; the admin API has no lookup by email. */
  let directory: Map<string, Record<string, unknown>> | null = null;
  const loadDirectory = async (): Promise<
    Map<string, Record<string, unknown>>
  > => {
    if (directory !== null) return directory;
    const found = new Map<string, Record<string, unknown>>();
    for (let page = 1; page <= 200; page += 1) {
      const response = await admin(`/users?page=${String(page)}&per_page=200`);
      if (!response.ok) {
        throw new SeedError(`admin list users: HTTP ${String(response.status)}`);
      }
      const users = record(await readJson(response))["users"];
      const list = Array.isArray(users) ? users : [];
      for (const user of list) {
        const email = record(user)["email"];
        if (typeof email === "string") found.set(email.toLowerCase(), record(user));
      }
      if (list.length < 200) break;
    }
    directory = found;
    return found;
  };

  /**
   * The synthetic account for a fictional person: created once, found on
   * every later run. An existing account is used only if it was created
   * synthetic AND as part of this fictional world, so a rerun can never
   * adopt somebody else's account.
   */
  const ensureAccount = async (input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
    readonly seedKey: string;
  }): Promise<{ readonly authUserId: string; readonly created: boolean }> => {
    const users = await loadDirectory();
    const existing = users.get(input.email.toLowerCase());
    if (existing !== undefined) {
      const meta = record(existing["user_metadata"]);
      const app = record(existing["app_metadata"]);
      if (
        meta["synthetic"] !== true ||
        meta["fictional_demo"] !== true ||
        app["synthetic"] !== true
      ) {
        throw new SeedError(
          `${input.email} exists but is not a fictional synthetic account; refusing to touch it`,
        );
      }
      const id = existing["id"];
      if (typeof id !== "string") throw new SeedError("account without id");
      return { authUserId: id, created: false };
    }
    const response = await admin("/users", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: {
          display_name: input.displayName,
          synthetic: true,
          fictional_demo: true,
          fictional_seed_key: input.seedKey,
        },
        // app_metadata is the marker the platform trusts (only the
        // service role can write it); user_metadata is the person's own.
        app_metadata: { synthetic: true, fictional_demo: true },
      }),
    });
    const body = record(await readJson(response));
    if (!response.ok) {
      throw new SeedError(
        `could not create ${input.email}: HTTP ${String(response.status)}`,
      );
    }
    const id = body["id"];
    if (typeof id !== "string") throw new SeedError("created account without id");
    users.set(input.email.toLowerCase(), body);
    return { authUserId: id, created: true };
  };

  /** A session without a password: an admin magic-link token, exchanged. */
  const sessionFor = async (email: string): Promise<string> => {
    const link = await admin("/generate_link", {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", email }),
    });
    if (!link.ok) {
      throw new SeedError(`generate_link: HTTP ${String(link.status)}`);
    }
    const linkBody = record(await readJson(link));
    const tokenHash =
      linkBody["hashed_token"] ?? record(linkBody["properties"])["hashed_token"];
    const verified = await fetch(`${target.supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: target.publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "email", token_hash: tokenHash }),
    });
    if (!verified.ok) {
      throw new SeedError(`verify: HTTP ${String(verified.status)}`);
    }
    const token = record(await readJson(verified))["access_token"];
    if (typeof token !== "string") throw new SeedError("no access token");
    return token;
  };

  /**
   * One API call under a person's session. Writes carry an idempotency
   * key: a stable one where the product deduplicates on it (so a rerun is
   * the same request), otherwise a fresh one.
   */
  const api = async (
    token: string,
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<ApiAnswer> => {
    const response = await fetch(`${target.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET"
          ? {}
          : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey ?? crypto.randomUUID() }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await readJson(response) };
  };

  /** The same call, where anything but 2xx is a failure worth stopping for. */
  const apiOk = async (
    token: string,
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> => {
    const answer = await api(token, method, path, body, idempotencyKey);
    if (answer.status < 200 || answer.status >= 300) {
      throw new SeedError(
        `${method} ${path}: HTTP ${String(answer.status)} ${JSON.stringify(answer.body).slice(0, 400)}`,
      );
    }
    return answer.body;
  };

  return { ensureAccount, sessionFor, api, apiOk };
}

export type SeedHttp = ReturnType<typeof createSeedHttp>;

export function asRecord(value: unknown): Record<string, unknown> {
  return record(value);
}
