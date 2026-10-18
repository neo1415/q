import { describe, expect, it } from "vitest";

import { createSupabaseDocumentStorageProvider } from "../src/index.js";

/**
 * Many reads of one bucket in one provider call (a list's pictures): one
 * request, URLs back in the order asked, and a path the provider could
 * not sign reads as null rather than failing the rest.
 */
describe("createDownloadAuthorizations", () => {
  it("signs a list in one call, in order, with nulls for what failed", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const provider = createSupabaseDocumentStorageProvider({
      supabaseUrl: "https://project.storage.test/",
      secretKey: "disabled-locally-000000000000",
      fetch: (input, init) => {
        requests.push({
          url: input instanceof Request ? input.url : input.toString(),
          body: JSON.parse(
            typeof init?.body === "string" ? init.body : "null",
          ) as unknown,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                path: "b/2",
                signedURL: "/object/sign/img/b/2?token=2",
                error: null,
              },
              {
                path: "a/1",
                signedURL: "/object/sign/img/a/1?token=1",
                error: null,
              },
              {
                path: "c/3",
                signedURL: null,
                error: "Either the object does not exist",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    });
    await expect(
      provider.createDownloadAuthorizations({
        bucket: "img",
        keys: ["a/1", "b/2", "c/3"],
        expiresInSeconds: 3600,
      }),
    ).resolves.toEqual([
      "https://project.storage.test/storage/v1/object/sign/img/a/1?token=1",
      "https://project.storage.test/storage/v1/object/sign/img/b/2?token=2",
      null,
    ]);
    expect(requests).toEqual([
      {
        url: "https://project.storage.test/storage/v1/object/sign/img",
        body: { expiresIn: 3600, paths: ["a/1", "b/2", "c/3"] },
      },
    ]);
  });

  it("asks nothing for an empty list", async () => {
    const provider = createSupabaseDocumentStorageProvider({
      supabaseUrl: "https://project.storage.test",
      secretKey: "disabled-locally-000000000000",
      fetch: () => Promise.reject(new Error("must not call")),
    });
    await expect(
      provider.createDownloadAuthorizations({
        bucket: "img",
        keys: [],
        expiresInSeconds: 60,
      }),
    ).resolves.toEqual([]);
  });
});
