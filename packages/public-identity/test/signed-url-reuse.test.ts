import { describe, expect, it } from "vitest";

import type { ProfileImageStorage } from "../src/application/profile-images.js";
import { reuseSignedPictureUrls } from "../src/application/signed-url-reuse.js";

/**
 * Egress (Supabase restricted the project, 2026-10-24): a picture signed
 * afresh on every response had a new URL each time, so the browser fetched
 * its bytes again. The same picture keeps its URL while it has at least
 * half its life left.
 */
function counting() {
  let signs = 0;
  const storage = {
    createDownloadAuthorization: ({ object }: { object: { key: string } }) => {
      signs += 1;
      return Promise.resolve({ url: `u/${object.key}/${String(signs)}` });
    },
    createDownloadAuthorizations: ({ keys }: { keys: readonly string[] }) => {
      signs += 1;
      return Promise.resolve(
        keys.map((key) =>
          key === "gone" ? null : `b/${key}/${String(signs)}`,
        ),
      );
    },
  } as unknown as ProfileImageStorage;
  return { storage, signs: () => signs };
}

describe("a picture keeps its signed URL while it lasts", () => {
  it("hands out the same URL again until half its life is gone", async () => {
    let clock = 0;
    const { storage, signs } = counting();
    const reused = reuseSignedPictureUrls(storage, () => clock);
    const ask = { object: { bucket: "p", key: "a" }, expiresInSeconds: 3600 };
    const first = await reused.createDownloadAuthorization(ask);
    clock = 1_799_000;
    expect(await reused.createDownloadAuthorization(ask)).toEqual(first);
    expect(signs()).toBe(1);
    clock = 1_801_000;
    expect(await reused.createDownloadAuthorization(ask)).not.toEqual(first);
    expect(signs()).toBe(2);
  });

  it("signs only the pictures it does not hold, in the order asked", async () => {
    const { storage, signs } = counting();
    const reused = reuseSignedPictureUrls(storage, () => 0);
    const batch = reused.createDownloadAuthorizations;
    if (batch === undefined) throw new Error("batch signing expected");
    const first = await batch({
      bucket: "p",
      keys: ["a", "b"],
      expiresInSeconds: 3600,
    });
    const second = await batch({
      bucket: "p",
      keys: ["b", "c", "a", "gone"],
      expiresInSeconds: 3600,
    });
    expect(second).toEqual([first[1], "b/c/2", first[0], null]);
    expect(signs()).toBe(2);
  });
});
