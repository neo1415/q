import {
  authorisePitchPlayback,
  createPitchMediaAsset,
  createPitchUploadSession,
  getCompany,
  getCompanyPitch,
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
  /** `POST /pitch` — a record in state CREATED, replacing one by naming it. */
  readonly create: (
    companyId: string,
    replacesMediaAssetId: string | null,
  ) => Promise<CreateCompanyPitchResponse>;
  /** `POST …/upload-session` — the one-time target, against the version seen. */
  readonly reserve: (
    companyId: string,
    mediaAssetId: string,
    expectedVersion: number,
  ) => Promise<MediaUploadSessionDto>;
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
    create: (companyId, replacesMediaAssetId) =>
      createPitchMediaAsset(
        session,
        companyId,
        replacesMediaAssetId === null ? {} : { replacesMediaAssetId },
      ),
    reserve: (companyId, mediaAssetId, expectedVersion) =>
      createPitchUploadSession(session, companyId, mediaAssetId, {
        expectedVersion,
      }),
    sync: async (companyId, mediaAssetId) =>
      (await syncPitch(session, companyId, mediaAssetId)).pitch,
    authorise: (companyId, mediaAssetId) =>
      authorisePitchPlayback(session, companyId, mediaAssetId),
  };
}
