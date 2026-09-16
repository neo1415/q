import type {
  CreateQVoiceSessionRequest,
  QVoiceChoice,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * Voice session bindings (CQ-Q-VOICE-001 C §34, §37; doc 15 §42).
 *
 * A credential is issued to a person the server has already resolved, for
 * a thread they are already in. The provider's conversation id is the only
 * thing the provider will later present, so it is bound here — on the
 * server, before the microphone opens — to the ActorContext and the thread.
 * When the provider connects with that id, the binding is the authority;
 * the transcript never is (TM-VOICE-01).
 *
 * Process-local by design for V1: a binding is only ever needed by the
 * instance the provider connects to, and a local deployment is one
 * instance. Bounded in count per person and in time to connect, so a
 * credential that is never used cannot accumulate.
 */

export type VoiceThread = {
  /** The Q conversation spoken questions continue; set when the first one starts one. */
  conversationId: CreateQVoiceSessionRequest["conversationId"];
  readonly subjects: CreateQVoiceSessionRequest["subjects"];
  readonly onboarding: CreateQVoiceSessionRequest["onboarding"];
  /** Q's first minute with a new person: no onboarding session yet. */
  readonly welcome?: boolean | undefined;
  /**
   * What the person said their organisation was called at sign-up. A hint
   * for the greeting and a term for looking them up in public; never a
   * claim about membership, which is resolved from their session.
   */
  readonly organisationHint?: string | undefined;
};

export type VoiceSessionBinding = {
  readonly voiceSessionId: string;
  readonly providerConversationId: string;
  readonly actor: ActorContext;
  /**
   * The person's own access token, held in memory for the life of the
   * session so a spoken interview answer reaches the application API with
   * exactly the authority a typed one has — no more. Never logged, never
   * serialised, cleared when the session ends.
   */
  readonly accessToken: string;
  readonly voice: QVoiceChoice;
  readonly thread: VoiceThread;
  readonly issuedAt: number;
  /** After this, an unconnected binding is discarded. */
  readonly connectBy: number;
  connectedAt: number | undefined;
  /** Deepgram transport: the bearer its think calls carry. Never logged. */
  readonly thinkToken?: string | undefined;
};

export type VoiceSessionBindings = {
  /** Record a fresh binding; refuses when the person already holds too many. */
  issue(binding: VoiceSessionBinding): boolean;
  /** The binding the provider is presenting, if it is still valid. */
  connect(providerConversationId: string): VoiceSessionBinding | null;
  /** The live binding for an open conversation. */
  get(providerConversationId: string): VoiceSessionBinding | null;
  /** The binding issued as this voice session, if it is still held. */
  byVoiceSessionId(voiceSessionId: string): VoiceSessionBinding | null;
  /** The binding whose think secret this is (connected or not). */
  byThinkToken(thinkToken: string): VoiceSessionBinding | null;
  /** Release every binding this person holds: one voice session at a time. */
  releaseFor(userId: string): void;
  release(providerConversationId: string): void;
  /** Bindings held by this person right now (issued or connected). */
  countFor(userId: string): number;
  size(): number;
};

export const VOICE_CONNECT_WINDOW_MS = 5 * 60 * 1000;
/** One person may hold this many voice sessions at once (doc 15 §42). */
export const VOICE_SESSIONS_PER_USER_MAX = 3;
/** Process-local hygiene, never authorization. */
export const VOICE_SESSIONS_MAX = 500;

export class VoiceSessionLimitError extends Error {
  readonly errorCode = "Q_VOICE_SESSION_LIMIT" as const;
  constructor() {
    super("Too many voice sessions are open for this person.");
    this.name = "VoiceSessionLimitError";
  }
}

export function createVoiceSessionBindings(
  options: { readonly now?: () => number } = {},
): VoiceSessionBindings {
  const now = options.now ?? Date.now;
  const bindings = new Map<string, VoiceSessionBinding>();

  const sweep = () => {
    const at = now();
    for (const [id, binding] of bindings) {
      if (binding.connectedAt === undefined && binding.connectBy < at) {
        bindings.delete(id);
      }
    }
  };

  const countFor = (userId: string) => {
    sweep();
    let count = 0;
    for (const binding of bindings.values()) {
      if (binding.actor.userId === userId) {
        count += 1;
      }
    }
    return count;
  };

  return {
    issue: (binding) => {
      sweep();
      if (
        bindings.size >= VOICE_SESSIONS_MAX ||
        countFor(binding.actor.userId) >= VOICE_SESSIONS_PER_USER_MAX
      ) {
        return false;
      }
      bindings.set(binding.providerConversationId, binding);
      return true;
    },
    connect: (providerConversationId) => {
      sweep();
      const binding = bindings.get(providerConversationId);
      if (binding === undefined) {
        return null;
      }
      if (binding.connectedAt !== undefined) {
        // A conversation id connects once. A second presenter of the same
        // id is not the person who was issued it.
        return null;
      }
      binding.connectedAt = now();
      return binding;
    },
    byThinkToken: (thinkToken) => {
      sweep();
      for (const binding of bindings.values()) {
        if (
          binding.thinkToken !== undefined &&
          binding.thinkToken === thinkToken
        )
          return binding;
      }
      return null;
    },
    releaseFor: (userId) => {
      for (const [id, binding] of bindings) {
        if (binding.actor.userId === userId) bindings.delete(id);
      }
    },
    byVoiceSessionId: (voiceSessionId) => {
      for (const binding of bindings.values()) {
        if (binding.voiceSessionId === voiceSessionId) return binding;
      }
      return null;
    },
    get: (providerConversationId) => {
      const binding = bindings.get(providerConversationId);
      return binding === undefined || binding.connectedAt === undefined
        ? null
        : binding;
    },
    release: (providerConversationId) => {
      bindings.delete(providerConversationId);
    },
    countFor,
    size: () => {
      sweep();
      return bindings.size;
    },
  };
}
