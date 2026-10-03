"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";

import type {
  MarketplaceReadinessAssessment,
  CompanyDto,
  MediaAssetDto,
  PitchGuidance,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Check, Eye, ICON_SIZE, Upload } from "@capital-q/ui/icons";
import { InlineNotice, Progress, Skeleton } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { PitchPlayer } from "@/features/discover/player/pitch-player";
import { prefersReducedMotion } from "@/features/discover/player/use-pitch-playback";

import {
  authorisePitchPlaybackAction,
  cancelUploadAction,
  createPitchAction,
  createUploadSessionAction,
  loadPitchOverviewAction,
  setPitchPlaybackPolicyAction,
  syncPitchAction,
} from "./pitch-actions";
import { asDiscovered } from "./pitch-library-state";
import {
  awaitingReview,
  describeNetworkStanding,
  INITIAL_PITCH_FLOW,
  judgeFile,
  pitchFlowReducer,
  replaceablePitch,
  REVIEW_MAX_ATTEMPTS,
  SYNC_MAX_ATTEMPTS,
  syncDelayMs,
  type ChosenFile,
  type PitchFlowState,
} from "./pitch-state";
import { PitchDetails } from "./pitch-details";
import {
  assessMarketplaceReadinessAction,
  loadMarketplaceReadinessAction,
} from "../company/visibility-actions";
import { uploadResumable } from "./resumable-upload";
import {
  clearResume,
  isSameFile,
  loadResume,
  saveResume,
  type ResumeRecord,
} from "./resume-store";
import { uploadBytes, type UploadOutcome } from "./upload-bytes";

/**
 * The founder's pitch upload (CQ-WEB-023, CQ-MEDIA-011; doc 17 §35; doc
 * 20 §9–§14).
 *
 * One file control, one honest status line, and a preview when there is
 * something to preview. The bytes go from this browser to the provider's
 * target and nowhere else; every other step is a server action under the
 * founder's own session, and the screen only ever repeats what the
 * server's record says. Nothing here spins for effect: while the provider
 * encodes, the line says so and the page polls politely.
 *
 * Uploads are resumable when the server says so. A dropped connection is
 * retried quietly ("Reconnecting"); one that stays down pauses the upload
 * with a Resume button; a reload offers to carry on once the same file is
 * chosen again. Cancel stops the bytes and has the server record it.
 */

export type PitchUploadProps = {
  readonly companyId: string;
  /**
   * Told whenever the record this screen shows changes (a new version, a
   * status, a decision), so the history beside it can re-read the server.
   */
  readonly onRecordChanged?: (() => void) | undefined;
  /** Pause this screen's preview while another player on the page plays. */
  readonly holdPreview?: boolean | undefined;
  /**
   * Which video this screen is about (ADR 0022): absent, the company's
   * newest live one; null, a new video added beside the others; an id,
   * that video.
   */
  readonly mediaAssetId?: string | null | undefined;
  /** Told once a new video's record exists, with its id. */
  readonly onCreated?: ((mediaAssetId: string) => void) | undefined;
  /** Told once this video was deleted; absent, deleting is not offered. */
  readonly onDeleted?: (() => void) | undefined;
};

/**
 * The preview's answer, remembered against the asset it was asked for. A
 * different asset (a replacement) reads as unknown without any reset: the
 * key does the forgetting, so no effect has to.
 */
type Preview =
  | {
      readonly kind: "AVAILABLE";
      readonly mediaAssetId: string;
      readonly first: PlaybackAuthorizationDto;
    }
  | {
      readonly kind: "UNAVAILABLE";
      readonly mediaAssetId: string;
      readonly reason: string;
    };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !("matchMedia" in window)) {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function chosen(file: File): ChosenFile {
  return { name: file.name, sizeBytes: file.size, mimeType: file.type };
}

function remembered(record: ResumeRecord): ChosenFile {
  return {
    name: record.name,
    sizeBytes: record.sizeBytes,
    mimeType: record.mimeType,
  };
}

/** One key per intended reservation; reused, never regenerated, on retry. */
function newIdempotencyKey(): string {
  return `pitch-upload-${crypto.randomUUID()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0
    ? `${String(rest)}s`
    : `${String(minutes)}m ${String(rest).padStart(2, "0")}s`;
}

export function PitchUpload({
  companyId,
  onRecordChanged,
  holdPreview = false,
  mediaAssetId: targetAssetId,
  onCreated,
  onDeleted,
}: PitchUploadProps) {
  const [flow, dispatch] = useReducer(pitchFlowReducer, INITIAL_PITCH_FLOW);
  const [company, setCompany] = useState<CompanyDto | null>(null);
  // What stands between the company and investor feeds (PADL #58), read
  // only when the pitch is visible but the company is not recommended.
  const [readiness, setReadiness] =
    useState<MarketplaceReadinessAssessment | null>(null);
  const [checking, setChecking] = useState(false);
  const [guidance, setGuidance] = useState<PitchGuidance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  // The file being sent, kept so a paused upload can resume without the
  // founder choosing it again. Lost on reload, as browsers intend.
  const currentFile = useRef<File | null>(null);
  // The OS preference, read as an external store: the server renders
  // "not reduced" and the client corrects it on hydration without a
  // state update of its own.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );

  // Visible but not in feeds: read why, once per change of the record.
  const notRecommended =
    company !== null &&
    company.pitch !== null &&
    company.marketplaceReadinessState !== "marketplace_ready";
  useEffect(() => {
    if (!notRecommended) return;
    let cancelled = false;
    void loadMarketplaceReadinessAction(companyId).then((result) => {
      if (!cancelled && result.ok) setReadiness(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [notRecommended, companyId]);

  /** After fixing something: the policy assesses again, nothing is chosen. */
  const checkAgain = async () => {
    setChecking(true);
    const assessed = await assessMarketplaceReadinessAction(companyId);
    if (assessed.ok) setReadiness(assessed.value);
    const overview = await loadPitchOverviewAction(companyId, targetAssetId);
    if (overview.ok) setCompany(overview.value.company);
    setChecking(false);
  };

  // The overview, on mount and whenever the company changes. State is
  // set only in the callback, once the server has answered.
  useEffect(() => {
    let cancelled = false;
    void loadPitchOverviewAction(companyId, targetAssetId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setLoadError(null);
      setCompany(result.value.company);
      const current = result.value.pitch;
      const record =
        current?.status === "UPLOAD_PENDING"
          ? loadResume(current.mediaAssetId)
          : null;
      dispatch({
        type: "LOADED",
        pitch: current,
        resumable: record === null ? null : remembered(record),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, targetAssetId]);

  // Polite polling while the provider works. The delay grows with each
  // answer that is not yet READY, and the loop stops on any resting state
  // or when the page gives up asking.
  useEffect(() => {
    if (flow.kind !== "PROCESSING") return;
    const { attempt } = flow;
    const mediaAssetId = flow.pitch.mediaAssetId;
    const timer = setTimeout(() => {
      if (attempt >= SYNC_MAX_ATTEMPTS) {
        dispatch({
          type: "REQUEST_FAILED",
          message:
            "The video service is taking longer than expected. Reload this page later to check again.",
        });
        return;
      }
      void syncPitchAction(companyId, mediaAssetId).then((result) => {
        if (result.ok) dispatch({ type: "SYNCED", pitch: result.value });
        else dispatch({ type: "REQUEST_FAILED", message: result.message });
      });
    }, syncDelayMs(attempt));
    return () => clearTimeout(timer);
  }, [companyId, flow]);

  // READY is not where the record stops moving: the platform's review
  // follows and changes the version. Until it has, keep reading, so the
  // founder decides against the record as it is (CQ-MLV-003). Bounded:
  // with no reviewer running the version does not move, and the decision
  // works on what the screen already holds.
  const reviewAssetId = awaitingReview(flow)?.mediaAssetId ?? null;
  useEffect(() => {
    if (reviewAssetId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (attempt: number) => {
      timer = setTimeout(() => {
        void loadPitchOverviewAction(companyId, reviewAssetId).then(
          (result) => {
            if (cancelled) return;
            const current = result.ok ? result.value.pitch : null;
            if (
              result.ok &&
              current !== null &&
              current.mediaAssetId === reviewAssetId &&
              current.moderationStatus !== "NOT_REVIEWED"
            ) {
              setCompany(result.value.company);
              dispatch({ type: "PITCH_UPDATED", pitch: current });
              return;
            }
            if (attempt + 1 < REVIEW_MAX_ATTEMPTS) ask(attempt + 1);
          },
        );
      }, syncDelayMs(attempt));
    };
    ask(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [companyId, reviewAssetId]);

  // Once READY, the company's own record decides what the screen may say
  // about investors, and the preview asks the server for a grant once —
  // rendering the player only when there is a real one. A replacement
  // pitch has a new id, so the remembered answer no longer applies to it.
  const readyAssetId = flow.kind === "READY" ? flow.pitch.mediaAssetId : null;
  useEffect(() => {
    if (readyAssetId === null) return;
    let cancelled = false;
    void loadPitchOverviewAction(companyId, readyAssetId).then((result) => {
      if (!cancelled && result.ok) setCompany(result.value.company);
    });
    void authorisePitchPlaybackAction(companyId, readyAssetId).then(
      (result) => {
        if (cancelled) return;
        setPreview(
          result.ok
            ? {
                kind: "AVAILABLE",
                mediaAssetId: readyAssetId,
                first: result.value,
              }
            : {
                kind: "UNAVAILABLE",
                mediaAssetId: readyAssetId,
                reason: result.message,
              },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [companyId, readyAssetId]);

  const authorize = useCallback(
    async (mediaAssetId: string) => {
      const result = await authorisePitchPlaybackAction(
        companyId,
        mediaAssetId,
      );
      if (!result.ok) {
        setPreview({
          kind: "UNAVAILABLE",
          mediaAssetId,
          reason: result.message,
        });
        throw new Error(result.message);
      }
      return result.value;
    },
    [companyId],
  );

  // The founder's decision (CQ-MEDIA-013): one command, against the
  // version this screen saw, and the record re-read afterwards. Nothing
  // here decides discoverability; the standing line reports it.
  const decide = useCallback(
    async (pitch: MediaAssetDto, playbackPolicy: "AUTHORISED" | "PRIVATE") => {
      setDeciding(true);
      setDecisionNotice(null);
      const result = await setPitchPlaybackPolicyAction(
        companyId,
        pitch.mediaAssetId,
        playbackPolicy,
        pitch.version,
      );
      setDeciding(false);
      if (!result.ok) {
        setDecisionNotice(result.message);
        return;
      }
      dispatch({ type: "PITCH_UPDATED", pitch: result.value });
      const overview = await loadPitchOverviewAction(
        companyId,
        pitch.mediaAssetId,
      );
      if (overview.ok) setCompany(overview.value.company);
    },
    [companyId],
  );

  /**
   * Steps 2 and 3 for a record that exists: reserve (or re-obtain) the
   * target, then send the bytes. `resumeKey` is the key an earlier attempt
   * reserved with; the server answers it with that same open target.
   */
  const reserveAndSend = useCallback(
    async (file: File, record: MediaAssetDto, resumeKey: string | null) => {
      // 2. The target, against the version this screen saw. The key is
      //    remembered before asking, so an answer lost on the way back can
      //    still be asked for again — here, or after a reload.
      const idempotencyKey = resumeKey ?? newIdempotencyKey();
      saveResume(record.mediaAssetId, idempotencyKey, file);
      const reserved = await createUploadSessionAction(
        companyId,
        record.mediaAssetId,
        record.version,
        { uploadLengthBytes: file.size, idempotencyKey },
      );
      if (!reserved.ok) {
        dispatch({ type: "REQUEST_FAILED", message: reserved.message });
        return;
      }
      const session = reserved.value;
      dispatch({ type: "RESERVED", pitch: session.pitch, session });

      // 3. The bytes, browser → provider. Nothing of Capital Q's in between.
      currentFile.current = file;
      const controller = new AbortController();
      uploadAbort.current = controller;
      const onProgress = (progress: number) =>
        dispatch({ type: "UPLOAD_PROGRESS", progress });
      let outcome: UploadOutcome;
      if (session.uploadMode === "RESUMABLE") {
        outcome = await uploadResumable({
          uploadUrl: session.uploadUrl,
          file,
          chunkSizeBytes: session.chunkSizeBytes ?? file.size,
          signal: controller.signal,
          onProgress,
          onRetry: () => dispatch({ type: "UPLOAD_RETRYING" }),
          onRecovered: () => dispatch({ type: "UPLOAD_RECOVERED" }),
        });
      } else {
        // The server chose the one-shot target: nothing to resume later.
        clearResume(record.mediaAssetId);
        outcome = await uploadBytes({
          uploadUrl: session.uploadUrl,
          file,
          signal: controller.signal,
          onProgress,
        });
      }
      if (uploadAbort.current === controller) uploadAbort.current = null;

      switch (outcome.kind) {
        case "DONE":
          clearResume(record.mediaAssetId);
          dispatch({ type: "UPLOADED" });
          return;
        case "ABORTED":
          // Cancelled (the cancel path says so) or the page went away: the
          // record stays UPLOAD_PENDING and this browser still remembers
          // how to resume it.
          return;
        case "NETWORK":
          if (session.uploadMode === "RESUMABLE") {
            dispatch({ type: "UPLOAD_INTERRUPTED" });
            return;
          }
          break;
        case "REJECTED":
          // The provider refused the target itself (cancelled, lapsed, or
          // not this file's): there is nothing left to resume into.
          clearResume(record.mediaAssetId);
          break;
      }
      dispatch({
        type: "REQUEST_FAILED",
        message: "",
        failure: "UPLOAD_FAILED",
      });
    },
    [companyId],
  );

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file === undefined) return;
      const verdict = judgeFile(chosen(file), guidance);
      if (!verdict.ok) {
        setFileNotice(verdict.message);
        return;
      }

      // A paused upload carries on only with the file it was sending.
      if (flow.kind === "INTERRUPTED") {
        const saved = loadResume(flow.pitch.mediaAssetId);
        if (saved === null || !isSameFile(saved, file)) {
          setFileNotice(
            `That isn't the file that was uploading. Choose ${flow.file.name} to carry on, or cancel this upload.`,
          );
          return;
        }
        setFileNotice(null);
        dispatch({ type: "FILE_CHOSEN", file: chosen(file) });
        await reserveAndSend(file, flow.pitch, saved.idempotencyKey);
        return;
      }

      setFileNotice(null);
      const replaces = replaceablePitch(flow);
      const reuse = flow.kind === "CREATED" ? flow.pitch : null;
      // A reservation whose answer never arrived is asked for again with
      // the same key, so it resumes rather than being refused.
      const pending =
        flow.kind === "FAILED" &&
        flow.failure === "REQUEST_FAILED" &&
        flow.pitch !== null
          ? flow.pitch
          : null;
      const saved = pending === null ? null : loadResume(pending.mediaAssetId);
      dispatch({ type: "FILE_CHOSEN", file: chosen(file) });
      if (pending !== null && saved !== null && isSameFile(saved, file)) {
        await reserveAndSend(file, pending, saved.idempotencyKey);
        return;
      }

      // 1. The record. Reused when a CREATED one already exists; created,
      //    replacing the current pitch by name, otherwise.
      let record: MediaAssetDto | null = reuse;
      if (record === null) {
        const created = await createPitchAction(
          companyId,
          replaces === null || replaces.status === "CREATED"
            ? null
            : replaces.mediaAssetId,
          `pitch-create-${crypto.randomUUID()}`,
        );
        if (!created.ok) {
          dispatch({ type: "REQUEST_FAILED", message: created.message });
          return;
        }
        setGuidance(created.value.guidance);
        record = created.value.pitch;
        dispatch({ type: "CREATED", pitch: record });
        onCreated?.(record.mediaAssetId);
      }
      await reserveAndSend(file, record, null);
    },
    [companyId, flow, guidance, reserveAndSend, onCreated],
  );

  /** Carry on with the file still in memory, or ask for it again. */
  const resume = useCallback(async () => {
    if (flow.kind !== "INTERRUPTED") return;
    const file = currentFile.current;
    const saved = loadResume(flow.pitch.mediaAssetId);
    if (file === null || saved === null || !isSameFile(saved, file)) {
      fileInput.current?.click();
      return;
    }
    dispatch({ type: "FILE_CHOSEN", file: chosen(file) });
    await reserveAndSend(file, flow.pitch, saved.idempotencyKey);
  }, [flow, reserveAndSend]);

  /**
   * Stop the bytes, then have the server record it: the pitch ends
   * UPLOAD_FAILED and the provider lets go of its target, so nothing is
   * left pretending to upload.
   */
  const cancel = useCallback(
    async (pitch: MediaAssetDto) => {
      uploadAbort.current?.abort();
      uploadAbort.current = null;
      setCancelling(true);
      setFileNotice(null);
      const result = await cancelUploadAction(companyId, pitch.mediaAssetId);
      setCancelling(false);
      if (!result.ok) {
        dispatch({ type: "REQUEST_FAILED", message: result.message });
        return;
      }
      clearResume(pitch.mediaAssetId);
      currentFile.current = null;
      dispatch({ type: "CANCELLED", pitch: result.value });
    },
    [companyId],
  );

  useEffect(() => () => uploadAbort.current?.abort(), []);

  // One signature per record state the server holds; the history re-reads
  // when it moves, and not on every progress tick.
  const shown = "pitch" in flow ? flow.pitch : null;
  const signature =
    shown === null
      ? flow.kind
      : `${shown.mediaAssetId}:${shown.status}:${String(shown.version)}`;
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (flow.kind === "LOADING" || notified.current === signature) return;
    const first = notified.current === null;
    notified.current = signature;
    if (!first) onRecordChanged?.();
  }, [flow.kind, signature, onRecordChanged]);

  if (loadError !== null) {
    return (
      <InlineNotice tone="warning" title="Your pitch couldn't load">
        {loadError}
      </InlineNotice>
    );
  }
  if (flow.kind === "LOADING" || company === null) {
    return <Skeleton lines={3} />;
  }

  const busy =
    flow.kind === "PREPARING" ||
    flow.kind === "UPLOADING" ||
    flow.kind === "PROCESSING";
  const current =
    flow.kind === "READY" || flow.kind === "PROCESSING" ? flow.pitch : null;
  const standing = describeNetworkStanding(company, current, readiness);

  // Once there is a video to watch, the page reads like a short-video
  // editor: the video tall on the left, what to do with it on the right.
  const sideBySide = flow.kind === "READY";
  return (
    <div
      className={
        sideBySide
          ? "flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-x-10"
          : "flex flex-col gap-10"
      }
      data-pitch-editor={sideBySide ? "side-by-side" : "stacked"}
    >
      <PageSection
        id="pitch-status"
        className={sideBySide ? "lg:col-start-2 lg:row-start-1" : undefined}
        title="The video"
        description="Investors watch this first. Keep it to what you'd say across a table."
      >
        <section className="cq-panel">
          <header className="cq-panel-header">
            <h3 className="cq-title-sm text-(--cq-text-primary)">
              {shown?.title ?? company.canonicalName}
            </h3>
            <StatusLine flow={flow} />
          </header>
          <div className="cq-panel-body flex flex-col gap-4">
            {flow.kind === "UPLOADING" ? (
              <>
                <Progress
                  label={
                    flow.reconnecting
                      ? `Connection lost. Waiting to carry on with ${flow.file.name}`
                      : `Uploading ${flow.file.name} (${formatBytes(flow.file.sizeBytes)})`
                  }
                  value={Math.round(flow.progress * 100)}
                />
                <div>
                  <Button
                    variant="quiet"
                    disabled={cancelling}
                    onClick={() => void cancel(flow.pitch)}
                  >
                    Cancel upload
                  </Button>
                </div>
              </>
            ) : null}
            {flow.kind === "INTERRUPTED" ? (
              <InlineNotice
                tone="info"
                title="Upload paused"
                action={
                  <span className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="primary"
                      disabled={cancelling}
                      onClick={() => void resume()}
                    >
                      <Upload size={ICON_SIZE.regular} aria-hidden="true" />
                      {flow.reason === "CONNECTION"
                        ? "Resume upload"
                        : "Choose the same file"}
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={cancelling}
                      onClick={() => void cancel(flow.pitch)}
                    >
                      Cancel upload
                    </Button>
                  </span>
                }
              >
                {flow.reason === "CONNECTION"
                  ? `The connection dropped while sending ${flow.file.name}. What already arrived is kept; resume to carry on from there.`
                  : `${flow.file.name} was part-way up when this page closed. Choose the same file again to carry on from where it stopped.`}
              </InlineNotice>
            ) : null}
            {flow.kind === "PROCESSING" ? (
              <Progress label="The video service is preparing your pitch" />
            ) : null}
            {flow.kind === "FAILED" ? (
              <InlineNotice
                tone={flow.failure === "CANCELLED" ? "info" : "warning"}
                title={
                  flow.failure === "CANCELLED"
                    ? "Upload cancelled"
                    : "This pitch didn't make it"
                }
                action={
                  flow.failure === "TARGET_LOST" && flow.pitch !== null ? (
                    <Button
                      variant="quiet"
                      disabled={cancelling}
                      onClick={() => {
                        if (flow.pitch !== null) void cancel(flow.pitch);
                      }}
                    >
                      Cancel that upload
                    </Button>
                  ) : undefined
                }
              >
                {flow.message}
              </InlineNotice>
            ) : null}
            {fileNotice !== null ? (
              <InlineNotice tone="info">{fileNotice}</InlineNotice>
            ) : null}
            {flow.kind === "READY" ? (
              <dl className="cq-panel-rows">
                <div className="flex justify-between gap-4 py-3">
                  <dt className="cq-label text-(--cq-text-secondary)">
                    Length
                  </dt>
                  <dd className="cq-body cq-numeric">
                    {formatDuration(flow.pitch.durationSeconds) ??
                      "Not known yet"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="cq-label text-(--cq-text-secondary)">
                    Format
                  </dt>
                  <dd className="cq-body cq-numeric">
                    {flow.pitch.aspectRatio ?? "Not known yet"}
                  </dd>
                </div>
              </dl>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept="video/*"
                className="sr-only"
                aria-label="Choose a pitch video"
                onChange={(event) => void onFile(event)}
                disabled={busy || cancelling}
              />
              {flow.kind === "INTERRUPTED" ? null : (
                <Button
                  variant={flow.kind === "READY" ? "secondary" : "primary"}
                  disabled={busy || cancelling}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={ICON_SIZE.regular} aria-hidden="true" />
                  {flow.kind === "READY"
                    ? "Replace video"
                    : flow.kind === "FAILED"
                      ? "Upload again"
                      : "Choose a video"}
                </Button>
              )}
              <p className="cq-caption text-(--cq-text-tertiary)">
                {guidance === null
                  ? "Portrait works best. Aim for 30 seconds to 2 minutes; 3 minutes at most."
                  : `Portrait (${guidance.preferredAspectRatio}) works best. Aim for ${String(guidance.targetMinSeconds)} seconds to ${String(Math.round(guidance.targetMaxSeconds / 60))} minutes; ${String(Math.round(guidance.hardMaxSeconds / 60))} minutes at most.`}
              </p>
            </div>
          </div>
        </section>
      </PageSection>

      {flow.kind === "READY" ? (
        <PageSection
          id="pitch-preview"
          className="lg:sticky lg:top-6 lg:col-start-1 lg:row-span-2 lg:row-start-1"
          title="Preview"
          description="What an investor's player will show. Muted until they turn the sound on."
        >
          {preview === null ||
          preview.mediaAssetId !== flow.pitch.mediaAssetId ? (
            <Skeleton lines={2} />
          ) : preview.kind === "UNAVAILABLE" ? (
            <InlineNotice tone="info" title="Preview is not available yet">
              {preview.reason}
            </InlineNotice>
          ) : (
            <div className="mx-auto w-full max-w-(--cq-layout-narrow) overflow-hidden rounded-(--cq-radius-lg) bg-(--cq-stage-canvas)">
              <PitchPlayer
                company={asDiscovered(company, flow.pitch)}
                policy="ACTIVE"
                authorize={authorize}
                reducedMotion={reducedMotion}
                startOnRequest
                hold={holdPreview}
              />
            </div>
          )}
        </PageSection>
      ) : null}

      <PageSection
        id="pitch-standing"
        className={sideBySide ? "lg:col-start-2 lg:row-start-2" : undefined}
        title="Who sees it"
        description="A pitch reaches investors through the same door as the rest of your profile."
      >
        {flow.kind === "READY" ? (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {flow.pitch.playbackPolicy === "PRIVATE" ? (
              <Button
                variant="primary"
                disabled={deciding}
                onClick={() => void decide(flow.pitch, "AUTHORISED")}
              >
                Let investors play this pitch
              </Button>
            ) : (
              <>
                <span className="cq-status-line">
                  <Check size={ICON_SIZE.compact} aria-hidden="true" />
                  Investors may play this pitch
                </span>
                <Button
                  variant="quiet"
                  disabled={deciding}
                  onClick={() => void decide(flow.pitch, "PRIVATE")}
                >
                  Keep it private
                </Button>
              </>
            )}
          </div>
        ) : null}
        {decisionNotice !== null ? (
          <InlineNotice tone="warning" className="mb-4">
            {decisionNotice}
          </InlineNotice>
        ) : null}
        {shown !== null && shown.live && onDeleted !== undefined ? (
          <div className="mb-6">
            <PitchDetails
              key={shown.mediaAssetId}
              companyId={companyId}
              pitch={shown}
              onSaved={(pitch) => dispatch({ type: "PITCH_UPDATED", pitch })}
              onDeleted={onDeleted}
            />
          </div>
        ) : null}
        <p className="cq-status-line">
          {standing.visible ? (
            <Check size={ICON_SIZE.compact} aria-hidden="true" />
          ) : (
            <Eye size={ICON_SIZE.compact} aria-hidden="true" />
          )}
          {standing.sentence}
        </p>
        {standing.needs !== undefined ? (
          <div className="mt-3 flex flex-col gap-2" data-pitch-feed-needs>
            {standing.needs.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {standing.needs.map((need) => (
                  <li key={need.requirement}>
                    <Link
                      href={need.href}
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {need.label.charAt(0).toUpperCase() + need.label.slice(1)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <Button
                variant="secondary"
                disabled={checking}
                onClick={() => void checkAgain()}
              >
                {checking ? "Checking…" : "Check again"}
              </Button>
            </div>
          </div>
        ) : null}
        <p className="mt-3">
          <Link href="/company/visibility" className={buttonClassName("quiet")}>
            Visibility and discovery
          </Link>
        </p>
      </PageSection>
    </div>
  );
}

/** One quiet line for where the pitch stands, from the record alone. */
function StatusLine({ flow }: { readonly flow: PitchFlowState }) {
  const text = (() => {
    switch (flow.kind) {
      case "LOADING":
        return "Loading";
      case "EMPTY":
        // This upload's state, not the company's: a company with a live
        // pitch read "No pitch yet" here (demo audit 2026-10-03).
        return "Nothing uploaded yet";
      case "CREATED":
        return "Ready for a video";
      case "PREPARING":
        return "Preparing the upload";
      case "UPLOADING":
        return `${flow.reconnecting ? "Reconnecting" : "Uploading"} · ${String(Math.round(flow.progress * 100))}%`;
      case "INTERRUPTED":
        return "Upload paused";
      case "PROCESSING":
        return "Processing";
      case "READY":
        return "Ready";
      case "FAILED":
        return "Needs a new file";
    }
  })();
  return (
    <span className="cq-status-line" aria-live="polite">
      {flow.kind === "READY" ? (
        <Check size={ICON_SIZE.compact} aria-hidden="true" />
      ) : null}
      {text}
    </span>
  );
}
