import { randomUUID } from "node:crypto";

import { z } from "zod";
import type { ActorContext } from "@capital-q/security";

type TrialClaimQuery = (
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => PromiseLike<unknown>;

const ClaimRows = z.array(z.object({ remaining: z.string().nullable() }));
const HeldRows = z.array(z.object({ held: z.boolean() }));
const ReleaseRows = z.array(z.object({ released: z.boolean() }));

// The named-account five-minute trial is narrower than the platform grant maximum.
const TRIAL_ACCOUNT_LIMIT_SECONDS = 300;

/** Exclusive coordination; canonical trial usage remains consumption truth. */
export type LiveTrialClaimStore = {
  readonly held: (actor: ActorContext) => Promise<boolean>;
  readonly claim: (input: {
    readonly actor: ActorContext;
    readonly allowanceSeconds: number;
    readonly voiceSessionId: string;
  }) => Promise<{
    readonly claimId: string;
    readonly remainingSeconds: number;
  } | null>;
  /** Never release on socket close: provider termination AND final durable usage. */
  readonly release: (input: {
    readonly actor: ActorContext;
    readonly claimId: string;
    /** Null is only legal if no provider session was ever created. */
    readonly providerSessionId: string | null;
    readonly finalSeconds: number;
    readonly providerTerminated: true;
  }) => Promise<boolean>;
};

export function createPostgresLiveTrialClaims(
  sql: TrialClaimQuery,
): LiveTrialClaimStore {
  return {
    held: async (actor) => {
      const rows = HeldRows.parse(
        await sql`
        select exists(select 1 from q_runtime.voice_live_trial_claims
          where user_id = ${actor.userId}) as held`,
      );
      if (rows[0] === undefined) throw new Error("unreadable held trial claim");
      return rows[0].held;
    },
    claim: async ({ actor, allowanceSeconds, voiceSessionId }) => {
      if (
        !Number.isInteger(allowanceSeconds) ||
        allowanceSeconds < 1 ||
        allowanceSeconds > TRIAL_ACCOUNT_LIMIT_SECONDS ||
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(voiceSessionId)
      ) {
        throw new Error("invalid trial claim");
      }
      const claimId = randomUUID();
      const rows = ClaimRows.parse(
        await sql`
        select q_runtime.claim_voice_live_trial(${actor.tenantId}, ${actor.userId},
          ${claimId}, ${voiceSessionId}, ${allowanceSeconds})::text as remaining`,
      );
      const remaining = rows[0]?.remaining;
      if (remaining === null) return null;
      const remainingSeconds = Number(remaining);
      if (
        !Number.isFinite(remainingSeconds) ||
        remainingSeconds <= 0 ||
        remainingSeconds > allowanceSeconds
      )
        throw new Error("unreadable trial claim");
      return { claimId, remainingSeconds };
    },
    release: async ({
      actor,
      claimId,
      providerSessionId,
      finalSeconds,
      providerTerminated,
    }) => {
      if (
        providerTerminated !== true ||
        !Number.isFinite(finalSeconds) ||
        finalSeconds < 0 ||
        (providerSessionId === null && finalSeconds !== 0)
      )
        return false;
      const rows = ReleaseRows.parse(
        await sql`
        select q_runtime.release_voice_live_trial(${actor.tenantId}, ${actor.userId},
          ${claimId}, ${providerSessionId}, ${finalSeconds}, ${providerTerminated}) as released`,
      );
      return rows[0]?.released === true;
    },
  };
}
