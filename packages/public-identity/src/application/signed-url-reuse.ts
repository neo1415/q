import type { ProfileImageStorage } from "./profile-images.js";

/**
 * Egress (Supabase restricted the project for its egress quota, 2026-10-24):
 * every list, card and approval signed its pictures afresh, so each photo
 * and cover had a new URL on every response and the browser fetched its
 * bytes again each time. A picture's object key never changes (a new
 * upload is a new key), so the URL signed for it is handed out again while
 * it has at least half its life left: the same URL, the browser's cached
 * copy. Only pictures come through here; authorisation is decided before
 * any signing, exactly as before.
 */

/** Signed pictures remembered per process before the oldest are dropped. */
const REMEMBERED_MAX = 5_000;

export function reuseSignedPictureUrls(
  storage: ProfileImageStorage,
  now: () => number = Date.now,
): ProfileImageStorage {
  const remembered = new Map<
    string,
    { readonly url: string; readonly expiresAt: number }
  >();
  const keyOf = (bucket: string, key: string) => `${bucket}\u0000${key}`;
  const fresh = (id: string, ttlSeconds: number): string | null => {
    const held = remembered.get(id);
    if (held === undefined) return null;
    if (held.expiresAt - now() < (ttlSeconds * 1000) / 2) {
      remembered.delete(id);
      return null;
    }
    return held.url;
  };
  const remember = (id: string, url: string, ttlSeconds: number) => {
    remembered.delete(id);
    remembered.set(id, { url, expiresAt: now() + ttlSeconds * 1000 });
    while (remembered.size > REMEMBERED_MAX) {
      const oldest = remembered.keys().next().value;
      if (oldest === undefined) break;
      remembered.delete(oldest);
    }
  };
  const batch = storage.createDownloadAuthorizations;
  return {
    ...storage,
    createDownloadAuthorization: async (input) => {
      const id = keyOf(input.object.bucket, input.object.key);
      const held = fresh(id, input.expiresInSeconds);
      if (held !== null) return { url: held };
      const signed = await storage.createDownloadAuthorization(input);
      remember(id, signed.url, input.expiresInSeconds);
      return signed;
    },
    ...(batch === undefined
      ? {}
      : {
          createDownloadAuthorizations: async (input) => {
            const held = input.keys.map((key) =>
              fresh(keyOf(input.bucket, key), input.expiresInSeconds),
            );
            const missing = input.keys.filter((_, at) => held[at] === null);
            const signed =
              missing.length === 0
                ? []
                : await batch({ ...input, keys: missing });
            const byKey = new Map<string, string | null>();
            missing.forEach((key, at) => {
              const url = signed[at] ?? null;
              byKey.set(key, url);
              if (url !== null) {
                remember(keyOf(input.bucket, key), url, input.expiresInSeconds);
              }
            });
            return input.keys.map(
              (key, at) => held[at] ?? byKey.get(key) ?? null,
            );
          },
        }),
  };
}
