import { describe, expect, it } from "vitest";

import {
  backfillPictureCache,
  pictureCacheModeOf,
} from "../src/storage/picture-cache-backfill.js";

/**
 * Egress (2026-10-24): processed pictures stored no-store are rewritten
 * cacheable, with the workers' own storage credentials, only when asked.
 */
const TENANT = "0a000000-0000-4000-8000-000000000001";
const ROW = "1a000000-0000-4000-8000-000000000001";
const rows = [
  {
    name: `img/${TENANT}/${ROW}.webp`,
    size: "3",
    mimetype: "image/webp",
    cache_control: "no-store",
  },
  // Not a processed picture's key: never touched.
  {
    name: `img/${TENANT}/notes.txt`,
    size: "9",
    mimetype: null,
    cache_control: null,
  },
];

function world() {
  const puts: {
    key: string;
    cacheControl?: string | undefined;
    bytes: number;
  }[] = [];
  const sql = (() => Promise.resolve(rows)) as never;
  const storage = {
    openObjectStream: () =>
      Promise.resolve({
        body: (async function* () {
          yield new Uint8Array([1, 2]);
          yield new Uint8Array([3]);
        })(),
      }),
    putObject: (input: {
      object: { key: string };
      body: Uint8Array;
      cacheControl?: string | undefined;
    }) => {
      puts.push({
        key: input.object.key,
        cacheControl: input.cacheControl,
        bytes: input.body.byteLength,
      });
      return Promise.resolve();
    },
  };
  return { sql, storage, puts };
}

describe("the picture cache backfill", () => {
  it("is off unless asked, and only for dry-run or apply", () => {
    expect(pictureCacheModeOf(undefined)).toBeNull();
    expect(pictureCacheModeOf("yes")).toBeNull();
    expect(pictureCacheModeOf("dry-run")).toBe("dry-run");
    expect(pictureCacheModeOf("apply")).toBe("apply");
  });

  it("reports and writes nothing on a dry run", async () => {
    const { sql, storage, puts } = world();
    const report = await backfillPictureCache({
      sql,
      storage,
      mode: "dry-run",
    });
    expect(report).toMatchObject({
      toRewrite: 1,
      downloadBytes: 3,
      currentCacheControl: { "no-store": 1 },
      rewritten: 0,
    });
    expect(puts).toEqual([]);
  });

  it("puts each processed picture back with its own bytes, cacheable", async () => {
    const { sql, storage, puts } = world();
    const report = await backfillPictureCache({ sql, storage, mode: "apply" });
    expect(report).toMatchObject({ rewritten: 1, failed: 0 });
    expect(puts).toEqual([
      {
        key: `img/${TENANT}/${ROW}.webp`,
        cacheControl: "private, max-age=31536000, immutable",
        bytes: 3,
      },
    ]);
  });
});
