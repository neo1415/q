import type {
  CompanyDto,
  MediaAssetDto,
  MediaUploadSessionDto,
  PitchGuidance,
} from "@capital-q/contracts";

/**
 * The founder's upload, as a pure state machine (CQ-WEB-023; doc 20 §9,
 * §14, §19; doc 17 §35).
 *
 * The server's lifecycle (CREATED → UPLOAD_PENDING → UPLOADING →
 * PROCESSING → READY, and the failure states) is the truth. What this
 * machine adds is the one thing the server cannot see: the bytes leaving
 * the browser, with progress. Every other transition here is a reaction to
 * what the server said, so a refresh at any point re-derives the same
 * screen from the same record.
 *
 * Nothing here talks to the network. The component drives it; the tests
 * assert it.
 */

export type PitchFailure =
  /** The provider rejected or lost the bytes. Replace the pitch. */
  | "UPLOAD_FAILED"
  /** The provider could not encode what arrived. Replace the pitch. */
  | "PROCESSING_FAILED"
  /** The one-time upload target lapsed before bytes arrived. Replace. */
  | "EXPIRED"
  /**
   * A target was reserved in another session and its one-time URL is
   * gone; the record says UPLOAD_PENDING and will say so forever. Replace.
   */
  | "TARGET_LOST"
  /** Something between here and the server; the pitch itself is unchanged. */
  | "REQUEST_FAILED";

export type PitchFlowState =
  /** Nothing to show yet: the overview has not loaded. */
  | { readonly kind: "LOADING" }
  /** No current pitch. A file can be chosen. */
  | { readonly kind: "EMPTY" }
  /**
   * A record exists but holds no bytes yet (CREATED). A file can be
   * chosen; the reservation happens against this record.
   */
  | { readonly kind: "CREATED"; readonly pitch: MediaAssetDto }
  /** Creating the record, then reserving the target. */
  | {
      readonly kind: "PREPARING";
      readonly file: ChosenFile;
      readonly pitch: MediaAssetDto | null;
    }
  /** Bytes are leaving the browser for the provider's one-time target. */
  | {
      readonly kind: "UPLOADING";
      readonly file: ChosenFile;
      readonly pitch: MediaAssetDto;
      readonly session: MediaUploadSessionDto;
      /** 0–1. */
      readonly progress: number;
    }
  /** Bytes arrived; the provider is encoding. Polling the server. */
  | {
      readonly kind: "PROCESSING";
      readonly pitch: MediaAssetDto;
      /** How many syncs have come back without READY. */
      readonly attempt: number;
      /** Whether this session sent the bytes (UPLOAD_PENDING is then transient). */
      readonly uploadedHere: boolean;
    }
  | { readonly kind: "READY"; readonly pitch: MediaAssetDto }
  | {
      readonly kind: "FAILED";
      readonly failure: PitchFailure;
      readonly message: string;
      /** The record the failure belongs to, when there is one to replace. */
      readonly pitch: MediaAssetDto | null;
    };

/** What the browser knows about the file before any byte moves. */
export type ChosenFile = {
  readonly name: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
};

export type PitchFlowEvent =
  | { readonly type: "LOADED"; readonly pitch: MediaAssetDto | null }
  | { readonly type: "FILE_CHOSEN"; readonly file: ChosenFile }
  | { readonly type: "CREATED"; readonly pitch: MediaAssetDto }
  | {
      readonly type: "RESERVED";
      readonly pitch: MediaAssetDto;
      readonly session: MediaUploadSessionDto;
    }
  | { readonly type: "UPLOAD_PROGRESS"; readonly progress: number }
  | { readonly type: "UPLOADED" }
  | { readonly type: "SYNCED"; readonly pitch: MediaAssetDto }
  | {
      readonly type: "REQUEST_FAILED";
      readonly message: string;
      readonly failure?: PitchFailure | undefined;
    };

export const INITIAL_PITCH_FLOW: PitchFlowState = { kind: "LOADING" };

/**
 * How many syncs may report UPLOAD_PENDING after this session finished
 * sending the bytes before the upload is called failed. The provider
 * normally moves off "pendingupload" within a few seconds of the POST
 * completing; a minute of nothing means the bytes did not land.
 */
export const PENDING_AFTER_UPLOAD_MAX_ATTEMPTS = 12;

const FAILURE_MESSAGE: Readonly<Record<PitchFailure, string>> = {
  UPLOAD_FAILED:
    "The upload didn't reach the video service. Choose the file again to replace this pitch.",
  PROCESSING_FAILED:
    "The video service couldn't process that file. A standard MP4 or WebM under three minutes works best. Choose a file to replace this pitch.",
  EXPIRED:
    "The upload window closed before the file arrived. Choose the file again to replace this pitch.",
  TARGET_LOST:
    "This upload was started elsewhere and can't be resumed here. Choose the file again to replace this pitch.",
  REQUEST_FAILED:
    "Capital Q couldn't complete that right now. Please try again.",
};

export function pitchFailureMessage(failure: PitchFailure): string {
  return FAILURE_MESSAGE[failure];
}

/** The server's lifecycle, read into the screen's state. */
function fromRecord(
  pitch: MediaAssetDto,
  context: { readonly uploadedHere: boolean; readonly attempt: number },
): PitchFlowState {
  switch (pitch.status) {
    case "CREATED":
      return { kind: "CREATED", pitch };
    case "UPLOAD_PENDING":
      // Bytes not seen by the provider yet. Transient right after this
      // session's upload; permanent for a target reserved elsewhere.
      if (!context.uploadedHere) {
        return failed("TARGET_LOST", pitch);
      }
      return context.attempt >= PENDING_AFTER_UPLOAD_MAX_ATTEMPTS
        ? failed("UPLOAD_FAILED", pitch)
        : {
            kind: "PROCESSING",
            pitch,
            attempt: context.attempt,
            uploadedHere: true,
          };
    case "UPLOADING":
    case "PROCESSING":
      return {
        kind: "PROCESSING",
        pitch,
        attempt: context.attempt,
        uploadedHere: context.uploadedHere,
      };
    case "READY":
      return { kind: "READY", pitch };
    case "UPLOAD_FAILED":
      return failed("UPLOAD_FAILED", pitch);
    case "PROCESSING_FAILED":
      return failed("PROCESSING_FAILED", pitch);
    case "EXPIRED":
      return failed("EXPIRED", pitch);
    case "DELETED":
      return { kind: "EMPTY" };
  }
}

function failed(
  failure: PitchFailure,
  pitch: MediaAssetDto | null,
  message: string = FAILURE_MESSAGE[failure],
): PitchFlowState {
  return { kind: "FAILED", failure, message, pitch };
}

/** The pitch a FAILED or READY state would be replacing, if any. */
export function replaceablePitch(state: PitchFlowState): MediaAssetDto | null {
  switch (state.kind) {
    case "READY":
    case "CREATED":
    case "FAILED":
      return state.pitch;
    case "LOADING":
    case "EMPTY":
    case "PREPARING":
    case "UPLOADING":
    case "PROCESSING":
      return null;
  }
}

export function pitchFlowReducer(
  state: PitchFlowState,
  event: PitchFlowEvent,
): PitchFlowState {
  switch (event.type) {
    case "LOADED":
      return event.pitch === null
        ? { kind: "EMPTY" }
        : fromRecord(event.pitch, { uploadedHere: false, attempt: 0 });

    case "FILE_CHOSEN": {
      // A file may be chosen from any resting state. From CREATED the
      // record is reused; from READY or FAILED the record is replaced.
      if (
        state.kind === "LOADING" ||
        state.kind === "PREPARING" ||
        state.kind === "UPLOADING" ||
        state.kind === "PROCESSING"
      ) {
        return state;
      }
      return {
        kind: "PREPARING",
        file: event.file,
        pitch: state.kind === "CREATED" ? state.pitch : null,
      };
    }

    case "CREATED":
      return state.kind === "PREPARING"
        ? { ...state, pitch: event.pitch }
        : state;

    case "RESERVED":
      return state.kind === "PREPARING"
        ? {
            kind: "UPLOADING",
            file: state.file,
            pitch: event.pitch,
            session: event.session,
            progress: 0,
          }
        : state;

    case "UPLOAD_PROGRESS":
      return state.kind === "UPLOADING"
        ? { ...state, progress: Math.max(0, Math.min(1, event.progress)) }
        : state;

    case "UPLOADED":
      return state.kind === "UPLOADING"
        ? {
            kind: "PROCESSING",
            pitch: state.pitch,
            attempt: 0,
            uploadedHere: true,
          }
        : state;

    case "SYNCED": {
      if (state.kind !== "PROCESSING") {
        // A sync answered for a state that no longer waits on one (the
        // founder replaced the pitch meanwhile). The record still rules,
        // but only when it is the same record.
        return state;
      }
      return fromRecord(event.pitch, {
        uploadedHere: state.uploadedHere,
        attempt: state.attempt + 1,
      });
    }

    case "REQUEST_FAILED": {
      const pitch =
        state.kind === "PREPARING" ||
        state.kind === "UPLOADING" ||
        state.kind === "PROCESSING" ||
        state.kind === "CREATED" ||
        state.kind === "READY"
          ? state.pitch
          : state.kind === "FAILED"
            ? state.pitch
            : null;
      const failure = event.failure ?? "REQUEST_FAILED";
      return failed(
        failure,
        pitch,
        failure === "REQUEST_FAILED" ? event.message : FAILURE_MESSAGE[failure],
      );
    }
  }
}

/**
 * The next poll, in milliseconds. Calm and bounded: quick at first, when
 * a short clip is usually done, then easing off so a long encode does not
 * hammer the server (doc 20: keep the founder's poll polite).
 */
export function syncDelayMs(attempt: number): number {
  const steps = [1_500, 2_500, 4_000, 6_000] as const;
  return steps[Math.min(attempt, steps.length - 1)] ?? 6_000;
}

/** How many polls before the screen stops asking and says so. */
export const SYNC_MAX_ATTEMPTS = 60;

/**
 * Bytes per second of pitch video the client refuses outright. Well above
 * any real pitch (a 4K phone clip is ~6 MB/s); the server's duration
 * allowance is the rule, this is a courtesy that saves a doomed upload.
 */
const MAX_BYTES_PER_SECOND = 8 * 1024 * 1024;

export type FileVerdict =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Courtesy checks before any byte moves. The server's policy is the rule
 * — the provider's duration reservation and its own limits apply whatever
 * is said here — so this refuses only what is certain to be refused.
 */
export function judgeFile(
  file: ChosenFile,
  guidance: PitchGuidance | null,
): FileVerdict {
  if (!file.mimeType.startsWith("video/")) {
    return {
      ok: false,
      message: "Choose a video file. MP4, WebM and MOV all work.",
    };
  }
  if (file.sizeBytes === 0) {
    return { ok: false, message: "That file is empty." };
  }
  const hardMax = guidance?.hardMaxSeconds ?? 180;
  if (file.sizeBytes > hardMax * MAX_BYTES_PER_SECOND) {
    return {
      ok: false,
      message: `That file is larger than a ${String(hardMax)}-second pitch could be. Trim it or export at a lower bitrate.`,
    };
  }
  return { ok: true };
}

/**
 * What the screen says about the pitch's place in the network, from the
 * company's own record. "Investors can now see your pitch" is said only
 * when every gate is actually open; otherwise the sentence names what is
 * still needed, in order, without inventing a state.
 */
export function describeNetworkStanding(
  company: Pick<
    CompanyDto,
    "marketplaceVisibility" | "marketplaceReadinessState" | "pitch"
  >,
  pitch: MediaAssetDto | null,
): { readonly visible: boolean; readonly sentence: string } {
  const networkVisible =
    company.marketplaceVisibility === "network_visible" ||
    company.marketplaceVisibility === "public_external";
  if (pitch === null || pitch.status !== "READY") {
    return {
      visible: false,
      sentence: "Investors will see your pitch once it is ready.",
    };
  }
  if (company.pitch !== null && networkVisible) {
    return { visible: true, sentence: "Investors can now see your pitch." };
  }
  const needed: string[] = [];
  if (pitch.moderationStatus !== "ALLOWED") {
    needed.push("a review of the video");
  }
  if (pitch.playbackPolicy === "PRIVATE") {
    needed.push("playback to be opened beyond your organisation");
  }
  if (!networkVisible) {
    needed.push("your company to be visible to the network");
  }
  if (needed.length === 0) {
    // The record says publishable but the projection has not caught up.
    return {
      visible: false,
      sentence: "Your pitch is ready. It will appear to investors shortly.",
    };
  }
  return {
    visible: false,
    sentence: `Your pitch is ready. Before investors see it, it needs ${listed(needed)}.`,
  };
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}
