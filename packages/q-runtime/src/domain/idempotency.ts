import { createHash } from "node:crypto";

import {
  canonicalJsonStringify,
  type AppendQRunMessageRequest,
  type CreateQRunRequest,
} from "@capital-q/contracts";

/**
 * Q runtime idempotency stores hashes only, in the same design every other
 * creating endpoint uses: the raw Idempotency-Key never reaches a table, and
 * each operation hashes under its own namespace so a key reused across
 * operations can never collide.
 *
 * The request hash is over the shared canonical JSON form (sorted keys,
 * undefined dropped, arrays in order) so two JSON encodings of the same
 * request agree, and two requests that differ in any field — including the
 * message text — do not.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashRunIdempotencyKey(key: string): string {
  return sha256Hex(`q.run.create:${key}`);
}

export function hashCreateQRunRequest(input: CreateQRunRequest): string {
  // Where the question was asked from (the screen, the pitch moment, the
  // surface's opening words) is context, not the request: a question asked
  // again under the same key after a reload carries none of it, and it is
  // still the same question (CQ-QX-007 H1).
  const {
    screen: _screen,
    viewing: _viewing,
    opening: _opening,
    ...asked
  } = input;
  return sha256Hex(canonicalJsonStringify(asked));
}

export function hashMessageIdempotencyKey(key: string): string {
  return sha256Hex(`q.run.message.append:${key}`);
}

export function hashAppendQRunMessageRequest(
  input: AppendQRunMessageRequest,
): string {
  return sha256Hex(canonicalJsonStringify(input));
}
