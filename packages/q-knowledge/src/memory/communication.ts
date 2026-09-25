import { z } from "zod";

import {
  QCommunicationProfileSchema,
  type PermittedContextPlan,
  type QCommunicationProfile,
} from "@capital-q/contracts";
import { DEFAULT_COMMUNICATION_PROFILE } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import type { MemoryBundle, MemoryItem } from "./contracts.js";
import { renderMemoryBundle } from "./render.js";
import type { MemoryService } from "./service.js";

/**
 * How the person wants Q to talk, from what they said (CQ-QX-007 P0-5;
 * ADR 0012).
 *
 * A communication preference is a memory item of type `preference` whose
 * key names one aspect of the communication profile and whose structured
 * value carries that aspect's closed value — `{ responseDepth: "CONCISE" }`
 * for "just give me the result". The profile is a projection of those
 * items over the default: nothing here reads prose, and a value outside
 * the contract's vocabulary is ignored rather than guessed at.
 *
 * Two lifetimes, one store:
 *   - LONG_TERM `preference.communication.<aspect>`: holds in every later
 *     conversation until the person changes it (supersede-by-key).
 *   - SESSION `preference.session.<conversationId>.<aspect>`: holds for the
 *     rest of that one conversation and never reaches another.
 * A session preference for this conversation outranks a long-term one; the
 * newest of each wins.
 *
 * Memory changes how Q speaks and never what anybody may see or do
 * (ADR 0012, "What memory is not").
 */
export const COMMUNICATION_ASPECTS = [
  "responseDepth",
  "tone",
  "challengeLevel",
  "questionStyle",
  "explanationStyle",
] as const;
export type CommunicationAspect = (typeof COMMUNICATION_ASPECTS)[number];

export const PREFERENCE_PERSISTENCES = ["SESSION", "LONG_TERM"] as const;
export type PreferencePersistence = (typeof PREFERENCE_PERSISTENCES)[number];

const snake = (aspect: CommunicationAspect): string =>
  aspect.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const LONG_TERM_PREFIX = "preference.communication.";
const SESSION_PREFIX = "preference.session.";

/** The memory key a preference is kept under. Deterministic, closed. */
export function communicationPreferenceKey(
  aspect: CommunicationAspect,
  persistence: PreferencePersistence,
  conversationId: string | null,
): string {
  if (persistence === "SESSION") {
    if (conversationId === null) {
      throw new Error("a session preference needs its conversation");
    }
    return `${SESSION_PREFIX}${conversationId.toLowerCase()}.${snake(aspect)}`;
  }
  return `${LONG_TERM_PREFIX}${snake(aspect)}`;
}

/** Whether a memory item is a session preference of another conversation. */
function belongsToAnotherSession(
  item: MemoryItem,
  conversationId: string | null,
): boolean {
  if (!item.memoryKey.startsWith(SESSION_PREFIX)) return false;
  const owner = item.memoryKey.slice(SESSION_PREFIX.length).split(".")[0];
  return conversationId === null || owner !== conversationId.toLowerCase();
}

/** The aspect values an item declares, each checked against the contract. */
function declaredAspects(item: MemoryItem): Partial<QCommunicationProfile> {
  if (item.memoryType !== "preference") return {};
  const shape = QCommunicationProfileSchema.shape;
  const out: Partial<Record<CommunicationAspect, unknown>> = {};
  for (const aspect of COMMUNICATION_ASPECTS) {
    const parsed = (shape[aspect] as z.ZodType).safeParse(
      item.structuredValue[aspect],
    );
    if (parsed.success) out[aspect] = parsed.data;
  }
  return out as Partial<QCommunicationProfile>;
}

/**
 * The profile for one conversation: the base, then long-term preferences,
 * then this conversation's session preferences, oldest to newest within
 * each, so the latest thing the person said about each aspect governs.
 */
export function communicationProfileFromMemory(
  items: readonly MemoryItem[],
  options: {
    readonly conversationId: string | null;
    readonly base?: QCommunicationProfile | undefined;
  },
): QCommunicationProfile {
  const live = items.filter(
    (item) =>
      (item.status === "active" || item.status === "confirmed") &&
      item.validTo === null &&
      item.memoryType === "preference",
  );
  const byTime = (a: MemoryItem, b: MemoryItem) =>
    a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id);
  const longTerm = live
    .filter((item) => item.memoryKey.startsWith(LONG_TERM_PREFIX))
    .sort(byTime);
  const session = live
    .filter(
      (item) =>
        item.memoryKey.startsWith(SESSION_PREFIX) &&
        !belongsToAnotherSession(item, options.conversationId),
    )
    .sort(byTime);
  let profile: QCommunicationProfile = {
    ...(options.base ?? DEFAULT_COMMUNICATION_PROFILE),
  };
  for (const item of [...longTerm, ...session]) {
    profile = { ...profile, ...declaredAspects(item) };
  }
  return QCommunicationProfileSchema.parse(profile);
}

/** The recall bundle without other conversations' session preferences. */
function forConversation(
  bundle: MemoryBundle,
  conversationId: string | null,
): MemoryBundle {
  return {
    ...bundle,
    person: bundle.person.filter(
      (item) => !belongsToAnotherSession(item, conversationId),
    ),
  };
}

/** Whether the plan lets this actor's own conversation memory in. */
export function planAdmitsOwnMemory(
  plan: Pick<PermittedContextPlan, "scopes">,
  actor: Pick<ActorContext, "userId">,
): boolean {
  return plan.scopes.some(
    (scope) =>
      scope.kind === "OWN_Q_CONVERSATION" &&
      scope.subject === undefined &&
      scope.filter.userId === actor.userId,
  );
}

export type LoopMemory = {
  /** Rendered recall, UNTRUSTED: for the prompt's memory variable. */
  readonly memory: string;
  readonly profile: QCommunicationProfile;
};

export type LoopMemoryReader = {
  readonly read: (input: {
    readonly actor: ActorContext;
    readonly plan: Pick<PermittedContextPlan, "scopes">;
    /**
     * Whose session preferences apply: the conversation this loop is in
     * (a Q conversation or an onboarding session). Null: none.
     */
    readonly sessionKey: string | null;
    /** A Q conversation, when the loop has one, for its digest. */
    readonly conversationId?: string | undefined;
    readonly companyIds?: readonly string[] | undefined;
  }) => Promise<LoopMemory>;
};

export const NOTHING_RECALLED = "";

/**
 * Recall and profile for a conversation loop (the interview agent, P0-5),
 * as an input the loop takes. Only through the firewall's actor-wide
 * OWN_Q_CONVERSATION scope for this very person; without it, nothing is
 * recalled and the default profile applies. A recall that fails costs the
 * turn its memory, never the turn.
 */
export function createLoopMemoryReader(options: {
  readonly memory: Pick<MemoryService, "recall">;
  readonly base?: QCommunicationProfile | undefined;
  readonly maxChars?: number | undefined;
}): LoopMemoryReader {
  const base = options.base ?? DEFAULT_COMMUNICATION_PROFILE;
  return {
    read: async ({ actor, plan, sessionKey, conversationId, companyIds }) => {
      if (!planAdmitsOwnMemory(plan, actor)) {
        return { memory: NOTHING_RECALLED, profile: { ...base } };
      }
      try {
        const bundle = forConversation(
          await options.memory.recall({
            actor,
            ...(conversationId === undefined ? {} : { conversationId }),
            ...(companyIds === undefined
              ? {}
              : { companyIds: [...companyIds] }),
          }),
          sessionKey,
        );
        return {
          memory: renderMemoryBundle(bundle, options.maxChars ?? 4_000),
          profile: communicationProfileFromMemory(bundle.person, {
            conversationId: sessionKey,
            base,
          }),
        };
      } catch {
        return { memory: NOTHING_RECALLED, profile: { ...base } };
      }
    },
  };
}
