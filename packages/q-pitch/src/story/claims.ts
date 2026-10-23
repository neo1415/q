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
import { STORY_BEATS, STORY_VERSION, type StoryBeat } from "./beats.js";

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

/**
 * The claims when the story plays its product part as stills (preload.ts,
 * STORY_STILL_ROUTES): a picture of a fictional page demonstrates the
 * product, it does not show it live, so every PRODUCT beat is a
 * DEMONSTRATION beat and is labelled so. The gate then has no live claim
 * to certify; the owner's approval still decides the audience.
 */
export function stillClaims(
  claims: Readonly<Record<number, StoryClaim>> = STORY_CLAIMS,
): Readonly<Record<number, StoryClaim>> {
  return Object.fromEntries(
    Object.entries(claims).map(([n, claim]) => [
      n,
      claim.kind === "PRODUCT" ? D : claim,
    ]),
  );
}

/** The beat shows demonstration data, so it carries the label. */
export function isDemonstrationClaim(claim: StoryClaim | undefined): boolean {
  return (
    claim?.kind === "DEMONSTRATION" ||
    (claim?.kind === "PRODUCT" && claim.demonstration)
  );
}

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

/**
 * The owner's approvals of the story for an audience, as records: who,
 * when, and which cut. Empty until given. An approval is of one cut (an
 * edition's version, editions.ts): a re-cut or another edition needs its
 * own yes, so no audience ever sees a cut on another cut's approval. The
 * gate reads them (storyOwnerApproved); the "Internal rehearsal" stamp is
 * never removed by hand.
 */
export const StoryOwnerApprovalSchema = z
  .object({
    approvedBy: z.string().min(1),
    at: z.iso.datetime(),
    storyVersion: z.string().min(1),
  })
  .strict();
export type StoryOwnerApproval = z.infer<typeof StoryOwnerApprovalSchema>;

/**
 * Recorded 2026-10-22: the owner, in the S1 session, asked whether all
 * three editions are approved for an audience, answered "yes, I approve".
 * Each cut is approved by its own version.
 */
const OWNER = "owner (founder)";
const APPROVED_AT = "2026-10-22T14:40:00Z";
export const STORY_OWNER_APPROVALS: readonly StoryOwnerApproval[] = [
  { approvedBy: OWNER, at: APPROVED_AT, storyVersion: "story-v7.1" },
  { approvedBy: OWNER, at: APPROVED_AT, storyVersion: "story-v7.1-investor" },
  { approvedBy: OWNER, at: APPROVED_AT, storyVersion: "story-v7.1-founder" },
];

export function storyOwnerApproved(
  version: string = STORY_VERSION,
  approvals: readonly StoryOwnerApproval[] = STORY_OWNER_APPROVALS,
): boolean {
  return approvals.some(
    (approval) =>
      StoryOwnerApprovalSchema.safeParse(approval).success &&
      approval.storyVersion === version,
  );
}

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
