/**
 * What the data-rights context needs from the outside, as ports. The
 * Supabase document storage adapter (evidence) satisfies the storage port
 * structurally; the auth port is the Auth admin API in production and a
 * plain function in tests. No provider SDK is imported here.
 */

export type DataRightsObjectRef = {
  readonly bucket: string;
  readonly key: string;
};

export type DataRightsStorage = {
  readonly putObject: (input: {
    readonly object: DataRightsObjectRef;
    readonly body: Uint8Array;
    readonly contentType: string;
  }) => Promise<void>;
  readonly openObjectStream: (
    object: DataRightsObjectRef,
  ) => Promise<{ readonly body: AsyncIterable<Uint8Array> }>;
  /** Idempotent: an object already gone is success. */
  readonly deleteObject: (object: DataRightsObjectRef) => Promise<void>;
  readonly createDownloadAuthorization: (input: {
    readonly object: DataRightsObjectRef;
    readonly expiresInSeconds: number;
    readonly downloadFilename?: string | undefined;
  }) => Promise<{ readonly url: string; readonly providerExpiresAt: string }>;
};

/**
 * Removes the sign-in account and with it every session and refresh token
 * (Supabase deletes them with the user). Idempotent: an account already
 * gone is success.
 */
export type AuthAccountRemover = {
  readonly removeAuthAccount: (authUserId: string) => Promise<void>;
};

export const DATA_EXPORT_BUCKET = "cq-data-exports-private" as const;

export type DataRightsLogger = {
  readonly info: (
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => void;
  readonly warn: (
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => void;
};

/**
 * The Supabase Auth admin API: `DELETE /auth/v1/admin/users/:id` with the
 * server's privileged key, which also ends every session. Only ever
 * constructed in a deployable from its own secrets.
 */
export function createSupabaseAuthAccountRemover(options: {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly fetch?: typeof fetch | undefined;
}): AuthAccountRemover {
  const call = options.fetch ?? fetch;
  const base = options.supabaseUrl.replace(/\/+$/u, "");
  return {
    removeAuthAccount: async (authUserId) => {
      if (!/^[0-9a-f-]{36}$/u.test(authUserId)) throw new Error("bad auth id");
      const response = await call(
        `${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${options.secretKey}`,
            apikey: options.secretKey,
          },
          signal: AbortSignal.timeout(15_000),
        },
      ).catch(() => null);
      // Already gone is the state we wanted. The provider's body is never
      // read into an error (it may carry the URL).
      if (response !== null && (response.ok || response.status === 404)) return;
      throw new Error("AUTH_ACCOUNT_REMOVAL_FAILED");
    },
  };
}
