import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";

import { ONBOARDING_CONTEXT_REQUIRED_CODE } from "../domain/errors.js";
import { canonicalise } from "../domain/idempotency.js";

/**
 * Held onboarding changes (lane ob1, `onboarding.pending_writes`).
 *
 * A change the person confirmed that could not be saved because a
 * dependency was temporarily down. It is held durably and replayed until it
 * lands. Nothing here is truth: a replay goes through the ordinary
 * validated submit, so the pinned definition and the owning canonical
 * service decide again. Duplicate-safe by construction: before replaying,
 * the drain compares the session's current answer with the held one (the
 * original attempt may have committed after its response was lost), and
 * every replay carries a key derived from the row and the session version
 * it targets, so a crashed drain that retries the same version replays,
 * not repeats.
 */

export type PendingWriteOrigin = "CONVERSATION" | "FORM" | "CONFIRMATION_GROUP";

export type PendingWrite = {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly stepKey: string;
  /** The validated response input: `{ value, note? }`. */
  readonly response: { readonly value: unknown; readonly note?: string };
  readonly origin: PendingWriteOrigin;
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly createdAt: Date;
};

export type PendingWriteRepository = {
  /** Holds a change; supersedes (DISCARDED) an earlier PENDING one for the same step. Idempotent by key. */
  readonly hold: (
    executor: DatabaseExecutor,
    input: Omit<PendingWrite, "id" | "attempts" | "createdAt">,
  ) => Promise<PendingWrite>;
  /** The caller's own PENDING changes for one session, oldest first. */
  readonly listPending: (
    executor: DatabaseExecutor,
    sessionId: string,
    userId: string,
  ) => Promise<readonly PendingWrite[]>;
  readonly settle: (
    executor: DatabaseExecutor,
    id: string,
    status: "APPLIED" | "REFUSED" | "DISCARDED",
    code: string | null,
  ) => Promise<void>;
  readonly recordAttempt: (
    executor: DatabaseExecutor,
    id: string,
    code: string,
  ) => Promise<void>;
};

/** Stable UUID-shaped key for replaying one held change at one session version. */
export function pendingReplayKey(id: string, sessionVersion: number): string {
  const hex = createHash("sha256")
    .update(`onboarding.pending_write:${id}:${sessionVersion}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Same answer, by canonical JSON (key order and undefined ignored). */
export function sameResponseValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b));
}

/** Failure classes a replay distinguishes. Transient keeps the row; refused settles it. */
export type ReplayFailure =
  | { readonly kind: "TRANSIENT"; readonly code: string }
  | { readonly kind: "REFUSED"; readonly code: string }
  /**
   * Kept, but not because anything is down: the answer waits for its firm
   * or company to be set up (QA F-52). The drain carries on past it.
   */
  | { readonly kind: "WAITING"; readonly code: string };

export type DrainPorts = {
  readonly pending: () => Promise<readonly PendingWrite[]>;
  /** The step's current answer value on the record, or null when none. */
  readonly currentValue: (stepKey: string) => Promise<unknown>;
  /**
   * When the step's current answer was given, or null when none. A held
   * change older than the answer on the record was overtaken by a newer
   * answer (said again once the firm existed) and is never written over it.
   */
  readonly answeredAt?: (stepKey: string) => Promise<Date | null>;
  /** Submit through the ordinary validated path; throws on failure. */
  readonly submit: (write: PendingWrite) => Promise<void>;
  readonly classify: (error: unknown) => ReplayFailure;
  readonly settle: (
    id: string,
    status: "APPLIED" | "REFUSED",
    code: string | null,
  ) => Promise<void>;
  readonly recordAttempt: (id: string, code: string) => Promise<void>;
};

export type DrainResult = {
  /** Steps whose held change is now on the record. */
  readonly applied: readonly string[];
  /** Steps the owning service refused on replay: the person must be told. */
  readonly refused: readonly { stepKey: string; code: string }[];
  /** Steps still held because the dependency is still down. */
  readonly stillPending: readonly string[];
  /** Steps still held until their firm or company is set up. */
  readonly waiting: readonly string[];
};

/**
 * Replays every held change, oldest first. Stops at the first transient
 * failure (the dependency is still down; hammering it helps nobody) and
 * leaves the rest held. A change waiting on its firm or company is kept
 * and the drain carries on, and it is tried again after a pass that saved
 * something, so the order they were held in does not matter. Never throws
 * for a replay failure.
 */
export async function drainPendingWrites(
  ports: DrainPorts,
): Promise<DrainResult> {
  const applied: string[] = [];
  const refused: { stepKey: string; code: string }[] = [];
  const stillPending: string[] = [];
  let waiting: PendingWrite[];
  let down = false;
  let open = await ports.pending();
  // Each pass after the first only follows progress: at most one pass a row.
  for (;;) {
    const appliedBefore = applied.length;
    waiting = [];
    for (const write of open) {
      if (down) {
        stillPending.push(write.stepKey);
        continue;
      }
      try {
        const current = await ports.currentValue(write.stepKey);
        if (
          current !== null &&
          sameResponseValue(current, write.response.value)
        ) {
          // The original attempt landed after all: settle, write nothing.
          await ports.settle(write.id, "APPLIED", null);
          applied.push(write.stepKey);
          continue;
        }
        if (current !== null && ports.answeredAt !== undefined) {
          const at = await ports.answeredAt(write.stepKey);
          if (at !== null && at.getTime() > write.createdAt.getTime()) {
            // Their newer answer stands: settled, never written over it.
            await ports.settle(write.id, "APPLIED", null);
            continue;
          }
        }
        await ports.submit(write);
        await ports.settle(write.id, "APPLIED", null);
        applied.push(write.stepKey);
      } catch (error: unknown) {
        const failure = ports.classify(error);
        if (failure.kind === "REFUSED") {
          await ports
            .settle(write.id, "REFUSED", failure.code)
            .catch(() => undefined);
          refused.push({ stepKey: write.stepKey, code: failure.code });
        } else {
          await ports
            .recordAttempt(write.id, failure.code)
            .catch(() => undefined);
          if (failure.kind === "WAITING") {
            waiting.push(write);
          } else {
            stillPending.push(write.stepKey);
            down = true;
          }
        }
      }
    }
    if (down || waiting.length === 0 || applied.length === appliedBefore) {
      break;
    }
    open = waiting;
  }
  const kept = waiting.map((w) => w.stepKey);
  return {
    applied,
    refused,
    stillPending: down ? [...stillPending, ...kept] : stillPending,
    waiting: down ? [] : kept,
  };
}

/**
 * Whether an error from the onboarding API is a temporary dependency
 * failure (network, timeout, 5xx, 429), as opposed to a refusal by the
 * definition or the canonical service (4xx), which a retry cannot fix.
 */
export function isTransientOnboardingFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return true;
  // QA F-52: an answer that waits for its firm or company to be set up is
  // held and saved once it is, never refused for good.
  if (waitsForContext(error)) return true;
  const status = (error as { readonly status?: unknown }).status;
  if (typeof status === "number") {
    // 409 VERSION_CONFLICT: the session moved under us; retry later. Any
    // other 409 is the journey refusing this answer as it stands (a step
    // not on their path), which no retry changes (live 2026-10-16: "raise
    // USD 1.5m" held as a "temporary fault" for a step not yet on the path).
    if (status === 409) {
      const code = (error as { readonly code?: unknown }).code;
      return code === undefined || code === "VERSION_CONFLICT";
    }
    return status >= 500 || status === 429 || status === 408;
  }
  // No HTTP status: the request never got an answer (network, abort).
  return true;
}

/** A stable reason code for an error, never its message. */
export function failureCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const status = (error as { readonly status?: unknown }).status;
    if (typeof status === "number") return `HTTP_${status}`;
    const name = (error as { readonly name?: unknown }).name;
    if (name === "AbortError" || name === "TimeoutError") return "TIMEOUT";
  }
  return "UPSTREAM_UNAVAILABLE";
}

/**
 * QA F-52: the refusal says the firm or company this answer belongs to is
 * not set up yet (an error, or a batch refusal's problem shape).
 */
export function waitsForContext(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (Reflect.get(error, "code") === ONBOARDING_CONTEXT_REQUIRED_CODE) {
    return true;
  }
  const problem: unknown = Reflect.get(error, "problem") ?? error;
  if (typeof problem !== "object" || problem === null) return false;
  const errors: unknown = Reflect.get(problem, "errors");
  return (
    Array.isArray(errors) &&
    errors.some(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        Reflect.get(item, "code") === ONBOARDING_CONTEXT_REQUIRED_CODE,
    )
  );
}
