import {
  authorisePitchPlayback,
  cancelPitchUpload,
  createPitchMediaAsset,
  createPitchUploadSession,
  deletePitchMediaAsset,
  getCompany,
  getCompanyPitch,
  listCompanyMedia,
  setPitchPlaybackPolicy,
  syncPitch,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  CompanyDto,
  CreateCompanyPitchResponse,
  MediaAssetDto,
  MediaUploadSessionDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";

/**
 * The pitch flow on the wire (CQ-WEB-023).
 *
 * One port, resolved to the typed API client. The server actions bind it
 * to the person's own session; the tests bind it to a fetch double. Every
 * write below is one the API already owns: nothing here invents a body
 * field, and the two things a browser must never hold — a provider
 * identifier and a token — are absent from every answer by contract.
 */

export type PitchOverview = {
  readonly company: CompanyDto;
  readonly pitch: MediaAssetDto | null;
};

export type PitchTransport = {
  readonly load: (companyId: string) => Promise<PitchOverview>;
  /**
   * `POST /pitch` — a record in state CREATED, replacing one by naming it,
   * under the key that makes a retry return the same record.
   */
  readonly create: (
    companyId: string,
    replacesMediaAssetId: string | null,
    idempotencyKey: string,
  ) => Promise<CreateCompanyPitchResponse>;
  /** `GET /media` — every version, newest first, superseded and deleted included. */
  readonly list: (companyId: string) => Promise<readonly MediaAssetDto[]>;
  /** `DELETE /pitch/:id` — withdraw one version; the record is kept. */
  readonly remove: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<MediaAssetDto>;
  /**
   * `POST …/upload-session` — the target, against the version seen. With
   * `resumable` the server may issue a resumable target, and the same key
   * and length again return the same open one.
   */
  readonly reserve: (
    companyId: string,
    mediaAssetId: string,
    expectedVersion: number,
    resumable?: {
      readonly uploadLengthBytes: number;
      readonly idempotencyKey: string;
    },
  ) => Promise<MediaUploadSessionDto>;
  /** `POST …/upload-session/cancel` — stop an unfinished upload. */
  readonly cancel: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<MediaAssetDto>;
  /** `POST …/sync` — where the bytes stand, as the server now records it. */
  readonly sync: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<MediaAssetDto>;
  /** `POST …/playback` — the founder's own short-lived preview grant. */
  readonly authorise: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<PlaybackAuthorizationDto>;
  /** `POST …/playback-policy` — the founder's decision on investor playback. */
  readonly setPlaybackPolicy: (
    companyId: string,
    mediaAssetId: string,
    playbackPolicy: "AUTHORISED" | "PRIVATE",
    expectedVersion: number,
  ) => Promise<MediaAssetDto>;
};

export function apiPitchTransport(session: ApiSession): PitchTransport {
  return {
    load: async (companyId) => {
      const [company, current] = await Promise.all([
        getCompany(session, companyId),
        getCompanyPitch(session, companyId),
      ]);
      return { company, pitch: current.pitch };
    },
    create: (companyId, replacesMediaAssetId, idempotencyKey) =>
      createPitchMediaAsset(
        session,
        companyId,
        replacesMediaAssetId === null ? {} : { replacesMediaAssetId },
        idempotencyKey,
      ),
    list: async (companyId) =>
      (await listCompanyMedia(session, companyId)).media,
    remove: async (companyId, mediaAssetId) => {
      const answer = await deletePitchMediaAsset(
        session,
        companyId,
        mediaAssetId,
      );
      if (answer.pitch === null) {
        throw new Error("The server answered a deletion without the record.");
      }
      return answer.pitch;
    },
    reserve: (companyId, mediaAssetId, expectedVersion, resumable) =>
      resumable === undefined
        ? createPitchUploadSession(session, companyId, mediaAssetId, {
            expectedVersion,
          })
        : createPitchUploadSession(
            session,
            companyId,
            mediaAssetId,
            {
              expectedVersion,
              uploadLengthBytes: resumable.uploadLengthBytes,
            },
            resumable.idempotencyKey,
          ),
    cancel: async (companyId, mediaAssetId) =>
      (await cancelPitchUpload(session, companyId, mediaAssetId)).pitch,
    sync: async (companyId, mediaAssetId) =>
      (await syncPitch(session, companyId, mediaAssetId)).pitch,
    authorise: (companyId, mediaAssetId) =>
      authorisePitchPlayback(session, companyId, mediaAssetId),
    setPlaybackPolicy: async (
      companyId,
      mediaAssetId,
      playbackPolicy,
      expectedVersion,
    ) =>
      (
        await setPitchPlaybackPolicy(session, companyId, mediaAssetId, {
          playbackPolicy,
          expectedVersion,
        })
      ).pitch,
  };
}
