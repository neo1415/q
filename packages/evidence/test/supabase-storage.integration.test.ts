import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createSupabaseDocumentStorageProvider,
  DOCUMENT_STORAGE_BUCKET,
} from "../src/index.js";
import { FIXTURES } from "./upload-fixtures.js";

/**
 * The Supabase Storage adapter against the local stack (`pnpm db:start`),
 * run with `pnpm test:integration`.
 *
 * This is the half of the upload boundary that cannot be proved with a
 * double: that the signed target really is scoped to one object, really
 * refuses to overwrite, and that the bucket really is closed to anonymous
 * and browser credentials.
 *
 * The privileged key is supplied by the environment and never committed.
 * Without it the suite reports itself skipped rather than passing silently:
 *
 *   CQ_TEST_SUPABASE_SECRET_KEY=$(supabase status -o env | ...) pnpm test:integration
 */

const SUPABASE_URL =
  process.env["CQ_TEST_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SECRET_KEY =
  process.env["CQ_TEST_SUPABASE_SECRET_KEY"] ??
  process.env["SUPABASE_SECRET_KEY"];
/** The local stack's fixed, public publishable key; overridable. */
const PUBLISHABLE_KEY =
  process.env["CQ_TEST_SUPABASE_PUBLISHABLE_KEY"] ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const configured = typeof SECRET_KEY === "string" && SECRET_KEY.length > 0;

describe.skipIf(!configured)(
  "Supabase private document storage (needs CQ_TEST_SUPABASE_SECRET_KEY)",
  () => {
    const provider = createSupabaseDocumentStorageProvider({
      supabaseUrl: SUPABASE_URL,
      secretKey: SECRET_KEY ?? "",
    });
    const object = {
      bucket: DOCUMENT_STORAGE_BUCKET,
      key: `raw/00000000-0000-4000-8000-0000000000aa/${randomBytes(16).toString("hex")}`,
    };

    async function readBody(stream: AsyncIterable<Uint8Array>) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    }

    it("mints a scoped target, accepts the bytes once, and refuses to overwrite", async () => {
      const authorization = await provider.createUploadAuthorization({
        object,
        contentType: "application/pdf",
        maxBytes: 25 * 1024 * 1024,
      });

      expect(authorization.method).toBe("PUT");
      // Scoped to exactly this object: the path is in the URL the server minted.
      expect(authorization.url).toContain(object.key);
      expect(authorization.headers["x-upsert"]).toBe("false");
      // The provider's own token lifetime is fixed at two hours; the
      // application session closes long before that.
      const ttlSeconds =
        (Date.parse(authorization.providerExpiresAt) - Date.now()) / 1000;
      expect(ttlSeconds).toBeGreaterThan(3600);
      expect(ttlSeconds).toBeLessThanOrEqual(7300);

      const upload = await fetch(authorization.url, {
        method: authorization.method,
        headers: authorization.headers,
        body: Buffer.from(FIXTURES.pdf),
      });
      expect(upload.ok).toBe(true);

      // The same target cannot replace what is already there.
      const replay = await fetch(authorization.url, {
        method: authorization.method,
        headers: authorization.headers,
        body: Buffer.from(FIXTURES.docx),
      });
      expect(replay.ok).toBe(false);
    });

    it("stats and streams the stored bytes for the server only", async () => {
      const stat = await provider.statObject(object);
      expect(stat?.sizeBytes).toBe(FIXTURES.pdf.byteLength);

      const stream = await provider.openObjectStream(object);
      const body = await readBody(stream.body);
      expect(body.byteLength).toBe(FIXTURES.pdf.byteLength);
      expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    });

    it("is closed to anonymous and browser credentials", async () => {
      const path = `${SUPABASE_URL}/storage/v1/object`;
      const publicRead = await fetch(
        `${path}/public/${object.bucket}/${object.key}`,
      );
      expect(publicRead.ok).toBe(false);

      const anonymousRead = await fetch(
        `${path}/authenticated/${object.bucket}/${object.key}`,
      );
      expect(anonymousRead.ok).toBe(false);

      // A browser holding the publishable key gets no further: reading,
      // listing and writing this bucket all require a policy that does not
      // exist. Knowing the path grants nothing.
      const withPublishableKey = await fetch(
        `${path}/authenticated/${object.bucket}/${object.key}`,
        {
          headers: {
            apikey: PUBLISHABLE_KEY,
            authorization: `Bearer ${PUBLISHABLE_KEY}`,
          },
        },
      );
      expect(withPublishableKey.ok).toBe(false);

      const list = await fetch(
        `${SUPABASE_URL}/storage/v1/object/list/${object.bucket}`,
        {
          method: "POST",
          headers: {
            apikey: PUBLISHABLE_KEY,
            authorization: `Bearer ${PUBLISHABLE_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ prefix: "raw", limit: 10 }),
        },
      );
      const listed: unknown = list.ok ? await list.json() : [];
      expect(Array.isArray(listed) ? listed : []).toHaveLength(0);

      const write = await fetch(`${path}/${object.bucket}/raw/intruder`, {
        method: "POST",
        headers: {
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${PUBLISHABLE_KEY}`,
          "content-type": "text/plain",
        },
        body: "intruder",
      });
      expect(write.ok).toBe(false);
    });

    it("deletes an object, and deleting one that is already gone is success", async () => {
      await provider.deleteObject(object);
      expect(await provider.statObject(object)).toBeNull();
      await expect(provider.deleteObject(object)).resolves.toBeUndefined();
    });
  },
);
