import type {
  CompanyDto,
  DiscoveredCompanyDto,
  MediaAssetDto,
} from "@capital-q/contracts";
import { formatDay } from "@/components/date-format";

/**
 * The founder's pitch history, read into rows (VID).
 *
 * Pure: every sentence comes from the server's record and nothing else.
 * "Current" and "published" are derived, never stored on the client:
 *
 *   current    not withdrawn, and no other version names it as the one it
 *              replaced (the database keeps lineage a chain, one successor
 *              per predecessor, so this is exact);
 *   published  current, READY, allowed by review, and investors may be
 *              granted playback. Whether the company itself is visible to
 *              the network is a separate question the page answers
 *              separately; a published pitch on a private profile still
 *              reaches nobody.
 */

export type PitchVersionPhase =
  "WAITING" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "WITHDRAWN";

export type PitchVersionRow = {
  readonly pitch: MediaAssetDto;
  readonly phase: PitchVersionPhase;
  /** The words for `phase`, never colour alone. */
  readonly phaseLabel: string;
  readonly isCurrent: boolean;
  readonly isPublished: boolean;
  /** One line on where the version stands with investors. */
  readonly standing: string;
  readonly captions: string;
  readonly duration: string | null;
  readonly uploadedOn: string;
  /** A poster and a preview need a READY, not-withdrawn version. */
  readonly previewable: boolean;
  readonly withdrawable: boolean;
};

export function phaseOf(pitch: MediaAssetDto): PitchVersionPhase {
  switch (pitch.status) {
    case "CREATED":
      return "WAITING";
    case "UPLOAD_PENDING":
    case "UPLOADING":
      return "UPLOADING";
    case "PROCESSING":
      return "PROCESSING";
    case "READY":
      return "READY";
    case "UPLOAD_FAILED":
    case "PROCESSING_FAILED":
    case "EXPIRED":
      return "FAILED";
    case "DELETED":
      return "WITHDRAWN";
  }
}

const PHASE_LABEL: Readonly<Record<PitchVersionPhase, string>> = {
  WAITING: "Waiting for a video",
  UPLOADING: "Uploading",
  PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Couldn't process",
  WITHDRAWN: "Withdrawn",
};

export function formatPitchDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0
    ? `${String(rest)}s`
    : `${String(minutes)}m ${String(rest).padStart(2, "0")}s`;
}

const dayOf = formatDay;

function captionsOf(pitch: MediaAssetDto): string {
  switch (pitch.captionState) {
    case "AVAILABLE":
      return "Captions available";
    case "PENDING":
      return "Captions in progress";
    case "FAILED":
      return "Captions couldn't be made";
    case "NOT_REQUESTED":
      return "No captions yet";
  }
}

function standingOf(
  pitch: MediaAssetDto,
  isCurrent: boolean,
  isPublished: boolean,
): string {
  if (pitch.status === "DELETED") return "Withdrawn. Nobody can play it.";
  if (!isCurrent) return "Replaced. Investors no longer see it.";
  if (isPublished) return "Published. Investors who can see you may play it.";
  if (pitch.status !== "READY") return "Not published yet.";
  if (pitch.playbackPolicy === "PRIVATE") {
    return "Private. Only your organisation can play it.";
  }
  if (pitch.moderationStatus === "BLOCKED") {
    return "Held by Capital Q review. Investors can't play it.";
  }
  return "Waiting for Capital Q review before investors can play it.";
}

export function toPitchVersionRows(
  media: readonly MediaAssetDto[],
): readonly PitchVersionRow[] {
  const replaced = new Set(
    media
      .map((pitch) => pitch.replacesMediaAssetId)
      .filter((id): id is string => id !== null),
  );
  const newestFirst = [...media].sort((a, b) =>
    a.createdAt === b.createdAt
      ? b.mediaAssetId.localeCompare(a.mediaAssetId)
      : b.createdAt.localeCompare(a.createdAt),
  );
  return newestFirst.map((pitch) => {
    const phase = phaseOf(pitch);
    const isCurrent =
      pitch.status !== "DELETED" && !replaced.has(pitch.mediaAssetId);
    const isPublished =
      isCurrent &&
      pitch.status === "READY" &&
      pitch.moderationStatus === "ALLOWED" &&
      pitch.playbackPolicy !== "PRIVATE";
    // An upload still in flight on a version that was since replaced will
    // never finish: the record keeps its last honest state, and the words
    // say what that means rather than "Uploading" forever.
    const abandoned =
      !isCurrent &&
      (phase === "WAITING" || phase === "UPLOADING" || phase === "PROCESSING");
    return {
      pitch,
      phase,
      phaseLabel: abandoned ? "Upload not completed" : PHASE_LABEL[phase],
      isCurrent,
      isPublished,
      standing: standingOf(pitch, isCurrent, isPublished),
      captions: captionsOf(pitch),
      duration: formatPitchDuration(pitch.durationSeconds),
      uploadedOn: dayOf(pitch.createdAt),
      previewable: phase === "READY",
      withdrawable: phase !== "WITHDRAWN",
    };
  });
}

/**
 * The feed's view of this company and one of its pitch versions, for the
 * player it shares with Discover: the preview is authorised by the same
 * signed playback route an investor's player uses, never a shortcut.
 */
export function asDiscovered(
  company: CompanyDto,
  pitch: MediaAssetDto,
): DiscoveredCompanyDto {
  return {
    companyId: company.id,
    canonicalName: company.canonicalName,
    websiteUrl: company.websiteUrl,
    headquartersCountry: company.headquartersCountry,
    currentStageCode: company.currentStageCode,
    shortDescription: company.shortDescription,
    reasons: [],
    reasonCodes: [],
    pitch: {
      mediaAssetId: pitch.mediaAssetId,
      aspectRatio: pitch.aspectRatio,
      durationSeconds: pitch.durationSeconds,
      captionState: pitch.captionState,
    },
  };
}
