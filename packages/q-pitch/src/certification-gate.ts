import {
  featureOfClaim,
  sameActor,
  type ClaimId,
  type FeatureId,
  type SceneId,
} from "./scene-evidence.js";
import type {
  CertificationEntry,
  CertificationLedger,
  CertificationStatus,
  Chapter,
  SceneScript,
  TourScript,
} from "./script.js";

/**
 * The tour-start certification gate (blueprint §9 "At tour start", §12
 * Truth; CERTIFICATION_MANIFEST.md "No entry means no claim").
 *
 * For every scene: each feature it demonstrates must have a ledger entry
 * with an accepted status, verified on the same demo actor, neither past
 * its `validUntil` time nor marked stale by the integration owner; and
 * every line's claims must be certified claims of those features. A scene
 * that fails is REPLACED by its fallback scene, when that one passes, or
 * SUPPRESSED. A rejected line takes its scene with it: narration is never
 * silently thinned into a different story.
 */

export const GATE_AUDIENCES = ["INTERNAL_REHEARSAL", "AUDIENCE"] as const;
export type GateAudience = (typeof GATE_AUDIENCES)[number];

export type GateEnvironment = {
  /** Tour start, ISO 8601. Passed in: the gate reads no clock. */
  readonly now: string;
  /**
   * Features whose relevant code changed since certification (the
   * manifest's "revision changed in the relevant area"), decided by the
   * integration owner against the deployed revision.
   */
  readonly staleFeatureIds: readonly FeatureId[];
  /** Default: PRODUCTION_LIVE_VERIFIED only. */
  readonly acceptedStatuses?: readonly CertificationStatus[];
  /** An audience run requires an OWNER_APPROVED script (blueprint §15). */
  readonly audience: GateAudience;
};

export const SCENE_REASONS = [
  "SCRIPT_NOT_APPROVED",
  "NO_ENTRY",
  "STATUS_NOT_ACCEPTED",
  "EXPIRED",
  "STALE",
  "ACTOR_NOT_CERTIFIED",
  "LINE_REJECTED",
  "FALLBACK_UNAVAILABLE",
] as const;
export type SceneReason = (typeof SCENE_REASONS)[number];

export type SceneDecision = {
  readonly sceneId: SceneId;
  readonly verdict: "ADMITTED" | "REPLACED" | "SUPPRESSED";
  readonly replacedBy?: SceneId;
  readonly reasons: readonly SceneReason[];
};

export type RejectedLine = {
  readonly sceneId: SceneId;
  readonly lineId: string;
  readonly claimId: ClaimId;
  readonly reason: "UNCERTIFIED_CLAIM" | "FEATURE_NOT_IN_SCENE";
};

export type GateResult = {
  readonly scenes: readonly SceneScript[];
  readonly chapters: readonly Chapter[];
  readonly decisions: readonly SceneDecision[];
  readonly rejectedLines: readonly RejectedLine[];
};

const DEFAULT_ACCEPTED: readonly CertificationStatus[] = [
  "PRODUCTION_LIVE_VERIFIED",
];

function entryUsable(
  entry: CertificationEntry | undefined,
  scene: SceneScript,
  env: GateEnvironment,
): SceneReason | null {
  if (entry === undefined) return "NO_ENTRY";
  if (!(env.acceptedStatuses ?? DEFAULT_ACCEPTED).includes(entry.status)) {
    return "STATUS_NOT_ACCEPTED";
  }
  if (
    "at" in entry.validUntil &&
    Date.parse(entry.validUntil.at) <= Date.parse(env.now)
  ) {
    return "EXPIRED";
  }
  if (env.staleFeatureIds.includes(entry.featureId)) return "STALE";
  if (!sameActor(entry.actorContext, scene.actor)) return "ACTOR_NOT_CERTIFIED";
  return null;
}

type Check = {
  readonly reasons: readonly SceneReason[];
  readonly rejectedLines: readonly RejectedLine[];
};

function checkScene(
  scene: SceneScript,
  script: TourScript,
  entries: ReadonlyMap<FeatureId, CertificationEntry>,
  env: GateEnvironment,
): Check {
  const reasons = new Set<SceneReason>();
  if (env.audience === "AUDIENCE" && script.status !== "OWNER_APPROVED") {
    reasons.add("SCRIPT_NOT_APPROVED");
  }
  const usable = new Set<FeatureId>();
  for (const featureId of scene.featureIds) {
    const reason = entryUsable(entries.get(featureId), scene, env);
    if (reason === null) usable.add(featureId);
    else reasons.add(reason);
  }
  const rejectedLines: RejectedLine[] = [];
  for (const line of [...scene.lines, ...scene.fallbackLines]) {
    for (const claimId of line.claimIds) {
      const featureId = featureOfClaim(claimId);
      if (!scene.featureIds.includes(featureId)) {
        rejectedLines.push({
          sceneId: scene.sceneId,
          lineId: line.lineId,
          claimId,
          reason: "FEATURE_NOT_IN_SCENE",
        });
        continue;
      }
      const certified =
        usable.has(featureId) &&
        (entries.get(featureId)?.claimsAllowed ?? []).some(
          (c) => c.claimId === claimId,
        );
      if (!certified) {
        rejectedLines.push({
          sceneId: scene.sceneId,
          lineId: line.lineId,
          claimId,
          reason: "UNCERTIFIED_CLAIM",
        });
      }
    }
  }
  if (rejectedLines.length > 0) reasons.add("LINE_REJECTED");
  return { reasons: [...reasons], rejectedLines };
}

export function certifyTour(
  script: TourScript,
  ledger: CertificationLedger,
  env: GateEnvironment,
): GateResult {
  const entries = new Map(ledger.map((e) => [e.featureId, e] as const));
  const byId = new Map(script.scenes.map((s) => [s.sceneId, s] as const));
  const checks = new Map<SceneId, Check>();
  const checkOf = (scene: SceneScript): Check => {
    const known = checks.get(scene.sceneId);
    if (known !== undefined) return known;
    const check = checkScene(scene, script, entries, env);
    checks.set(scene.sceneId, check);
    return check;
  };

  /** The first passing scene along the fallback chain (cycle-safe). */
  const replacementFor = (scene: SceneScript): SceneScript | null => {
    const seen = new Set<SceneId>([scene.sceneId]);
    let next = scene.fallbackSceneId;
    while (next !== null && !seen.has(next)) {
      seen.add(next);
      const candidate = byId.get(next);
      if (candidate === undefined) return null;
      if (checkOf(candidate).reasons.length === 0) return candidate;
      next = candidate.fallbackSceneId;
    }
    return null;
  };

  const decisions: SceneDecision[] = [];
  const rejectedLines: RejectedLine[] = [];
  const resolved = new Map<SceneId, SceneScript | null>();
  for (const scene of script.scenes) {
    const check = checkOf(scene);
    rejectedLines.push(...check.rejectedLines);
    if (check.reasons.length === 0) {
      decisions.push({ sceneId: scene.sceneId, verdict: "ADMITTED", reasons: [] });
      resolved.set(scene.sceneId, scene);
      continue;
    }
    const replacement = replacementFor(scene);
    if (replacement !== null) {
      decisions.push({
        sceneId: scene.sceneId,
        verdict: "REPLACED",
        replacedBy: replacement.sceneId,
        reasons: check.reasons,
      });
      resolved.set(scene.sceneId, replacement);
    } else {
      decisions.push({
        sceneId: scene.sceneId,
        verdict: "SUPPRESSED",
        reasons:
          scene.fallbackSceneId === null
            ? check.reasons
            : [...check.reasons, "FALLBACK_UNAVAILABLE"],
      });
      resolved.set(scene.sceneId, null);
    }
  }

  // Tour order follows the chapters; a scene appears once, even when it
  // also stands in for another.
  const placed = new Set<SceneId>();
  const scenes: SceneScript[] = [];
  const chapters: Chapter[] = [];
  for (const chapter of script.chapters) {
    const sceneIds: SceneId[] = [];
    for (const id of chapter.sceneIds) {
      const scene = resolved.get(id) ?? null;
      if (scene === null || placed.has(scene.sceneId)) continue;
      placed.add(scene.sceneId);
      scenes.push(scene);
      sceneIds.push(scene.sceneId);
    }
    if (sceneIds.length > 0) chapters.push({ ...chapter, sceneIds });
  }
  return { scenes, chapters, decisions, rejectedLines };
}
