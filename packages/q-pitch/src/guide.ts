import { z } from "zod";

import {
  SceneIdSchema,
  TourActorSchema,
  type SceneId,
  type TourActor,
} from "./scene-evidence.js";
import { ChapterIdSchema, type SceneLine } from "./script.js";
import {
  TourActionResultSchema,
  TourFailureCodeSchema,
  type TourAction,
  type TourActionId,
  type TourFailureCode,
} from "./tour-action.js";

/**
 * Guide states and events (blueprint §5 "Guide state", §7 interruption).
 *
 *   PREPARE_SCENE → READY → SPEAK_AND_ACT → ACKNOWLEDGE → CHECKPOINT → ADVANCE
 *   plus PAUSED, INTERRUPTED, RESUME, SAFE_FALLBACK and COMPLETE.
 *
 * Events arrive from the host (the browser shell, the voice line, the
 * person's controls) and are parsed at that boundary; effects are what
 * the director asks the host to do. The director never performs anything
 * itself.
 */
export const GUIDE_STATES = [
  "PREPARE_SCENE",
  "READY",
  "SPEAK_AND_ACT",
  "ACKNOWLEDGE",
  "CHECKPOINT",
  "ADVANCE",
  "PAUSED",
  "INTERRUPTED",
  "RESUME",
  "SAFE_FALLBACK",
  "COMPLETE",
] as const;
export const GuideStateSchema = z.enum(GUIDE_STATES);
export type GuideState = z.infer<typeof GuideStateSchema>;

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u);
const DispatchIdSchema = z.string().regex(/^ta_[a-z0-9_-]{3,63}#[0-9]{1,6}$/u);

/**
 * The bounded, story-specific evidence capsule for one scene (blueprint
 * §5 "Scene preload", §9): authorised citations for the CURRENT actor only.
 * Ids, never content; it is cleared on a role switch.
 */
export const SceneCapsuleSchema = z
  .object({
    sceneId: SceneIdSchema,
    actor: TourActorSchema,
    sourceIds: z.array(OpaqueIdSchema).max(64),
    resourceIds: z.array(OpaqueIdSchema).max(64),
  })
  .strict();
export type SceneCapsule = z.infer<typeof SceneCapsuleSchema>;

export const GuideEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SCENE_PREPARED"),
      sceneId: SceneIdSchema,
      capsule: SceneCapsuleSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("SCENE_PREPARE_FAILED"),
      sceneId: SceneIdSchema,
      failureCode: TourFailureCodeSchema,
    })
    .strict(),
  z.object({ type: z.literal("BEGIN") }).strict(),
  z
    .object({
      type: z.literal("ACTION_RESULT"),
      result: TourActionResultSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("ACK_TIMEOUT"), dispatchId: DispatchIdSchema })
    .strict(),
  /** The narration queued after an acknowledgement has finished. */
  z.object({ type: z.literal("SPEECH_DONE") }).strict(),
  /** Move on from a checkpoint (the person, or the premiere's own pace). */
  z.object({ type: z.literal("CONTINUE") }).strict(),
  z.object({ type: z.literal("PAUSE") }).strict(),
  /** The person spoke or typed over the tour. */
  z.object({ type: z.literal("INTERRUPT") }).strict(),
  /** Whether a dispatched action completed after all (§7 step 3). */
  z
    .object({
      type: z.literal("DISPATCH_RESOLVED"),
      dispatchId: DispatchIdSchema,
      completed: z.boolean(),
    })
    .strict(),
  /** `routeIntact`: the screen is still where the cursor expects. */
  z.object({ type: z.literal("RESUME"), routeIntact: z.boolean() }).strict(),
  z.object({ type: z.literal("GO_BACK") }).strict(),
  /** Leave this scene for the next one (blueprint §3 controls: skip). */
  z.object({ type: z.literal("SKIP") }).strict(),
  /** "Show me that again": replay the scene just shown, from its start. */
  z.object({ type: z.literal("REPEAT") }).strict(),
  z
    .object({ type: z.literal("JUMP_TO_CHAPTER"), chapterId: ChapterIdSchema })
    .strict(),
  /**
   * Q Pitch v6 step commands ("go to step 7", "back two", "forward three"):
   * the scene at this 0-based index, resolved by the control layer from
   * the current one. Out of range is refused, never clamped.
   */
  z
    .object({
      type: z.literal("GO_TO_STEP"),
      index: z.number().int().min(0).max(199),
    })
    .strict(),
  /** The server switched the authorised workspace (QP-F10); never a UI toggle. */
  z
    .object({ type: z.literal("ROLE_SWITCHED"), actor: TourActorSchema })
    .strict(),
  z.object({ type: z.literal("FALLBACK_DONE") }).strict(),
]);
export type GuideEvent = z.infer<typeof GuideEventSchema>;
export type GuideEventType = GuideEvent["type"];

export const REJECTION_REASONS = [
  /** The event does not apply in this state. */
  "NOT_IN_THIS_STATE",
  /** CONTINUE before the scene was acknowledged. */
  "NOT_ACKNOWLEDGED",
  /** A result or resolution for a dispatch that is no longer current. */
  "STALE_DISPATCH",
  /** A prepared scene that is not the one being prepared. */
  "STALE_SCENE",
  "NO_VALID_SCENE",
  "CHAPTER_UNAVAILABLE",
  "SAME_ACTOR",
  /** A step number the tour does not have. */
  "STEP_OUT_OF_RANGE",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** What the director asks the host to do; performed in order. */
export type GuideEffect =
  | {
      readonly type: "PREPARE";
      readonly sceneId: SceneId;
      readonly actor: TourActor;
      /** The next scenes to warm (blueprint §5: the next two). */
      readonly prefetch: readonly SceneId[];
    }
  | { readonly type: "SPEAK"; readonly lines: readonly SceneLine[] }
  | {
      readonly type: "DISPATCH";
      readonly dispatchId: string;
      readonly action: TourAction;
      readonly deadlineMs: number;
    }
  | { readonly type: "CANCEL_SPEECH" }
  | {
      readonly type: "CANCEL_QUEUED";
      readonly actionIds: readonly TourActionId[];
    }
  | { readonly type: "RESOLVE_DISPATCHED"; readonly dispatchId: string }
  | { readonly type: "CLEAR_SCOPED"; readonly actor: TourActor }
  | { readonly type: "CHECKPOINT_REACHED"; readonly cursor: SceneCursor }
  | {
      readonly type: "FALLBACK";
      readonly sceneId: SceneId;
      readonly failureCode: TourFailureCode | "ACTOR_MISMATCH";
    }
  | {
      readonly type: "REJECTED";
      readonly event: GuideEventType;
      readonly reason: RejectionReason;
    }
  | { readonly type: "COMPLETED" };

/** Where the tour is: the resume point (§7 step 4). */
export type SceneCursor = {
  readonly sceneIndex: number;
  readonly sceneId: SceneId;
  readonly chapterId: string;
  /** Actions of the scene already acknowledged. */
  readonly actionIndex: number;
  readonly expectedRoute: string;
};
