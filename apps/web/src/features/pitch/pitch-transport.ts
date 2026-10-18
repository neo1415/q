import {
  authorisePitchPlayback,
  cancelPitchUpload,
  createPitchMediaAsset,
  createPitchUploadSession,
  deletePitchMediaAsset,
  getCompany,
  getCompanyPitch,
  listCompanyMedia,
  setPitchDetails,
  setPitchPlaybackPolicy,
  syncPitch,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  CompanyDto,
  CreateCompanyPitchResponse,
  MediaAssetDto,
  MediaUploadSessionDto,
  PitchAudience,
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

/**
 * Which video a screen is about (ADR 0022): the company's newest live one,
 * none yet (a new video being added), or one named video.
 */
export type PitchTarget = "CURRENT" | "NEW" | { readonly mediaAssetId: string };

export type PitchTransport = {
  readonly load: (
    companyId: string,
    target?: PitchTarget,
  ) => Promise<PitchOverview>;
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
  /** `POST …/details` — the owner's title and audience (ADR 0021/0022). */
  readonly setDetails: (
    companyId: string,
    mediaAssetId: string,
    details: {
      readonly title: string | null;
      readonly audience: PitchAudience;
      readonly playbackPolicy?: "AUTHORISED" | "PRIVATE" | undefined;
      /** ADR 0047: investors may also save a copy. Absent: unchanged. */
      readonly downloadable?: boolean | undefined;
    },
    expectedVersion: number,
  ) => Promise<MediaAssetDto>;
};

export function apiPitchTransport(session: ApiSession): PitchTransport {
  return {
    load: async (companyId, target = "CURRENT") => {
      if (target === "NEW") {
        return { company: await getCompany(session, companyId), pitch: null };
      }
      if (target === "CURRENT") {
        const [company, current] = await Promise.all([
          getCompany(session, companyId),
          getCompanyPitch(session, companyId),
        ]);
        return { company, pitch: current.pitch };
      }
      // One named video: the record itself, while it is still live. A
      // replaced or deleted video is no longer this screen's to show.
      const [company, media] = await Promise.all([
        getCompany(session, companyId),
        listCompanyMedia(session, companyId),
      ]);
      const pitch =
        media.media.find(
          (asset) => asset.mediaAssetId === target.mediaAssetId && asset.live,
        ) ?? null;
      return { company, pitch };
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
    setDetails: async (companyId, mediaAssetId, details, expectedVersion) =>
      (
        await setPitchDetails(session, companyId, mediaAssetId, {
          title: details.title,
          audience: details.audience,
          ...(details.playbackPolicy === undefined
            ? {}
            : { playbackPolicy: details.playbackPolicy }),
          ...(details.downloadable === undefined
            ? {}
            : { downloadable: details.downloadable }),
          expectedVersion,
        })
      ).pitch,
  };
}
