import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import {
  CreateQVoiceSessionRequestSchema,
  QVoiceChoiceSchema,
} from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import type { VoiceSessionBinding } from "./bindings.js";

/**
 * Sealed voice session tokens (HARDEN P0, live 2026-10-02).
 *
 * A voice line's binding used to live only in this process's memory, so a
 * deploy, a restart or a second replica refused every think and speak call
 * of every open line ("voice speak relay refused NO_BINDING_FOR_TOKEN
 * boundCount=0" at the moment the new container took over), and the person
 * heard the line drop. We deploy many times a day.
 *
 * The binding is now carried by the token itself: AES-256-GCM over the
 * binding as the server resolved it when the line opened. GCM is
 * authenticated, so a token any field of which was changed does not open;
 * it is encrypted rather than only signed because it carries the person's
 * own access token (which a spoken interview answer needs) and the speech
 * provider holds it as a bearer. Any instance holding the same server
 * secret opens it. Nothing in it comes from the client: every field was
 * resolved on the server before it was sealed.
 *
 * Keys are derived (HKDF) from an existing server secret and a key
 * version. Rotating is bumping VOICE_SESSION_KEY_VERSION: tokens sealed
 * under the previous version still open until they expire, new ones are
 * sealed under the new version.
 */

export const VOICE_SESSION_KEY_VERSION = 1;
/** The browser presents its line's sealed token on the turn and screen routes. */
export const Q_VOICE_SESSION_TOKEN_HEADER = "x-q-voice-session";
/** How long a line can be resumed on any instance after it opened. */
export const VOICE_SESSION_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

const PREFIX = "qv1";

const ThreadClaimsSchema = CreateQVoiceSessionRequestSchema.pick({
  conversationId: true,
  subjects: true,
  onboarding: true,
  screen: true,
  organisationHint: true,
  rehearsal: true,
})
  .extend({
    welcome: z.boolean().optional(),
    opening: z.string().max(4000).optional(),
  })
  .strict();

const ClaimsSchema = z
  .object({
    sid: z.string().uuid(),
    pc: z.string().min(1).max(200),
    actor: ActorContextSchema,
    at: z.string().min(1),
    voice: QVoiceChoiceSchema,
    thread: ThreadClaimsSchema,
    spk: z.string().min(1).max(200).optional(),
    tb: z.literal(true).optional(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

type Claims = z.infer<typeof ClaimsSchema>;

/** What is sealed: the binding as issued, without its live state. */
export type VoiceSessionClaims = Pick<
  VoiceSessionBinding,
  | "voiceSessionId"
  | "providerConversationId"
  | "actor"
  | "accessToken"
  | "voice"
  | "thread"
  | "issuedAt"
  | "speakerVoiceId"
> & {
  /** The token is also the provider's think/speak bearer (Deepgram). */
  readonly thinkBearer?: boolean | undefined;
};

export type OpenedVoiceSession = VoiceSessionClaims & {
  readonly expiresAt: number;
};

export type VoiceSessionSealer = {
  seal(claims: VoiceSessionClaims): string;
  /** The claims, or null for a token that is tampered, foreign or expired. */
  open(token: string): OpenedVoiceSession | null;
};

/** A short, non-reversible handle for logs: never the token itself. */
export function voiceTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("base64url").slice(0, 8);
}

export function createVoiceSessionSealer(options: {
  /** An existing server secret; never sent anywhere, only derived from. */
  readonly secret: string;
  readonly keyVersion?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
}): VoiceSessionSealer {
  if (options.secret.length < 16) {
    throw new Error("voice session secret is too short");
  }
  const now = options.now ?? Date.now;
  const current = options.keyVersion ?? VOICE_SESSION_KEY_VERSION;
  const ttl = options.ttlMs ?? VOICE_SESSION_TOKEN_TTL_MS;
  const keys = new Map<number, Buffer>();
  const keyFor = (version: number): Buffer | null => {
    // The current version and the one before it: a token from before a
    // rotation still opens until it expires; anything older never does.
    if (version !== current && version !== current - 1) return null;
    if (version < 1) return null;
    const held = keys.get(version);
    if (held !== undefined) return held;
    const derived = Buffer.from(
      hkdfSync(
        "sha256",
        options.secret,
        "capital-q/voice-session",
        `v${String(version)}`,
        32,
      ),
    );
    keys.set(version, derived);
    return derived;
  };

  return {
    seal: (claims) => {
      const key = keyFor(current);
      if (key === null) throw new Error("no voice session key");
      const body: Claims = {
        sid: claims.voiceSessionId,
        pc: claims.providerConversationId,
        actor: claims.actor,
        at: claims.accessToken,
        voice: claims.voice,
        thread: {
          ...(claims.thread.conversationId === undefined
            ? {}
            : { conversationId: claims.thread.conversationId }),
          ...(claims.thread.subjects === undefined
            ? {}
            : { subjects: claims.thread.subjects }),
          ...(claims.thread.onboarding === undefined
            ? {}
            : { onboarding: claims.thread.onboarding }),
          ...(claims.thread.screen === undefined
            ? {}
            : { screen: claims.thread.screen }),
          ...(claims.thread.organisationHint === undefined
            ? {}
            : { organisationHint: claims.thread.organisationHint }),
          ...(claims.thread.rehearsal === undefined
            ? {}
            : { rehearsal: claims.thread.rehearsal }),
          ...(claims.thread.welcome === undefined
            ? {}
            : { welcome: claims.thread.welcome }),
          ...(claims.thread.opening === undefined
            ? {}
            : { opening: claims.thread.opening }),
        },
        ...(claims.speakerVoiceId === undefined
          ? {}
          : { spk: claims.speakerVoiceId }),
        ...(claims.thinkBearer === true ? { tb: true as const } : {}),
        iat: claims.issuedAt,
        exp: claims.issuedAt + ttl,
      };
      const header = `${PREFIX}.${String(current)}`;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(header));
      const sealed = Buffer.concat([
        cipher.update(JSON.stringify(body), "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return `${header}.${iv.toString("base64url")}.${sealed.toString("base64url")}`;
    },
    open: (token) => {
      const parts = token.split(".");
      if (parts.length !== 4 || parts[0] !== PREFIX) return null;
      const [, versionText = "", ivText = "", sealedText = ""] = parts;
      if (!/^\d{1,4}$/.test(versionText)) return null;
      const key = keyFor(Number(versionText));
      if (key === null) return null;
      const iv = Buffer.from(ivText, "base64url");
      const sealed = Buffer.from(sealedText, "base64url");
      if (iv.length !== 12 || sealed.length <= 16) return null;
      let plain: string;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(`${PREFIX}.${versionText}`));
        decipher.setAuthTag(sealed.subarray(sealed.length - 16));
        plain = Buffer.concat([
          decipher.update(sealed.subarray(0, sealed.length - 16)),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        return null;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(plain);
      } catch {
        return null;
      }
      const parsed = ClaimsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const claims = parsed.data;
      if (claims.exp <= now()) return null;
      const { welcome, opening, ...thread } = claims.thread;
      return {
        voiceSessionId: claims.sid,
        providerConversationId: claims.pc,
        actor: claims.actor,
        accessToken: claims.at,
        voice: claims.voice,
        thread: {
          conversationId: thread.conversationId,
          subjects: thread.subjects,
          onboarding: thread.onboarding,
          ...(thread.screen === undefined ? {} : { screen: thread.screen }),
          ...(thread.organisationHint === undefined
            ? {}
            : { organisationHint: thread.organisationHint }),
          ...(thread.rehearsal === undefined
            ? {}
            : { rehearsal: thread.rehearsal }),
          ...(welcome === undefined ? {} : { welcome }),
          ...(opening === undefined ? {} : { opening }),
        },
        issuedAt: claims.iat,
        ...(claims.spk === undefined ? {} : { speakerVoiceId: claims.spk }),
        ...(claims.tb === true ? { thinkBearer: true } : {}),
        expiresAt: claims.exp,
      };
    },
  };
}
