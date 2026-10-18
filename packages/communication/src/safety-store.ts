import type { TransactionContext } from "@capital-q/database";

import type { ChatSide } from "./store.js";

/**
 * The chat safety store port (R34 safety; doc 10). Blocks and reports are
 * written over the privileged server connection after the service has
 * authorised the caller as a party. The party organisations are resolved
 * from the canonical relationship rows by `side`, never from input.
 *
 * Each write runs in one transaction with its audit record: `audit` is
 * called inside that transaction with the new row's id, and only when a row
 * was actually written (a repeat writes nothing and audits nothing).
 */

export type ChatSafetyAuditHook = (
  tx: TransactionContext,
  resourceId: string,
) => Promise<void>;

export type ChatSafetyStore = {
  readonly block: (input: {
    readonly relationshipId: string;
    readonly side: ChatSide;
    readonly userId: string;
    readonly idempotencyKey: string;
    readonly audit: ChatSafetyAuditHook;
  }) => Promise<
    | {
        readonly outcome: "BLOCKED";
        readonly blockId: string;
        readonly deduplicated: boolean;
      }
    /** The key was used by this person for another relationship. */
    | { readonly outcome: "KEY_CONFLICT" }
  >;
  /** Lifts this side's active block, if there is one. */
  readonly unblock: (input: {
    readonly relationshipId: string;
    readonly side: ChatSide;
    readonly userId: string;
    readonly audit: ChatSafetyAuditHook;
  }) => Promise<{ readonly lifted: boolean }>;
  readonly report: (input: {
    readonly relationshipId: string;
    readonly side: ChatSide;
    readonly userId: string;
    /** Must be an original sent by the other side on this relationship's thread. */
    readonly messageId: string | null;
    readonly reasonCode: string;
    readonly note: string | null;
    readonly idempotencyKey: string;
    readonly audit: ChatSafetyAuditHook;
  }) => Promise<
    | {
        readonly outcome: "REPORTED";
        readonly reportId: string;
        readonly deduplicated: boolean;
      }
    | { readonly outcome: "KEY_CONFLICT" }
    | { readonly outcome: "UNKNOWN_REASON" }
    | { readonly outcome: "MESSAGE_NOT_FOUND" }
  >;
};
