import { z } from "zod";

import type { Logger } from "@capital-q/observability";
import { NOT_AVAILABLE_MESSAGE } from "@capital-q/q-tools";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * A declared app action, done by code from the turn's reading (ADR 0040).
 *
 * The parity eval (2026-10-02) found the answer's model, offered 78 tools,
 * describing a Save or a Pass and not calling it (its words removed, the
 * person told "Understood.") and the reader filing "let investors play my
 * pitch" as company visibility. The reading now names the declared action
 * and the words that name its records (`appAction`); code runs that one
 * generated tool through the same executor -- its own authorize step, the
 * same service, an approval card for a CONSEQUENTIAL one -- and says the
 * tool's own line. Nothing here decides what is allowed.
 *
 * The reading's field arrives with the turn-reader version that carries
 * it; until then `appActionOf` finds none and the answer runs as before.
 */

export const TurnAppActionSchema = z
  .object({
    /** A generated tool's provider name, e.g. save_company. */
    tool: z.string().trim().min(1).max(64),
    /** Its model-facing input: names as the person said them. */
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
export type TurnAppAction = z.infer<typeof TurnAppActionSchema>;

/** The reading's app action, when the reader version carries one. */
export function appActionOf(read: object | null): TurnAppAction | null {
  if (read === null || !("appAction" in read)) return null;
  const parsed = TurnAppActionSchema.safeParse(read.appAction);
  return parsed.success ? parsed.data : null;
}

/**
 * A change prepared for approval: the engine says its status after the
 * turn ("…Not saved yet" for a new card, "That's ready…" for one already
 * waiting), so the turn itself says nothing more about it (lead
 * 2026-10-03: one status per card per answer).
 */
export type QAppActionPrepared = { readonly prepared: string };

/**
 * The action asked one thing it needs before it can be prepared (their
 * time zone, QA run 7d7e7260): `asks` is the question said to them; the
 * action and its arguments wait on the conversation for their reply.
 */
export type QAppActionAsks = {
  readonly asks: string;
  readonly needs: string;
};

export type QAppActionPort = {
  /** Tool names that are declared app actions (the registry's). */
  readonly tools: ReadonlySet<string>;
  readonly run: (
    request: QAnswerRequest,
    action: TurnAppAction,
  ) => Promise<string | QAppActionPrepared | QAppActionAsks | null>;
};

/** What a declared action is waiting on, kept on the conversation. */
export type PendingAppAction = {
  readonly action: TurnAppAction;
  readonly needs: string;
  readonly at: number;
};

/**
 * The declared action each conversation is waiting to continue (QA runs
 * 7d7e7260 -> 5c2f71aa: "Which city are you in…" then "Lagos" got no
 * card -- the reply was read on its own and the tool was out of focus).
 * Kept per conversation, briefly; the reply continues that action with
 * its arguments, never by re-reading phrases.
 */
export function createPendingAppActions(
  options: {
    readonly ttlMs?: number | undefined;
    readonly max?: number | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): {
  readonly hold: (
    conversationId: string,
    pending: Omit<PendingAppAction, "at">,
  ) => void;
  readonly take: (conversationId: string) => PendingAppAction | null;
} {
  const ttl = options.ttlMs ?? 30 * 60_000;
  const max = options.max ?? 2_000;
  const now = options.now ?? Date.now;
  const held = new Map<string, PendingAppAction>();
  return {
    hold: (conversationId, pending) => {
      held.delete(conversationId);
      held.set(conversationId, { ...pending, at: now() });
      while (held.size > max) {
        const oldest = held.keys().next().value;
        if (oldest === undefined) break;
        held.delete(oldest);
      }
    },
    take: (conversationId) => {
      const pending = held.get(conversationId) ?? null;
      held.delete(conversationId);
      return pending !== null && now() - pending.at <= ttl ? pending : null;
    },
  };
}

/** Refusals that say nothing about why: never said as the answer. */
const GENERIC_REFUSALS: ReadonlySet<string> = new Set([
  NOT_AVAILABLE_MESSAGE,
  "That tool is not available in this conversation.",
]);

/** Runs one generated tool, as this run, and returns its own line. */
export function createToolAppActionPort(dependencies: {
  readonly tools: QToolPort;
  readonly names: readonly string[];
  readonly logger?: Logger | undefined;
}): QAppActionPort {
  const names = new Set(dependencies.names);
  return {
    tools: names,
    run: async (request, action) => {
      if (!names.has(action.tool)) return null;
      try {
        const outcome = await dependencies.tools.execute(
          {
            callId: `q-app-action-${action.tool}`,
            name: action.tool,
            arguments: action.arguments,
          },
          {
            actor: request.actor,
            runId: request.runId,
            correlationId: request.correlationId,
            capability: request.capability,
            plan: request.plan,
            // Named by the turn: eligible wherever its scopes hold.
            focus: { areas: [], tools: [action.tool] },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (!outcome.result.ok) {
          // Refused with its own reason ("You don't have a Q Card yet…"):
          // that reason is the answer (QA run 938a39b7: it was dropped and
          // Q asked "Want me to proceed?"). A generic refusal or a failure
          // says nothing worth saying, and the answer runs as before.
          const reason = outcome.result.error.safeMessage.trim();
          return outcome.status === "DENIED" &&
            !GENERIC_REFUSALS.has(reason) &&
            reason.length > 0
            ? reason
            : null;
        }
        const data = outcome.result.data as {
          readonly status?: unknown;
          readonly says?: unknown;
          readonly summary?: unknown;
          readonly awaitingApprovalOf?: unknown;
        };
        // A declared action's own tool says `summary`; the hand-written
        // tool serving one (`legacyTool`) says `awaitingApprovalOf`. Both
        // prepared the same card.
        const prepared =
          typeof data.summary === "string"
            ? data.summary
            : typeof data.awaitingApprovalOf === "string"
              ? data.awaitingApprovalOf
              : "";
        if (data.status === "PREPARED" && prepared.trim().length > 0) {
          return { prepared: prepared.trim() };
        }
        // It needs one thing from them first: ask it, and wait for it.
        if (
          data.status === "NEEDS_TIME_ZONE" &&
          typeof data.says === "string" &&
          data.says.trim().length > 0
        ) {
          return { asks: data.says.trim(), needs: "TIME_ZONE" };
        }
        return typeof data.says === "string" && data.says.trim().length > 0
          ? data.says.trim()
          : null;
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId, tool: action.tool },
          "a declared app action read from the turn was not taken",
        );
        return null;
      }
    },
  };
}
