import { describe, expect, it, vi } from "vitest";
import { createSupabaseDocumentStorageProvider } from "../src/infrastructure/supabase-storage-provider.js";
import { DocumentStorageUnavailableError } from "../src/domain/errors.js";

const object = { bucket: "cq-documents-private", key: "uploads/test.pdf" };
const request = { object, contentType: "application/pdf", maxBytes: 1024 };
function token(payload: unknown): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
function provider(signedToken: string, urlToken = signedToken) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          token: signedToken,
          url: `/object/upload/sign/${object.bucket}/${object.key}?token=${encodeURIComponent(urlToken)}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  return createSupabaseDocumentStorageProvider({
    supabaseUrl: "https://storage.invalid",
    secretKey: "disabled-locally-000000000000",
    fetch: fetchMock,
  });
}
describe("provider upload lifetime proof", () => {
  it("uses the actual signed token expiry rather than a guessed fixed TTL", async () => {
    const exp = Math.floor(Date.now() / 1000) + 901;
    const result = await provider(token({ exp })).createUploadAuthorization(
      request,
    );
    expect(result.providerExpiresAt).toBe(new Date(exp * 1000).toISOString());
    expect(result.headers["x-upsert"]).toBe("false");
  });
  it.each([
    "opaque",
    token({}),
    token({ exp: "7200" }),
    token({ exp: Number.MAX_SAFE_INTEGER }),
    token({ exp: 1 }),
    token({ exp: -1 }),
  ])(
    "refuses missing, malformed or expired lifetime without disclosing provider tokens",
    async (value) => {
      await expect(
        provider(value).createUploadAuthorization(request),
      ).rejects.toBeInstanceOf(DocumentStorageUnavailableError);
    },
  );
  it("binds the expiry proof to the token actually present in the returned upload URL", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    await expect(
      provider(
        token({ exp }),
        token({ exp: exp + 7200 }),
      ).createUploadAuthorization(request),
    ).rejects.toBeInstanceOf(DocumentStorageUnavailableError);
  });
});
