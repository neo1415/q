import { describe, expect, it } from "vitest";

import { createSupabaseDocumentStorageProvider } from "../src/index.js";

/**
 * The signed read behind a file shared in a relationship chat (R34): one
 * object, a short expiry, the storage credential only on the server's own
 * request, and a download name only when asked for.
 */

describe("Supabase signed download", () => {
  it("signs exactly one object for the requested seconds", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = createSupabaseDocumentStorageProvider({
      supabaseUrl: "https://project.example.invalid",
      secretKey: "disabled-locally-000000000000",
      fetch: (url, init) => {
        calls.push({
          url:
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.href
                : url.url,
          init: init ?? {},
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              signedURL:
                "/object/sign/cq-documents-private/raw/t/abc?token=signed",
            }),
            { status: 200 },
          ),
        );
      },
    });
    const file = await provider.createDownloadAuthorization({
      object: { bucket: "cq-documents-private", key: "raw/t/abc" },
      expiresInSeconds: 60,
      downloadFilename: "Seed deck.pdf",
    });
    expect(calls[0]?.url).toBe(
      "https://project.example.invalid/storage/v1/object/sign/cq-documents-private/raw/t/abc",
    );
    const body = calls[0]?.init.body;
    expect(typeof body === "string" ? JSON.parse(body) : null).toEqual({
      expiresIn: 60,
    });
    expect(file.url).toBe(
      "https://project.example.invalid/storage/v1/object/sign/cq-documents-private/raw/t/abc?token=signed&download=Seed%20deck.pdf",
    );
    expect(file.url).not.toContain("disabled-locally");

    const inline = await provider.createDownloadAuthorization({
      object: { bucket: "cq-documents-private", key: "raw/t/abc" },
      expiresInSeconds: 60,
    });
    expect(inline.url).not.toContain("download=");
  });

  it("refuses a response that is not a signed object path", async () => {
    const provider = createSupabaseDocumentStorageProvider({
      supabaseUrl: "https://project.example.invalid",
      secretKey: "disabled-locally-000000000000",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ signedURL: "https://evil.example/x" }),
            {
              status: 200,
            },
          ),
        ),
    });
    await expect(
      provider.createDownloadAuthorization({
        object: { bucket: "b", key: "k" },
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow();
  });
});
