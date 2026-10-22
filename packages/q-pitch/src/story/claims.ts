import { z } from "zod";

import {
  featureOfClaim,
  sameActor,
  ClaimIdSchema,
  type ClaimId,
  type TourActor,
} from "../scene-evidence.js";
import { INVESTOR_V6_LEDGER } from "../investor-v6.js";
import { PREMIERE_CERTIFICATION_LEDGER } from "../premiere-ledger.js";
import type {
  CertificationEntry,
  CertificationLedger,
  CertificationStatus,
} from "../script.js";
import { STORY_BEATS, type StoryBeat } from "./beats.js";

/**
 * What each story beat claims about the product (CLAUDE.md: every
 * demonstration claim maps to CERTIFICATION_MANIFEST.md; coordinator
 * decision, 21 Oct):
 *
 * - NARRATIVE: the owner's story (Acts 0-3) and the close's vision lines.
 *   No product claim is made, so nothing needs certifying.
 * - PRODUCT: the beat shows a product surface; each claim id names an
 *   existing certified feature's allowed claim.
 * - DEMONSTRATION: the beat shows something no ledger entry covers (GateQ
 *   score and rank, the InvestIQ card, investor matches, the Q Card for a
 *   fictional company). It is shown labelled "Demonstration data" and is
 *   never a certified claim.
 *
 * A PRODUCT beat may also carry demonstration artifacts (`demonstration`),
 * e.g. #44 shows the real inbox (certified) and an illustrative ranking.
 */
export const StoryClaimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NARRATIVE") }).strict(),
  z
    .object({
      kind: z.literal("PRODUCT"),
      claimIds: z.array(ClaimIdSchema).min(1).max(8),
      demonstration: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal("DEMONSTRATION") }).strict(),
]);
export type StoryClaim = z.infer<typeof StoryClaimSchema>;

export const DEMONSTRATION_LABEL = "Demonstration data" as const;

const N: StoryClaim = { kind: "NARRATIVE" };
const D: StoryClaim = { kind: "DEMONSTRATION" };
const P = (...claimIds: ClaimId[]): StoryClaim => ({
  kind: "PRODUCT",
  claimIds,
  demonstration: false,
});
const PD = (...claimIds: ClaimId[]): StoryClaim => ({
  kind: "PRODUCT",
  claimIds,
  demonstration: true,
});

/** By beat number (1-56). A test keeps it complete and every id real. */
export const STORY_CLAIMS: Readonly<Record<number, StoryClaim>> = {
  // Acts 0-3: the owner's story. No product claim.
  ...Object.fromEntries(
    Array.from({ length: 34 }, (_, i) => [i + 1, N] as const),
  ),
  // Act 4: for investors.
  35: P("INV6-DISCOVER-FEED.c1"),
  36: P("INV-MANDATE-VIEW.c1"),
  37: P("INV6-DISCOVER-FEED.c2"),
  38: P("FEED-VIEW.c1"),
  // Express interest is lit, never pressed: the match is described, not shown.
  39: D,
  40: PD(
    "INV-DISCOVER-TOP3.c1",
    "INV-COMPARE-TABLE.c1",
    "INV6-PROFILE-DILIGENCE.c1",
    "MEETING-PREP-VIEW.c1",
  ),
  41: P("GATEQ-DOSSIER-VIEW.c1", "INV6-GATEQ.c2"),
  42: P("INV6-GATEQ.c1"),
  // Where a gate can be embedded: the channels are illustrative.
  43: D,
  // The inbox is certified; score and rank are not built (plan §8.3).
  44: PD("GATEQ-INBOX-VIEW.c1"),
  // Act 5: for businesses, on Q-stage artifacts (founder workspace switch
  // QP-F10 is PLANNED).
  45: D,
  46: D,
  47: D,
  // Act 6: the close.
  48: D,
  49: D,
  50: N,
  51: D,
  52: N,
  53: N,
  54: P("QP-HOME-HANDOFF.c1"),
  55: N,
  56: N,
};

/** The story's ledger: the certified entries its PRODUCT claims rest on. */
export const STORY_LEDGER: CertificationLedger = (() => {
  const wanted = new Set(
    Object.values(STORY_CLAIMS).flatMap((claim) =>
      claim.kind === "PRODUCT" ? claim.claimIds.map(featureOfClaim) : [],
    ),
  );
  const byFeature = new Map<string, CertificationEntry>();
  for (const entry of [
    ...INVESTOR_V6_LEDGER,
    ...PREMIERE_CERTIFICATION_LEDGER,
  ]) {
    if (wanted.has(entry.featureId) && !byFeature.has(entry.featureId)) {
      byFeature.set(entry.featureId, entry);
    }
  }
  return [...byFeature.values()];
})();

export type StoryGateEnvironment = {
  /** ISO 8601; the gate reads no clock. */
  readonly now: string;
  readonly actor: TourActor;
  readonly staleFeatureIds: readonly string[];
  /** The owner approved the story for an audience (blueprint §15). */
  readonly ownerApproved: boolean;
};

export type StoryClaimProblem = {
  readonly beat: number;
  readonly claimId: ClaimId;
  readonly reason:
    | "NO_ENTRY"
    | "CLAIM_NOT_ALLOWED"
    | "STATUS_NOT_CERTIFIED"
    | "EXPIRED"
    | "STALE"
    | "ACTOR_NOT_CERTIFIED";
};

export type StoryGateResult = {
  /** AUDIENCE only when the owner approved and every PRODUCT claim holds. */
  readonly audience: "AUDIENCE" | "INTERNAL_REHEARSAL";
  readonly problems: readonly StoryClaimProblem[];
  /** Product beats whose every claim is certified, of all product beats. */
  readonly certifiedProductBeats: number;
  readonly productBeats: number;
  /** Beats that show demonstration data (the label must be on screen). */
  readonly demonstrationBeats: readonly number[];
};

const CERTIFIED: readonly CertificationStatus[] = ["PRODUCTION_LIVE_VERIFIED"];

/**
 * The story's certification gate (the v6 gate's rules, per claim): a
 * PRODUCT claim holds only on a PRODUCTION_LIVE_VERIFIED entry for this
 * actor that allows that exact claim, unexpired and not stale. Anything
 * else keeps the story an internal rehearsal; nothing here drops a beat,
 * because the words are the owner's and never change.
 */
export function certifyStory(
  env: StoryGateEnvironment,
  claims: Readonly<Record<number, StoryClaim>> = STORY_CLAIMS,
  ledger: CertificationLedger = STORY_LEDGER,
  beats: readonly StoryBeat[] = STORY_BEATS,
): StoryGateResult {
  const entries = new Map(ledger.map((e) => [e.featureId, e] as const));
  const problems: StoryClaimProblem[] = [];
  let productBeats = 0;
  let certifiedProductBeats = 0;
  const demonstrationBeats: number[] = [];
  for (const beat of beats) {
    const claim = claims[beat.n];
    if (claim === undefined) continue;
    if (
      claim.kind === "DEMONSTRATION" ||
      (claim.kind === "PRODUCT" && claim.demonstration)
    ) {
      demonstrationBeats.push(beat.n);
    }
    if (claim.kind !== "PRODUCT") continue;
    productBeats += 1;
    let holds = true;
    for (const claimId of claim.claimIds) {
      const reason = claimProblem(
        entries.get(featureOfClaim(claimId)),
        claimId,
        env,
      );
      if (reason !== null) {
        holds = false;
        problems.push({ beat: beat.n, claimId, reason });
      }
    }
    if (holds) certifiedProductBeats += 1;
  }
  return {
    audience:
      env.ownerApproved && problems.length === 0
        ? "AUDIENCE"
        : "INTERNAL_REHEARSAL",
    problems,
    certifiedProductBeats,
    productBeats,
    demonstrationBeats,
  };
}

function claimProblem(
  entry: CertificationEntry | undefined,
  claimId: ClaimId,
  env: StoryGateEnvironment,
): StoryClaimProblem["reason"] | null {
  if (entry === undefined) return "NO_ENTRY";
  if (!entry.claimsAllowed.some((c) => c.claimId === claimId)) {
    return "CLAIM_NOT_ALLOWED";
  }
  if (!CERTIFIED.includes(entry.status)) return "STATUS_NOT_CERTIFIED";
  if (
    "at" in entry.validUntil &&
    Date.parse(entry.validUntil.at) <= Date.parse(env.now)
  ) {
    return "EXPIRED";
  }
  if (env.staleFeatureIds.includes(entry.featureId)) return "STALE";
  if (!sameActor(entry.actorContext, env.actor)) return "ACTOR_NOT_CERTIFIED";
  return null;
}
