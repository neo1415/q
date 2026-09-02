import { z } from "zod";

import {
  toValidationIssues,
  type ValidationIssue,
} from "../common/validation.js";

/**
 * Why a registered message could not be accepted.
 *
 * These are kept distinct because the runtime must react differently to each,
 * and collapsing them into "invalid" destroys that. In particular an unknown
 * type and an unsupported version are not the same problem: the first may mean
 * a consumer is out of date, the second means a producer has made a breaking
 * change this consumer must not guess its way through.
 */
export const MESSAGE_REJECTIONS = [
  /** The envelope itself is malformed -- not a Capital Q message at all. */
  "INVALID_ENVELOPE",
  /** Structurally valid, but no definition is registered for this type. */
  "UNKNOWN_TYPE",
  /** The type is known, but not at this version. Never guessed at. */
  "UNSUPPORTED_VERSION",
  /** Envelope and version are known; the payload failed its schema. */
  "INVALID_PAYLOAD",
] as const;

export type MessageRejection = (typeof MESSAGE_REJECTIONS)[number];

export const MessageRejectionSchema = z.enum(MESSAGE_REJECTIONS);

/**
 * The outcome of parsing a message against a registry.
 *
 * A rejection reports the type and version it could identify plus safe
 * validation issues. It never carries the payload: a rejected message is
 * exactly the thing most likely to be logged, and payloads may hold
 * confidential material.
 */
export type MessageParseResult<TMessage> =
  | { readonly ok: true; readonly message: TMessage }
  | {
      readonly ok: false;
      readonly rejection: MessageRejection;
      readonly type: string | undefined;
      readonly version: number | undefined;
      readonly issues: readonly ValidationIssue[];
    };

export function messageAccepted<TMessage>(
  message: TMessage,
): MessageParseResult<TMessage> {
  return { ok: true, message };
}

export function messageRejected<TMessage>(
  rejection: MessageRejection,
  options: {
    readonly type?: string | undefined;
    readonly version?: number | undefined;
    readonly error?: z.ZodError | undefined;
    readonly issues?: readonly ValidationIssue[] | undefined;
  } = {},
): MessageParseResult<TMessage> {
  const issues =
    options.issues ??
    (options.error === undefined ? [] : toValidationIssues(options.error));

  return {
    ok: false,
    rejection,
    type: options.type,
    version: options.version,
    issues,
  };
}
