import { createHash } from "node:crypto";
import { open, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ByteRangeReader } from "../domain/content-validation.js";

/**
 * Staging for validation (doc 15 §25, §28).
 *
 * Uploaded bytes are hostile until proven otherwise, so they are never held
 * whole in the request's memory and never handed to a parser here. They are
 * streamed once into a private temporary file under a hard byte cap — the
 * hash is computed during that single pass — and the file is then read only
 * in bounded ranges to identify the container. It is removed in every exit
 * path, including failure.
 *
 * Nothing executes the file, opens it with a document library, or reads its
 * words.
 */

export type StagedObject = {
  readonly sizeBytes: number;
  readonly sha256: string;
  /** Bounded random access for signature and container checks. */
  readonly read: ByteRangeReader;
  readonly dispose: () => Promise<void>;
};

export class StagedObjectTooLargeError extends Error {
  constructor() {
    super("the stored object exceeds the upload size limit");
    this.name = "StagedObjectTooLargeError";
  }
}

/**
 * Streams `body` to a temporary file, refusing at the first byte past
 * `maxBytes` so an oversized or lying object never fully lands on disk.
 */
export async function stageObjectForValidation(input: {
  readonly body: AsyncIterable<Uint8Array>;
  readonly maxBytes: number;
}): Promise<StagedObject> {
  const directory = await mkdtemp(join(tmpdir(), "cq-upload-"));
  const path = join(directory, "object.bin");
  const dispose = async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  };

  const hash = createHash("sha256");
  let sizeBytes = 0;
  // `wx` refuses to open an existing file: the staged path is ours alone.
  const handle = await open(path, "wx", 0o600);
  try {
    for await (const chunk of input.body) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > input.maxBytes) {
        throw new StagedObjectTooLargeError();
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error: unknown) {
    await handle.close();
    await dispose();
    throw error;
  }
  await handle.close();

  const reader = await open(path, "r");
  return {
    sizeBytes,
    sha256: hash.digest("hex"),
    read: async (offset, length) => {
      const buffer = new Uint8Array(Math.max(0, length));
      if (buffer.byteLength === 0) return buffer;
      const { bytesRead } = await reader.read(
        buffer,
        0,
        buffer.byteLength,
        offset,
      );
      return buffer.subarray(0, bytesRead);
    },
    dispose: async () => {
      await reader.close();
      await dispose();
    },
  };
}
