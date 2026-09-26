import type { ActorContext, TenantId } from "@capital-q/security";

import type { CaptionState, MediaAssetId } from "../contracts/index.js";
import { MediaAssetNotFoundError } from "../domain/errors.js";
import { cuesAround, parseWebVtt, type TimedCue } from "../domain/web-vtt.js";
import type { MediaServiceDependencies } from "./dependencies.js";
import { createResolvePlayableAsset } from "./upload-use-cases.js";

/**
 * A pitch's timed transcript (R18: "Q watches the video with us").
 *
 * The provider generates captions for a READY pitch; Capital Q stores them
 * once as the pitch's transcript and serves them to the player as a
 * <track> and to Q as "what was said at 1:42". The transcript is part of
 * the pitch: every read goes through the same rule that mints a playback
 * token (createResolvePlayableAsset), so anyone who may not watch the
 * video cannot read what is said in it, and gets the same not-found.
 *
 * No transcript is unknown, never empty speech: NONE and PENDING say so,
 * and nothing here turns absence into "they said nothing".
 */

/** One language for now; the provider supports several. */
export const PITCH_TRANSCRIPT_LANGUAGE = "en";

export type PitchTranscriptView =
  | {
      readonly status: "AVAILABLE";
      readonly mediaAssetId: MediaAssetId;
      readonly tenantId: TenantId;
      readonly language: string;
      readonly cues: readonly TimedCue[];
      readonly vtt: string;
    }
  | {
      readonly status: "PENDING" | "NONE";
      readonly mediaAssetId: MediaAssetId;
      readonly tenantId: TenantId;
    };

export type SyncPitchTranscriptOutcome =
  "AVAILABLE" | "PENDING" | "FAILED" | "NOT_READY" | "UNSUPPORTED";

/**
 * Advance one pitch's transcript by one step, under the platform's own
 * authority (no actor): read the provider's state, ask for captions when
 * none were asked for, store them when they are ready. Idempotent and
 * safe to call repeatedly. No transaction is held across a provider call.
 */
export function createSyncPitchTranscript(
  dependencies: MediaServiceDependencies,
) {
  const { repositories, videoProvider, transactions, sql } = dependencies;
  const setCaptionStates = async (
    tenantId: TenantId,
    mediaAssetId: MediaAssetId,
    state: CaptionState,
  ) =>
    transactions.run(async (tx) => {
      const locked = await repositories.mediaAssets.lockById(
        tx,
        tenantId,
        mediaAssetId,
      );
      if (
        locked === null ||
        (locked.captionState === state && locked.transcriptState === state)
      ) {
        return;
      }
      await repositories.mediaAssets.setStates(tx, {
        tenantId,
        mediaAssetId,
        expectedVersion: locked.version,
        captionState: state,
        transcriptState: state,
      });
    });

  return async (input: {
    readonly tenantId: TenantId;
    readonly mediaAssetId: MediaAssetId;
  }): Promise<SyncPitchTranscriptOutcome> => {
    const store = repositories.pitchTranscripts;
    const read = videoProvider.getGeneratedCaptions;
    const request = videoProvider.requestGeneratedCaptions;
    if (
      store === undefined ||
      read === undefined ||
      request === undefined ||
      !videoProvider.capabilities.captions
    ) {
      return "UNSUPPORTED";
    }
    const asset = await repositories.mediaAssets.findById(
      sql,
      input.tenantId,
      input.mediaAssetId,
    );
    if (
      asset === null ||
      asset.status !== "READY" ||
      asset.providerAssetId === null
    ) {
      return "NOT_READY";
    }
    if ((await store.find(sql, asset.tenantId, asset.id)) !== null) {
      return "AVAILABLE";
    }

    const language = PITCH_TRANSCRIPT_LANGUAGE;
    const captions = await read(asset.providerAssetId, language);
    if (captions.status === "NONE") {
      const status = await request(asset.providerAssetId, language);
      const state: CaptionState = status === "FAILED" ? "FAILED" : "PENDING";
      await setCaptionStates(asset.tenantId, asset.id, state);
      return state === "FAILED" ? "FAILED" : "PENDING";
    }
    if (captions.status !== "READY") {
      const state = captions.status === "FAILED" ? "FAILED" : "PENDING";
      await setCaptionStates(asset.tenantId, asset.id, state);
      return state;
    }

    const cues = parseWebVtt(captions.vtt);
    if (cues.length === 0) {
      // Nothing usable came back: record it as failed rather than store
      // an empty transcript that would read as silence.
      await setCaptionStates(asset.tenantId, asset.id, "FAILED");
      return "FAILED";
    }
    await transactions.run(async (tx) => {
      await store.insert(tx, {
        tenantId: asset.tenantId,
        mediaAssetId: asset.id,
        language,
        source: "PROVIDER_GENERATED",
        cues,
        vtt: captions.vtt,
      });
    });
    await setCaptionStates(asset.tenantId, asset.id, "AVAILABLE");
    return "AVAILABLE";
  };
}

/** The transcript of a pitch this actor may play; not-found otherwise. */
export function createGetPitchTranscript(
  dependencies: MediaServiceDependencies,
) {
  const playable = createResolvePlayableAsset(dependencies);
  const { repositories, sql } = dependencies;
  return async (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly mediaAssetId: MediaAssetId;
  }): Promise<PitchTranscriptView> => {
    const asset = await playable(query);
    const stored =
      repositories.pitchTranscripts === undefined
        ? null
        : await repositories.pitchTranscripts.find(
            sql,
            asset.tenantId,
            asset.id,
          );
    if (stored !== null) {
      return {
        status: "AVAILABLE",
        mediaAssetId: asset.id,
        tenantId: asset.tenantId,
        language: stored.language,
        cues: stored.cues,
        vtt: stored.vtt,
      };
    }
    return {
      status: asset.transcriptState === "PENDING" ? "PENDING" : "NONE",
      mediaAssetId: asset.id,
      tenantId: asset.tenantId,
    };
  };
}

/**
 * The same, named by the pitch alone (Q's get_pitch_moment): the owning
 * company is looked up, then the playback rule decides exactly as above.
 */
export function createGetPitchTranscriptByPitch(
  dependencies: MediaServiceDependencies,
) {
  const byCompany = createGetPitchTranscript(dependencies);
  return async (query: {
    readonly actor: ActorContext;
    readonly mediaAssetId: MediaAssetId;
  }): Promise<PitchTranscriptView & { readonly companyId: string }> => {
    const store = dependencies.repositories.pitchTranscripts;
    const companyId =
      store === undefined
        ? null
        : await store.findOwnerCompany(dependencies.sql, query.mediaAssetId);
    if (companyId === null) throw new MediaAssetNotFoundError();
    const view = await byCompany({ ...query, companyId });
    return { ...view, companyId };
  };
}

export { cuesAround };
