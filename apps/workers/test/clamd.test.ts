import { afterEach, describe, expect, it } from "vitest";

import { createClamdScanner, parseClamdReply } from "../src/documents/clamd.js";
import { decideOnVerdict } from "../src/documents/malware.js";
import {
  closeFakeClamds,
  EICAR,
  fakeClamd,
  stopFakeClamd,
} from "./support/fake-clamd.js";

afterEach(closeFakeClamds);

/**
 * The ClamAV adapter (decision 104) against a fake clamd on loopback: the
 * INSTREAM framing, each reply mapped to the scanner port's verdict, and
 * every failure (timeout, oversize, refused, unknown reply) an ERROR the
 * pipeline retries, never CLEAN. No real clamd and no network.
 */

function scannerFor(
  port: number,
  content: Buffer,
  overrides: { timeoutMs?: number; maxBytes?: number } = {},
) {
  const opened: string[] = [];
  const scanner = createClamdScanner({
    host: "127.0.0.1",
    port,
    timeoutMs: overrides.timeoutMs ?? 5_000,
    maxBytes: overrides.maxBytes ?? 52_428_800,
    openObject: (target) => {
      opened.push(target.key);
      return Promise.resolve(
        (async function* () {
          // Storage hands bytes over a chunk at a time.
          const half = Math.ceil(content.byteLength / 2);
          await Promise.resolve();
          yield content.subarray(0, half);
          yield content.subarray(half);
        })(),
      );
    },
  });
  return { scanner, opened };
}

const target = (sizeBytes: number) => ({
  bucket: "cq-documents-private",
  key: "uploads/deck.pdf",
  sizeBytes,
  mimeType: "application/pdf",
});

describe("the clamd scanner", () => {
  it("streams the file in INSTREAM frames and maps OK to CLEAN, with the engine version", async () => {
    const clamd = await fakeClamd("answer");
    const content = Buffer.from("%PDF-1.7 an ordinary deck\n".repeat(5_000));
    const { scanner, opened } = scannerFor(clamd.port, content);

    const verdict = await scanner.scan(target(content.byteLength));

    expect(verdict).toEqual({
      status: "CLEAN",
      scannerId: "clamav",
      scannerVersion: "1.4.1/27460",
    });
    expect(opened).toEqual(["uploads/deck.pdf"]);
    // Every byte reached clamd, in order, across more than one frame.
    expect(clamd.streamed[0]?.equals(content)).toBe(true);
    expect(decideOnVerdict(verdict, "REQUIRE_CLEAN")).toEqual({
      kind: "PROCEED",
      scanned: true,
    });
  });

  it("maps FOUND to INFECTED with the signature name, and the pipeline blocks it", async () => {
    const clamd = await fakeClamd("answer");
    const content = Buffer.from(EICAR);
    const { scanner } = scannerFor(clamd.port, content);

    const verdict = await scanner.scan(target(content.byteLength));

    expect(verdict.status).toBe("INFECTED");
    expect(verdict.signature).toBe("Win.Test.EICAR_HDB-1");
    expect(verdict.scannerId).toBe("clamav");
    for (const policy of [
      "REQUIRE_CLEAN",
      "ALLOW_UNSCANNED_WITH_WARNING",
    ] as const) {
      expect(decideOnVerdict(verdict, policy)).toEqual({
        kind: "BLOCK",
        errorCode: "MALWARE_DETECTED",
      });
    }
  });

  it("a clamd that never answers is an ERROR within the timeout, retried, never clean", async () => {
    const clamd = await fakeClamd("silent");
    const content = Buffer.from("slow");
    const { scanner } = scannerFor(clamd.port, content, { timeoutMs: 1_000 });

    const startedAt = Date.now();
    const verdict = await scanner.scan(target(content.byteLength));

    expect(verdict.status).toBe("ERROR");
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(decideOnVerdict(verdict, "ALLOW_UNSCANNED_WITH_WARNING")).toEqual({
      kind: "RETRY",
      errorCode: "SCANNER_UNAVAILABLE",
    });
  });

  it("refuses a file past the upload ceiling without opening or sending it", async () => {
    const clamd = await fakeClamd("answer");
    const content = Buffer.alloc(2_048, 1);
    const { scanner, opened } = scannerFor(clamd.port, content, {
      maxBytes: 1_024,
    });

    const verdict = await scanner.scan(target(content.byteLength));

    expect(verdict.status).toBe("ERROR");
    expect(opened).toEqual([]);
    expect(clamd.streamed).toEqual([]);
  });

  it("stops mid-stream when the stored bytes outgrow the recorded size", async () => {
    const clamd = await fakeClamd("answer");
    const content = Buffer.alloc(2_048, 1);
    const { scanner } = scannerFor(clamd.port, content, { maxBytes: 1_024 });

    // The row claims a small file; storage hands over more than the ceiling.
    const verdict = await scanner.scan(target(512));

    expect(verdict.status).toBe("ERROR");
    expect(clamd.streamed).toEqual([]);
  });

  it("a refused connection or a dropped one is an ERROR", async () => {
    const dropped = await fakeClamd("close");
    const content = Buffer.from("x");
    await expect(
      scannerFor(dropped.port, content).scanner.scan(target(1)),
    ).resolves.toMatchObject({ status: "ERROR" });

    // Nothing listens on a port that was just closed.
    const gone = await fakeClamd("answer");
    await stopFakeClamd(gone);
    await expect(
      scannerFor(gone.port, content).scanner.scan(target(1)),
    ).resolves.toMatchObject({ status: "ERROR" });
  });

  it("a size-limit or unknown reply is an ERROR, never CLEAN", async () => {
    const clamd = await fakeClamd(
      "answer",
      () => "INSTREAM size limit exceeded. ERROR",
    );
    const content = Buffer.from("x");
    await expect(
      scannerFor(clamd.port, content).scanner.scan(target(1)),
    ).resolves.toMatchObject({ status: "ERROR" });
  });
});

describe("reading a clamd reply", () => {
  it.each([
    ["stream: OK\0", { kind: "CLEAN" }],
    ["stream: OK", { kind: "CLEAN" }],
    [
      "stream: Eicar-Test-Signature FOUND\0",
      { kind: "INFECTED", signature: "Eicar-Test-Signature" },
    ],
    ["INSTREAM size limit exceeded. ERROR\0", { kind: "ERROR" }],
    ["stream: OK and more", { kind: "ERROR" }],
    ["", { kind: "ERROR" }],
    ["stream: FOUND", { kind: "ERROR" }],
  ])("%j", (reply, expected) => {
    expect(parseClamdReply(reply)).toEqual(expected);
  });

  it("bounds a signature name to printable characters", () => {
    const parsed = parseClamdReply(`stream: ${"A".repeat(300)}\u0007 FOUND`);
    expect(parsed).toEqual({ kind: "INFECTED", signature: "A".repeat(128) });
  });
});
