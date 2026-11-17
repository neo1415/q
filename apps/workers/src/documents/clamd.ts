import { connect, type Socket } from "node:net";

import type {
  MalwareScanner,
  MalwareScanTarget,
  MalwareVerdict,
} from "./malware.js";

/**
 * A ClamAV scanner (decision 104, ADR 0042 reversal): clamd's INSTREAM
 * command over TCP, on the private network only.
 *
 * The protocol is small enough that a client library would add more risk
 * than it removes: `zINSTREAM\0`, then frames of a 4-byte big-endian length
 * and that many bytes, then a zero-length frame; clamd answers one
 * NUL-terminated line, `stream: OK`, `stream: <signature> FOUND` or
 * `... ERROR`.
 *
 * Only `stream: OK` is CLEAN and only `FOUND` is INFECTED. Everything else
 * (a refused connection, a timeout, a size limit, a reply this client does
 * not recognise) is ERROR, which the pipeline retries: a scanner that is
 * down never turns into "clean". The file's bytes go to clamd and nowhere
 * else; nothing about them is logged.
 */

export type ClamdScannerOptions = {
  readonly host: string;
  readonly port: number;
  /** The whole scan, connection to verdict. */
  readonly timeoutMs: number;
  /** The upload ceiling; a larger object is never streamed. */
  readonly maxBytes: number;
  /** The stored object's bytes (the private document storage). */
  readonly openObject: (
    target: MalwareScanTarget,
  ) => Promise<AsyncIterable<Uint8Array>>;
};

/** clamd reads frames of any size; this keeps each write small. */
const FRAME_BYTES = 64 * 1024;
/** A verdict line is short; anything longer is not one. */
const MAX_REPLY_BYTES = 1_024;
/** How long a scanner version is reused before it is asked again. */
const VERSION_TTL_MS = 60 * 60 * 1_000;

export const CLAMD_SCANNER_ID = "clamav";

/** A signature name, bounded and printable. Never document content. */
function boundedSignature(raw: string): string {
  return raw.replace(/[^\x20-\x7e]/gu, "").slice(0, 128);
}

export function parseClamdReply(
  reply: string,
):
  | { readonly kind: "CLEAN" }
  | { readonly kind: "INFECTED"; readonly signature: string }
  | { readonly kind: "ERROR" } {
  const line = reply.replace(/\0+$/u, "").trim();
  if (line === "stream: OK") return { kind: "CLEAN" };
  const found = /^stream: (.+) FOUND$/u.exec(line);
  if (found?.[1] !== undefined) {
    return { kind: "INFECTED", signature: boundedSignature(found[1]) };
  }
  return { kind: "ERROR" };
}

function frame(bytes: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.byteLength, 0);
  return Buffer.concat([header, bytes]);
}

class ScanAbort extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "ScanAbort";
  }
}

/**
 * One request to clamd: connect, let `send` write the request, read the
 * NUL-terminated reply. Bounded by `timeoutMs`; the socket is always
 * destroyed.
 */
async function exchange(
  options: Pick<ClamdScannerOptions, "host" | "port" | "timeoutMs">,
  send: (socket: Socket) => Promise<void>,
): Promise<string> {
  const socket = connect({ host: options.host, port: options.port });
  const chunks: Buffer[] = [];
  let length = 0;
  let timer: NodeJS.Timeout | undefined;
  const reply = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ScanAbort("TIMEOUT"));
    }, options.timeoutMs);
    socket.on("data", (data: Buffer) => {
      chunks.push(data);
      length += data.byteLength;
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes("\0")) resolve(text.slice(0, text.indexOf("\0")));
      else if (length > MAX_REPLY_BYTES)
        reject(new ScanAbort("REPLY_TOO_LONG"));
    });
    socket.on("end", () => {
      // clamd may close right after an unterminated reply.
      if (length > 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new ScanAbort("CLOSED"));
    });
    socket.on("error", (error) => {
      // A reply that already arrived (clamd closing mid-stream after a
      // size-limit error) wins over the write error it causes.
      if (length > 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(error);
    });
  });
  try {
    const connected = new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        resolve();
      });
      socket.once("error", reject);
    });
    await Promise.race([connected, reply]);
    await Promise.race([send(socket), reply]);
    return await reply;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    socket.destroy();
    // A rejection after the race was decided must not surface as unhandled.
    reply.catch(() => undefined);
  }
}

function write(socket: Socket, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new ScanAbort("CLOSED"));
      return;
    }
    socket.write(bytes, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createClamdScanner(
  options: ClamdScannerOptions,
): MalwareScanner {
  let version: { readonly value: string | null; readonly at: number } | null =
    null;

  const scannerVersion = async (): Promise<string | null> => {
    if (version !== null && Date.now() - version.at < VERSION_TTL_MS) {
      return version.value;
    }
    let value: string | null;
    try {
      const reply = await exchange(
        { ...options, timeoutMs: Math.min(options.timeoutMs, 5_000) },
        (socket) => write(socket, Buffer.from("zVERSION\0")),
      );
      // "ClamAV 1.4.1/27460/Mon Nov 16 ..." -> engine and database release.
      const match = /^ClamAV ([0-9.]+)\/([0-9]+)/u.exec(reply.trim());
      value =
        match?.[1] !== undefined && match[2] !== undefined
          ? `${match[1]}/${match[2]}`
          : null;
    } catch {
      value = null;
    }
    version = { value, at: Date.now() };
    return value;
  };

  const verdict = (
    status: MalwareVerdict["status"],
    scanned: string | null,
    signature?: string,
  ): MalwareVerdict => ({
    status,
    scannerId: CLAMD_SCANNER_ID,
    scannerVersion: scanned,
    ...(signature === undefined ? {} : { signature }),
  });

  return {
    id: CLAMD_SCANNER_ID,
    scan: async (target) => {
      // A file past the upload ceiling never reached storage legitimately;
      // it is not streamed, and not called clean.
      if (target.sizeBytes > options.maxBytes) {
        return verdict("ERROR", null);
      }
      let reply: string;
      try {
        const body = await options.openObject(target);
        reply = await exchange(options, async (socket) => {
          await write(socket, Buffer.from("zINSTREAM\0"));
          let sent = 0;
          for await (const chunk of body) {
            sent += chunk.byteLength;
            if (sent > options.maxBytes) throw new ScanAbort("TOO_LARGE");
            for (let at = 0; at < chunk.byteLength; at += FRAME_BYTES) {
              await write(socket, frame(chunk.subarray(at, at + FRAME_BYTES)));
            }
          }
          await write(socket, Buffer.alloc(4));
        });
      } catch {
        return verdict("ERROR", null);
      }
      const parsed = parseClamdReply(reply);
      const scanned = await scannerVersion();
      switch (parsed.kind) {
        case "CLEAN":
          return verdict("CLEAN", scanned);
        case "INFECTED":
          return verdict("INFECTED", scanned, parsed.signature);
        case "ERROR":
          return verdict("ERROR", scanned);
      }
    },
  };
}
