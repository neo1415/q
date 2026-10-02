import type {
  CreateQVoiceSessionRequest,
  QScreenContext,
  QViewingMoment,
  QVoiceChoice,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { randomBytes } from "node:crypto";

import {
  createVoiceSessionSealer,
  voiceTokenFingerprint,
  type VoiceSessionClaims,
  type VoiceSessionSealer,
} from "./session-token.js";

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
 * Held in memory as a cache, and carried by a sealed token (session-token.ts)
 * so any instance can restore it: a deploy, a restart or a second replica
 * no longer ends every open line (HARDEN P0, 2026-10-02). Bounded in count
 * per person and in time to connect, so a credential that is never used
 * cannot accumulate.
 */

export type VoiceThread = {
  /** The Q conversation spoken questions continue; set when the first one starts one. */
  conversationId: CreateQVoiceSessionRequest["conversationId"];
  readonly subjects: CreateQVoiceSessionRequest["subjects"];
  readonly onboarding: CreateQVoiceSessionRequest["onboarding"];
  /**
   * R21: the screen the person is on now, as their browser last said
   * (on opening the line, then on every move). A request, never authority:
   * each spoken turn's run resolves its entities for them or drops them.
   */
  screen?: QScreenContext | undefined;
  /**
   * R18: the pitch moment on that screen, as their browser last said. A
   * request, never authority: each run authorises it for them or drops it.
   */
  viewing?: QViewingMoment | undefined;
  /** Q's first minute with a new person: no onboarding session yet. */
  readonly welcome?: boolean | undefined;
  /**
   * What the person said their organisation was called at sign-up. A hint
   * for the greeting and a term for looking them up in public; never a
   * claim about membership, which is resolved from their session.
   */
  readonly organisationHint?: string | undefined;
  /** REHEARSE: every turn on this line goes to this rehearsal. */
  readonly rehearsal?: CreateQVoiceSessionRequest["rehearsal"];
  /**
   * What Q said aloud to open the line, until the first question starts a
   * conversation with it as Q's first line: "what are those?" after a
   * spoken briefing refers to the briefing (founder live 2026-10-01).
   */
  opening?: string | undefined;
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
  /**
   * REHEARSE: the voice the person Q plays speaks with on this line (one
   * of the relay's own persona voices); absent means Q's voice.
   */
  readonly speakerVoiceId?: string | undefined;
  /** Deepgram transport: the bearer its think calls carry. Never logged. */
  readonly thinkToken?: string | undefined;
  /** The sealed token that restores this binding on any instance. Never logged. */
  readonly sessionToken?: string | undefined;
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
  /** First eight characters of each held think token, for diagnosis only. */
  fingerprints(): readonly string[];
  /** Release every binding this person holds: one voice session at a time. */
  releaseFor(userId: string): void;
  release(providerConversationId: string): void;
  /** Bindings held by this person right now (issued or connected). */
  countFor(userId: string): number;
  size(): number;
  /** Seal a binding's claims into a token any instance can restore. */
  seal(claims: VoiceSessionClaims): string;
  /**
   * The binding a sealed token names: the one held here, or -- after a
   * deploy, a restart or on another replica -- restored from the token,
   * connected, once the person is still allowed. Null for a token that
   * is tampered, expired, released here, or for a person no longer allowed.
   */
  restore(token: string): Promise<VoiceSessionBinding | null>;
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
  options: {
    readonly now?: () => number;
    /**
     * Seals and opens tokens. Absent, a per-process key is used, which
     * restores nothing after a restart: production passes one keyed from
     * a server secret.
     */
    readonly sealer?: VoiceSessionSealer | undefined;
    /**
     * Is this person still allowed a voice line? Asked before a binding is
     * restored from a token (a suspended account does not get its line back).
     */
    readonly stillAllowed?:
      ((actor: ActorContext) => Promise<boolean>) | undefined;
  } = {},
): VoiceSessionBindings {
  const now = options.now ?? Date.now;
  const bindings = new Map<string, VoiceSessionBinding>();
  const sealer =
    options.sealer ??
    createVoiceSessionSealer({
      secret: randomBytes(32).toString("base64url"),
      now,
    });
  /**
   * Lines ended here: their tokens are not restored again on this instance
   * (fingerprint -> when the token would have expired anyway).
   */
  const released = new Map<string, number>();
  const forget = (binding: VoiceSessionBinding) => {
    const token = binding.sessionToken ?? binding.thinkToken;
    if (token === undefined) return;
    released.set(voiceTokenFingerprint(token), now() + 4 * 60 * 60 * 1000);
    if (released.size > VOICE_SESSIONS_MAX * 4) {
      const at = now();
      for (const [key, until] of released) if (until < at) released.delete(key);
    }
  };
  const held = (token: string): VoiceSessionBinding | null => {
    for (const binding of bindings.values()) {
      if (binding.thinkToken === token || binding.sessionToken === token)
        return binding;
    }
    return null;
  };

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
    fingerprints: () => {
      const out: string[] = [];
      for (const binding of bindings.values()) {
        if (binding.thinkToken !== undefined)
          out.push(voiceTokenFingerprint(binding.thinkToken));
      }
      return out;
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
        if (binding.actor.userId === userId) {
          forget(binding);
          bindings.delete(id);
        }
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
      const binding = bindings.get(providerConversationId);
      if (binding !== undefined) forget(binding);
      bindings.delete(providerConversationId);
    },
    countFor,
    size: () => {
      sweep();
      return bindings.size;
    },
    seal: (claims) => sealer.seal(claims),
    restore: async (token) => {
      sweep();
      const local = held(token);
      if (local !== null) return local;
      if (released.has(voiceTokenFingerprint(token))) return null;
      const opened = sealer.open(token);
      if (opened === null) return null;
      if (
        options.stillAllowed !== undefined &&
        !(await options.stillAllowed(opened.actor).catch(() => false))
      ) {
        return null;
      }
      // Another request may have restored it while we asked.
      const raced = held(token);
      if (raced !== null) return raced;
      const at = now();
      const { expiresAt: _expiresAt, thinkBearer, ...claims } = opened;
      const binding: VoiceSessionBinding = {
        ...claims,
        // The line was already open elsewhere: restored as connected, so
        // the connect-once rule does not refuse its own next turn.
        connectBy: at,
        connectedAt: at,
        sessionToken: token,
        ...(thinkBearer === true ? { thinkToken: token } : {}),
      };
      // Restoring is not issuing: the per-person cap guards new lines, and
      // a restored one is a line the person already holds.
      bindings.set(binding.providerConversationId, binding);
      return binding;
    },
  };
}
